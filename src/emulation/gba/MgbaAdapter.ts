/**
 * Game Boy Advance adapter over the mGBA WASM core.
 *
 * SPIKE. Not wired into the catalog, the player, or any production route.
 *
 * The shape deliberately matches BinjgbAdapter so the difference is visible:
 * binjgb hands us a framebuffer and we own the run loop, the canvas blit and
 * the AudioContext. mGBA owns all three itself — it is given a canvas at
 * construction and runs its own Emscripten main loop. So this adapter is thin
 * where BinjgbAdapter is thick, and the D-005 boundary holds anyway, which is
 * the useful result: the interface survived a core with the opposite
 * architecture.
 *
 * Two extensions to the core contract that GBA forces, both recorded in
 * GBA_SPIKE.md:
 *   - L and R shoulder buttons, so LogicalButton grows from eight to ten.
 *   - 240x160, so screen dimensions can no longer be module constants.
 */

import type { LogicalButton } from '../core/types';
import { createMgbaModule } from './mgbaModule';
import type { mGBAEmulator } from './mgbaTypes';

/** Native Game Boy Advance screen dimensions. */
export const GBA_SCREEN_WIDTH = 240;
export const GBA_SCREEN_HEIGHT = 160;

/**
 * Shoulder buttons. The Game Boy contract has eight buttons and treats all of
 * them as first-class (ARCHITECTURE.md); GBA has ten. Adopting GBA means this
 * union widens and every consumer of it — the keyboard map, the gamepad map,
 * the touch overlay — has to answer for the two new ones.
 */
export type GbaButton = LogicalButton | 'l' | 'r';

/** mGBA's own button names, which are not ours. */
const BUTTON_NAMES: Record<GbaButton, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  a: 'A',
  b: 'B',
  start: 'Start',
  select: 'Select',
  l: 'L',
  r: 'R',
};

export interface GbaSource {
  romUrl: string;
  /** Stable id for persisting this game's save. */
  saveKey: string;
}

export interface MgbaAdapterOptions {
  canvas: HTMLCanvasElement;
  /** Measured frames per second, reported roughly once a second. */
  onFps?: (fps: number) => void;
  onError?: (error: Error) => void;
  /** Fires when the core wrote to save data, i.e. the game saved. */
  onSaveDirty?: () => void;
  /** Fires on the first rendered frame, so the UI can stop showing a loader. */
  onFirstFrame?: () => void;
  /** Bytes downloaded / total, while the ROM is being fetched. */
  onProgress?: (received: number, total: number) => void;
}

export class MgbaAdapter {
  private readonly canvas: HTMLCanvasElement;
  private readonly onFps?: (fps: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onSaveDirty?: () => void;
  private readonly onFirstFrame?: () => void;
  private readonly onProgress?: (received: number, total: number) => void;

  private module: mGBAEmulator | null = null;
  private romPath = '';
  private destroyed = false;
  private running = false;
  private muted = false;
  private volume = 1;

  private probeSeq = 0;
  private firstFrameReported = false;
  private framesThisSecond = 0;
  private fpsWindowStart = 0;
  private fpsToken: number | null = null;

  constructor(options: MgbaAdapterOptions) {
    this.canvas = options.canvas;
    this.onFps = options.onFps;
    this.onError = options.onError;
    this.onSaveDirty = options.onSaveDirty;
    this.onFirstFrame = options.onFirstFrame;
    this.onProgress = options.onProgress;

    this.canvas.width = GBA_SCREEN_WIDTH;
    this.canvas.height = GBA_SCREEN_HEIGHT;
  }

  async loadGame(source: GbaSource): Promise<void> {
    const [module, rom] = await Promise.all([
      createMgbaModule(this.canvas),
      this.fetchRom(source.romUrl),
    ]);

    // An unmount during the awaits above must not leave a running core behind.
    if (this.destroyed) {
      module.quitMgba();
      return;
    }

    this.module = module;

    const paths = module.filePaths();
    const name = source.romUrl.split('/').pop() ?? 'game.gba';
    this.romPath = `${paths.gamePath}/${name}`;
    module.FS.writeFile(this.romPath, rom);

    if (!module.loadGame(this.romPath)) {
      throw new Error('mGBA rejected the ROM — not a valid Game Boy Advance image');
    }

    /**
     * loadGame does NOT start the loop. It returns true, the ROM is in the
     * filesystem, listRoms() shows it, and the canvas stays white forever with
     * no error anywhere. resumeGame is what actually runs it.
     *
     * This is the GBA restatement of D-012: every signal said loaded, and
     * nothing was running.
     */
    module.resumeGame();
    this.running = true;

    /**
     * Registered after loadGame, not before: the callbacks attach to a core
     * that does not exist until a ROM is loaded.
     */
    module.addCoreCallbacks({
      saveDataUpdatedCallback: () => this.onSaveDirty?.(),
      videoFrameEndedCallback: () => this.countFrame(),
      coreCrashedCallback: () => this.onError?.(new Error('the mGBA core crashed')),
    });

    this.startFpsWindow();
    this.watchForFirstFrame();
  }

  /**
   * Streamed rather than `arrayBuffer()`, because GBA ROMs are two orders of
   * magnitude larger than the Game Boy ones this product was built around —
   * Skyland is 24MB against a 64KB median. Without progress, "play should be
   * immediate" becomes a blank screen of unknown length.
   */
  private async fetchRom(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ROM fetch failed: ${response.status} ${url}`);
    }

    const total = Number(response.headers.get('content-length') ?? 0);
    if (!response.body || !total) {
      return new Uint8Array(await response.arrayBuffer());
    }

    const reader = response.body.getReader();
    const out = new Uint8Array(total);
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, received);
      received += value.byteLength;
      this.onProgress?.(received, total);
    }
    return out;
  }

  /**
   * Reads what the core is actually drawing, independently of the canvas.
   *
   * `screenshot()` writes a PNG into the emulated filesystem, so this asks the
   * core what it rendered rather than asking the compositor what it painted.
   * That distinction matters: a WebGL canvas without `preserveDrawingBuffer`
   * reads back blank whether or not anything was drawn, so canvas pixels are
   * not evidence. This is.
   *
   * Returns a colour count and a hash — the same two things verify:catalog
   * asserts for Game Boy, for the same reason: "it renders" and "the picture
   * changed" are different claims and both need proving.
   */
  async sampleScreen(): Promise<{ colours: number; hash: number } | null> {
    const module = this.module;
    if (!module || this.destroyed) return null;

    const name = `probe-${(this.probeSeq += 1)}.png`;
    const path = `${module.filePaths().screenshotsPath}/${name}`;
    if (!module.screenshot(name)) return null;

    /**
     * Copied out of the heap before use. This is a pthreads build, so the
     * emulated filesystem hands back views onto a SharedArrayBuffer, and a
     * SAB-backed view cannot go into a Blob or through structured clone. The
     * copy is what makes the bytes ordinary again.
     */
    const png = Uint8Array.from(module.FS.readFile(path));
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);

    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const colours = new Set<number>();
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    for (let i = 0; i < data.length; i += 13) hash = (hash * 31 + data[i]) | 0;

    module.FS.unlink(path);
    return { colours: colours.size, hash };
  }

  /**
   * A first frame is "more than one colour on screen", polled from the core.
   *
   * The obvious signal, `videoFrameEndedCallback`, is registered and never
   * fires in this build. Waiting on it left the UI reporting "loading" over a
   * game that was running perfectly — the exact failure D-012 was written
   * about, arriving from a different direction.
   */
  private watchForFirstFrame(): void {
    const poll = window.setInterval(() => {
      void this.sampleScreen().then((sample) => {
        if (!sample || sample.colours < 2) return;
        window.clearInterval(poll);
        if (this.firstFrameReported) return;
        this.firstFrameReported = true;
        this.onFirstFrame?.();
      });
    }, 250);
  }

  private countFrame(): void {
    this.framesThisSecond += 1;
    if (!this.firstFrameReported) {
      this.firstFrameReported = true;
      this.onFirstFrame?.();
    }
  }

  private startFpsWindow(): void {
    if (!this.onFps || this.fpsToken !== null) return;
    this.fpsWindowStart = performance.now();
    this.fpsToken = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - this.fpsWindowStart) / 1000;
      if (elapsed > 0) this.onFps?.(this.framesThisSecond / elapsed);
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
    }, 1000);
  }

  start(): void {
    this.resume();
  }

  pause(): void {
    if (!this.module || this.destroyed || !this.running) return;
    this.module.pauseGame();
    this.running = false;
  }

  resume(): void {
    if (!this.module || this.destroyed || this.running) return;
    this.module.resumeGame();
    // resumeGame restores audio too, so re-apply mute rather than let it leak.
    if (this.muted) this.module.pauseAudio();
    this.running = true;
  }

  /**
   * Reload rather than teardown, so the save survives — the same promise
   * BinjgbAdapter.reset makes about battery RAM on real hardware.
   */
  reset(): void {
    if (!this.module || this.destroyed) return;
    this.module.quickReload();
    this.running = true;
  }

  setButton(button: GbaButton, pressed: boolean): void {
    if (!this.module || this.destroyed) return;
    const name = BUTTON_NAMES[button];
    if (pressed) this.module.buttonPress(name);
    else this.module.buttonUnpress(name);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.module || this.destroyed) return;
    if (muted) this.module.pauseAudio();
    else if (this.running) this.module.resumeAudio();
  }

  /** 0..1. mGBA's own scale is 0..2, which is not a thing players should see. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.module?.setVolume(this.volume);
  }

  /**
   * GBA saves are SRAM, Flash or EEPROM and run to 128KB, against 8-32KB of
   * Game Boy battery RAM. D-013 base64s saves into localStorage; at this size
   * that is a bad plan. Returned raw so the caller can decide where it goes.
   */
  readSave(): Uint8Array | null {
    if (!this.module || this.destroyed) return null;
    const save = this.module.getSave();
    // Copied off the shared heap: see sampleScreen. A SAB-backed view cannot be
    // structured-cloned, so handing one to IndexedDB would throw at the point
    // where a player's progress is being written.
    return save ? Uint8Array.from(save) : null;
  }

  /**
   * Writes a save into the emulated filesystem and reloads so the core picks it
   * up. mGBA has no "inject save into running game" call — the save file is
   * read when the ROM is loaded.
   */
  loadSave(data: Uint8Array): boolean {
    if (!this.module || this.destroyed || !this.romPath) return false;

    const paths = this.module.filePaths();
    const name = this.romPath.split('/').pop() ?? '';
    const savePath = `${paths.savePath}/${name.replace(/\.gba$/i, '')}.sav`;
    this.module.FS.writeFile(savePath, data);
    this.module.quickReload();
    return true;
  }

  /** Flushes the emulated filesystem to IndexedDB. */
  async flush(): Promise<void> {
    await this.module?.FSSync();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;

    if (this.fpsToken !== null) {
      window.clearInterval(this.fpsToken);
      this.fpsToken = null;
    }

    const module = this.module;
    this.module = null;
    if (!module) return;

    try {
      module.quitGame();
      module.quitMgba();
    } catch {
      // Teardown races a core that may already be gone. Idempotent by design —
      // D-006 records the same requirement for binjgb.
    }
  }
}
