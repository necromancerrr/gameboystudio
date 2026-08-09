/**
 * Game Boy / Game Boy Color adapter over the binjgb WASM core.
 *
 * Deliberately plain TypeScript with no React imports: the run loop, WASM
 * allocations and AudioContext all outlive individual renders, and mixing them
 * into component state is how emulator integrations usually break.
 */

import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type EmulatorAdapter,
  type GameSource,
  type LogicalButton,
} from '../core/types';
import { createBinjgbModule, type BinjgbModule } from './binjgbModule';

const CPU_TICKS_PER_SECOND = 4194304;
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;

const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
/** Cap catch-up work so a backgrounded tab doesn't try to run minutes at once. */
const MAX_UPDATE_SEC = 5 / 60;
/** 0: none, 1: Sameboy, 2: Gambatte/Game Boy Online. Matches upstream default. */
const CGB_COLOR_CURVE = 2;

type JoypadSetter = keyof Pick<
  BinjgbModule,
  | '_set_joyp_up'
  | '_set_joyp_down'
  | '_set_joyp_left'
  | '_set_joyp_right'
  | '_set_joyp_A'
  | '_set_joyp_B'
  | '_set_joyp_start'
  | '_set_joyp_select'
>;

const JOYPAD_SETTERS: Record<LogicalButton, JoypadSetter> = {
  up: '_set_joyp_up',
  down: '_set_joyp_down',
  left: '_set_joyp_left',
  right: '_set_joyp_right',
  a: '_set_joyp_A',
  b: '_set_joyp_B',
  start: '_set_joyp_start',
  select: '_set_joyp_select',
};

export interface BinjgbAdapterOptions {
  canvas: HTMLCanvasElement;
  /** Reports measured frames per second roughly once a second. */
  onFps?: (fps: number) => void;
  onError?: (error: Error) => void;
  /** Fires when the cartridge wrote to battery RAM, i.e. the game saved. */
  onBatteryDirty?: () => void;
  /**
   * Fires once the game has drawn something other than a flat colour. Games
   * hold a blank screen for seconds while booting, which is indistinguishable
   * from a broken player, so the UI waits for this rather than for "loaded".
   */
  onFirstFrame?: () => void;
}

export class BinjgbAdapter implements EmulatorAdapter {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly onFps?: (fps: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onBatteryDirty?: () => void;
  private readonly onFirstFrame?: () => void;
  private firstFrameReported = false;

  /**
   * Retained so a reset restores the save, the way pressing reset on real
   * hardware leaves the cartridge's battery RAM intact.
   */
  private pendingSave: Uint8Array | null = null;

  private module: BinjgbModule | null = null;
  private handle = 0;
  private joypadPtr = 0;
  private romDataPtr = 0;
  private romSize = 0;
  private frameBuffer: Uint8Array | null = null;
  private audioBuffer: Uint8Array | null = null;

  private rafToken: number | null = null;
  private lastRafSec = 0;
  private running = false;
  private destroyed = false;

  private audioCtx: AudioContext | null = null;
  private audioStartSec = 0;
  private muted = false;

  private framesThisSecond = 0;
  private fpsWindowStart = 0;

  constructor(options: BinjgbAdapterOptions) {
    this.canvas = options.canvas;
    this.onFps = options.onFps;
    this.onError = options.onError;
    this.onBatteryDirty = options.onBatteryDirty;
    this.onFirstFrame = options.onFirstFrame;

    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.imageData = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  async loadGame(source: GameSource): Promise<void> {
    const [wasm, romBuffer] = await Promise.all([
      createBinjgbModule(),
      fetch(source.romUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`ROM fetch failed: ${response.status} ${source.romUrl}`);
        }
        return response.arrayBuffer();
      }),
    ]);

    // An unmount during the awaits above must not leave WASM memory allocated.
    if (this.destroyed) return;

    this.module = wasm;
    this.instantiate(romBuffer);
  }

  /** Creates the core from an already-fetched ROM. Shared by load and reset. */
  private instantiate(romBuffer: ArrayBuffer): void {
    const wasm = this.module;
    if (!wasm) throw new Error('binjgb module not loaded');

    // binjgb requires the ROM buffer padded up to a 32K boundary.
    const size = (romBuffer.byteLength + 0x7fff) & ~0x7fff;
    const ptr = wasm._malloc(size);
    new Uint8Array(wasm.HEAP8.buffer, ptr, size)
      .fill(0)
      .set(new Uint8Array(romBuffer));

    const sampleRate = this.ensureAudioContext().sampleRate;
    const handle = wasm._emulator_new_simple(
      ptr,
      size,
      sampleRate,
      AUDIO_FRAMES,
      CGB_COLOR_CURVE,
    );
    if (handle === 0) {
      wasm._free(ptr);
      throw new Error('binjgb rejected the ROM — not a valid Game Boy image');
    }

    this.handle = handle;
    this.romDataPtr = ptr;
    this.romSize = size;

    // Without this the core never reads the joypad buffer that setButton writes
    // to, so every press is silently dropped and the game appears unplayable.
    this.joypadPtr = wasm._joypad_new();
    wasm._emulator_set_default_joypad_callback(handle, this.joypadPtr);

    if (this.pendingSave) this.loadSave(this.pendingSave);
    this.frameBuffer = new Uint8Array(
      wasm.HEAP8.buffer,
      wasm._get_frame_buffer_ptr(handle),
      wasm._get_frame_buffer_size(handle),
    );
    this.audioBuffer = new Uint8Array(
      wasm.HEAP8.buffer,
      wasm._get_audio_buffer_ptr(handle),
      wasm._get_audio_buffer_capacity(handle),
    );
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  start(): void {
    if (this.running || this.destroyed || !this.handle) return;
    this.running = true;
    this.lastRafSec = 0;
    this.fpsWindowStart = performance.now();
    this.framesThisSecond = 0;
    this.scheduleFrame();
  }

  pause(): void {
    this.running = false;
    this.cancelFrame();
    void this.audioCtx?.suspend();
  }

  resume(): void {
    if (this.destroyed || !this.handle) return;
    // Browsers only allow this from a user gesture; callers must honour that.
    void this.audioCtx?.resume();
    this.start();
  }

  async reset(): Promise<void> {
    if (this.destroyed || !this.module) return;
    const wasRunning = this.running;
    this.pause();

    // Pressing reset on real hardware leaves the cartridge's battery RAM
    // intact, so carry the save across.
    const save = this.readSave();
    if (save) this.pendingSave = save;

    // Re-read the ROM straight out of WASM memory so reset needs no refetch.
    const rom = new Uint8Array(
      this.module.HEAP8.buffer.slice(
        this.romDataPtr,
        this.romDataPtr + this.romSize,
      ),
    );
    this.teardownCore();

    // A fresh module, for the same reason loadGame uses one: building a second
    // emulator inside a module that has already had one torn down corrupts the
    // core and traps on the next allocation.
    this.module = await createBinjgbModule();
    if (this.destroyed) return;

    this.instantiate(rom.buffer as ArrayBuffer);
    this.audioStartSec = 0;
    if (wasRunning) this.start();
  }

  setButton(button: LogicalButton, pressed: boolean): void {
    if (!this.module || !this.handle) return;
    const setter = JOYPAD_SETTERS[button];
    this.module[setter](this.handle, pressed ? 1 : 0);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * Runs `body` against a freshly allocated ext-RAM file buffer, always freeing
   * it afterwards. Every ext-RAM operation goes through this so a throw can't
   * leak WASM memory.
   */
  private withExtRamBuffer<T>(
    body: (fileDataPtr: number, buffer: Uint8Array) => T,
  ): T | null {
    const wasm = this.module;
    if (!wasm || !this.handle) return null;
    const fileDataPtr = wasm._ext_ram_file_data_new(this.handle);
    if (!fileDataPtr) return null;
    try {
      const buffer = new Uint8Array(
        wasm.HEAP8.buffer,
        wasm._get_file_data_ptr(fileDataPtr),
        wasm._get_file_data_size(fileDataPtr),
      );
      return body(fileDataPtr, buffer);
    } finally {
      wasm._file_data_delete(fileDataPtr);
    }
  }

  readSave(): Uint8Array | null {
    const wasm = this.module;
    if (!wasm) return null;
    return this.withExtRamBuffer((fileDataPtr, buffer) => {
      if (buffer.byteLength === 0) return null;
      wasm._emulator_write_ext_ram(this.handle, fileDataPtr);
      // Copy out: the view points into WASM memory that is about to be freed.
      return new Uint8Array(buffer);
    });
  }

  loadSave(data: Uint8Array): boolean {
    const wasm = this.module;
    if (!wasm || data.byteLength === 0) return false;
    this.pendingSave = data;
    return (
      this.withExtRamBuffer((fileDataPtr, buffer) => {
        // A size mismatch means the save belongs to a different cartridge.
        if (buffer.byteLength !== data.byteLength) return false;
        buffer.set(data);
        wasm._emulator_read_ext_ram(this.handle, fileDataPtr);
        return true;
      }) ?? false
    );
  }

  destroy(): void {
    this.destroyed = true;
    this.running = false;
    this.cancelFrame();
    this.teardownCore();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private teardownCore(): void {
    const wasm = this.module;
    if (!wasm) return;
    if (this.handle) {
      wasm._emulator_delete(this.handle);
      this.handle = 0;
    }
    if (this.joypadPtr) {
      wasm._joypad_delete(this.joypadPtr);
      this.joypadPtr = 0;
    }
    if (this.romDataPtr) {
      wasm._free(this.romDataPtr);
      this.romDataPtr = 0;
    }
    this.frameBuffer = null;
    this.audioBuffer = null;
  }

  private scheduleFrame(): void {
    this.rafToken = requestAnimationFrame(this.onAnimationFrame);
  }

  private cancelFrame(): void {
    if (this.rafToken !== null) {
      cancelAnimationFrame(this.rafToken);
      this.rafToken = null;
    }
  }

  private readonly onAnimationFrame = (startMs: number): void => {
    if (!this.running || this.destroyed) return;
    this.scheduleFrame();

    const startSec = startMs / 1000;
    const deltaSec = Math.max(startSec - (this.lastRafSec || startSec), 0);
    this.lastRafSec = startSec;

    const deltaTicks = Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND;
    this.runUntil(this.ticks + deltaTicks);
    this.render();

    this.framesThisSecond += 1;
    const elapsed = startMs - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.onFps?.((this.framesThisSecond * 1000) / elapsed);
      this.framesThisSecond = 0;
      this.fpsWindowStart = startMs;
    }
  };

  private get ticks(): number {
    if (!this.module || !this.handle) return 0;
    return this.module._emulator_get_ticks_f64(this.handle);
  }

  private runUntil(target: number): void {
    const wasm = this.module;
    if (!wasm || !this.handle) return;
    try {
      for (;;) {
        const event = wasm._emulator_run_until_f64(this.handle, target);
        if (event & EVENT_AUDIO_BUFFER_FULL) this.pushAudio();
        if (event & EVENT_UNTIL_TICKS) break;
        if (!(event & (EVENT_NEW_FRAME | EVENT_AUDIO_BUFFER_FULL))) break;
      }
      // The flag is cleared by reading it, so check once per batch.
      if (wasm._emulator_was_ext_ram_updated(this.handle)) {
        this.onBatteryDirty?.();
      }
    } catch (error) {
      this.running = false;
      this.cancelFrame();
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * The frame and audio buffers are views onto the WASM heap. Growing that heap
   * detaches the old ArrayBuffer and leaves the views zero-length, so re-derive
   * them rather than silently rendering nothing.
   */
  private refreshHeapViews(): void {
    const wasm = this.module;
    if (!wasm || !this.handle) return;
    if (this.frameBuffer && this.frameBuffer.byteLength > 0) return;
    this.frameBuffer = new Uint8Array(
      wasm.HEAP8.buffer,
      wasm._get_frame_buffer_ptr(this.handle),
      wasm._get_frame_buffer_size(this.handle),
    );
    this.audioBuffer = new Uint8Array(
      wasm.HEAP8.buffer,
      wasm._get_audio_buffer_ptr(this.handle),
      wasm._get_audio_buffer_capacity(this.handle),
    );
  }

  private render(): void {
    this.refreshHeapViews();
    if (!this.frameBuffer || this.frameBuffer.byteLength === 0) return;
    this.imageData.data.set(this.frameBuffer);
    this.ctx.putImageData(this.imageData, 0, 0);

    if (!this.firstFrameReported && this.hasVisibleContent()) {
      this.firstFrameReported = true;
      this.onFirstFrame?.();
    }
  }

  /** Sampled uniformity check — cheap enough to run until it first passes. */
  private hasVisibleContent(): boolean {
    const fb = this.frameBuffer;
    if (!fb) return false;
    const first = fb[0];
    for (let i = 4; i < fb.length; i += 401 * 4) {
      if (fb[i] !== first) return true;
    }
    return false;
  }

  private pushAudio(): void {
    const ctx = this.audioCtx;
    const source = this.audioBuffer;
    if (!ctx || !source || source.byteLength === 0) return;
    if (this.muted || ctx.state !== 'running') return;

    const nowSec = ctx.currentTime;
    const nowPlusLatency = nowSec + AUDIO_LATENCY_SEC;
    this.audioStartSec = this.audioStartSec || nowPlusLatency;

    if (this.audioStartSec < nowSec) {
      // Fell behind (tab was backgrounded); resync rather than queue stale audio.
      this.audioStartSec = nowPlusLatency;
      return;
    }

    const buffer = ctx.createBuffer(2, AUDIO_FRAMES, ctx.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    // binjgb emits unsigned 8-bit interleaved stereo; centre it to remove DC.
    for (let i = 0; i < AUDIO_FRAMES; i += 1) {
      left[i] = (source[2 * i] - 128) / 128;
      right[i] = (source[2 * i + 1] - 128) / 128;
    }

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start(this.audioStartSec);
    this.audioStartSec += AUDIO_FRAMES / ctx.sampleRate;
  }
}
