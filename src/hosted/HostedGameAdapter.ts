/**
 * Hosts a game the platform did not compile.
 *
 * The third adapter, beside `BinjgbAdapter` and `NativeGameRuntime`, and shaped
 * to match what the player component already does with both — load, start,
 * pause, resume, reset, setButton, setMuted, readSave, loadSave, destroy — so
 * hosting a game is the same choreography rather than a third way of doing
 * things. Neither of the other two is touched by any of this.
 *
 * The difference that matters: everything past this class is code we did not
 * write, running in a sandbox with an opaque origin. So this file assumes the
 * frame may be broken or hostile:
 *
 * - It never trusts a message it did not validate.
 * - It never waits forever. A frame that does not answer is an error, not a
 *   spinner, because the Instant Contract is binding.
 * - It bounds what a frame can do to the host: save size, message rate, and the
 *   number of pending requests are all capped.
 */

import type { LogicalButton } from '@/emulation/core/types';
import type { FramePort } from './FramePort';
import {
  FRAME_PROTOCOL_VERSION,
  parseFrameMessage,
  type FrameMessage,
} from './frameProtocol';

/** A frame that has not said hello by now is not going to. */
const HELLO_TIMEOUT_MS = 8000;
/** A save request that goes unanswered must not hang a page close. */
const SAVE_TIMEOUT_MS = 1500;
/**
 * Far above any real game's needs — saves and errors are occasional — and far
 * below what it takes to make the host unresponsive.
 */
const RATE_LIMIT = { perSecond: 60, burst: 120 };

export interface HostedGameAdapterOptions {
  port: FramePort;
  players: number;
  onError(error: Error): void;
  /** The frame drew something. Retires the boot overlay, as the others do. */
  onFirstFrame?(): void;
  onSaveDirty?(): void;
  /** The game's own resolution, once it says hello. */
  onResolution?(size: { width: number; height: number }): void;
}

export class HostedGameAdapter {
  private readonly options: HostedGameAdapterOptions;
  private readonly port: FramePort;
  private readonly unsubscribe: () => void;

  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: {
    resolve(data: Uint8Array | null): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private tokens = RATE_LIMIT.burst;
  private lastRefill = Date.now();

  private started = false;
  private destroyed = false;
  private helloed = false;
  private muted = false;
  private paintedSent = false;

  constructor(options: HostedGameAdapterOptions) {
    this.options = options;
    this.port = options.port;
    this.unsubscribe = this.port.onMessage((message) => this.receive(message));

    this.helloTimer = setTimeout(() => {
      this.fail(new Error('This game did not start. It may be unavailable.'));
    }, HELLO_TIMEOUT_MS);
  }

  get ready(): boolean {
    return this.helloed;
  }

  start(): void {
    if (this.destroyed) return;
    // Recorded before the readiness check, so a player who presses play while
    // the frame is still loading gets a game rather than nothing. `hello`
    // replays it. Returning early here loses the press silently.
    this.started = true;
    if (!this.helloed) return;
    this.port.post({ t: 'start' });
  }

  pause(): void {
    if (this.destroyed) return;
    this.port.post({ t: 'pause' });
  }

  resume(): void {
    if (this.destroyed || !this.helloed) return;
    this.port.post({ t: 'resume' });
  }

  reset(): void {
    if (this.destroyed) return;
    this.port.post({ t: 'reset' });
  }

  setButton(player: number, button: LogicalButton, pressed: boolean): void {
    // Deliberately not gated on `started`: input binds before the game is ready
    // in the other two runtimes too, so a button held during load is not lost.
    if (this.destroyed) return;
    this.port.post({ t: 'input', player, button, pressed });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.destroyed) return;
    this.port.post({ t: 'mute', muted });
  }

  loadSave(data: Uint8Array): void {
    if (this.destroyed || !this.helloed) return;
    this.port.post({ t: 'restore', data });
  }

  /**
   * Asks the frame for its save data.
   *
   * Resolves to null on timeout rather than hanging. This is called from
   * `pagehide`, where a promise that never settles would be a lost save at best
   * and a blocked unload at worst.
   */
  readSave(): Promise<Uint8Array | null> {
    if (this.destroyed || !this.helloed) return Promise.resolve(null);
    // One outstanding request at a time; a second supersedes the first.
    this.settleSave(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleSave(null), SAVE_TIMEOUT_MS);
      this.pendingSave = { resolve, timer };
      this.port.post({ t: 'readSave' });
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.settleSave(null);
    // Tell the game first, so it can stop its own loop and audio, then stop
    // listening. The frame element itself is removed by the component.
    this.port.post({ t: 'destroy' });
    this.unsubscribe();
    this.port.close();
  }

  private receive(raw: unknown): void {
    if (this.destroyed) return;
    if (!this.spend()) return; // a flooding frame is ignored, not fatal

    const message = parseFrameMessage(raw);
    if (!message) return;
    this.handle(message);
  }

  private handle(message: FrameMessage): void {
    switch (message.t) {
      case 'hello': {
        if (this.helloed) return;
        if (message.v !== FRAME_PROTOCOL_VERSION) {
          this.fail(new Error('This game was built for a different version of the platform.'));
          return;
        }
        this.helloed = true;
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.options.onResolution?.({ width: message.width, height: message.height });
        this.port.post({
          t: 'load',
          v: FRAME_PROTOCOL_VERSION,
          players: this.options.players,
          muted: this.muted,
        });
        // A host that called start() before hello must not silently do nothing.
        if (this.started) this.port.post({ t: 'start' });
        return;
      }

      case 'painted':
        if (this.paintedSent) return;
        this.paintedSent = true;
        this.options.onFirstFrame?.();
        return;

      case 'saveDirty':
        this.options.onSaveDirty?.();
        return;

      case 'save':
        this.settleSave(message.data);
        return;

      case 'error':
        // The game's own words are not shown to the player; they are the
        // author's, not the platform's, and may be anything at all.
        this.options.onError(new Error('This game stopped unexpectedly.'));
        return;

      default:
        return;
    }
  }

  private settleSave(data: Uint8Array | null): void {
    const pending = this.pendingSave;
    if (!pending) return;
    this.pendingSave = null;
    clearTimeout(pending.timer);
    pending.resolve(data);
  }

  private fail(error: Error): void {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.options.onError(error);
  }

  /** Token bucket, so a frame cannot spin the host with messages. */
  private spend(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      RATE_LIMIT.burst,
      this.tokens + ((now - this.lastRefill) / 1000) * RATE_LIMIT.perSecond,
    );
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
