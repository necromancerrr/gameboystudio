/**
 * Hosts a NativeGame.
 *
 * Shaped to match what the player component already does with BinjgbAdapter —
 * load, start, pause, resume, reset, setMuted, readSave, loadSave, destroy —
 * so hosting a native game is the same choreography rather than a second way
 * of doing things.
 *
 * One deliberate difference: `setButton` takes a player index. Retro collapses
 * every player onto one joypad and cannot use it; native games are the reason
 * the router became player-indexed in the first place.
 *
 * BinjgbAdapter is not touched, imported, or refactored by any of this.
 */

import { GameLoop, browserScheduler, type Scheduler } from './GameLoop';
import { InputState } from './InputState';
import type { AudioHost, GameContext, NativeButton, NativeGame } from './types';

export interface NativeGameRuntimeOptions {
  canvas: HTMLCanvasElement;
  game: NativeGame;
  /** Clamped into the game's declared range. Defaults to its minimum. */
  players?: number;
  onError?(error: Error): void;
  onFirstFrame?(): void;
  /** The game reported that persistent state changed. Debounce, then readSave. */
  onSaveDirty?(): void;
  /** Test seam. Defaults to requestAnimationFrame. */
  scheduler?: Scheduler;
  /** Test seam. Defaults to Web Audio; returns null where it is unavailable. */
  createAudio?: () => AudioHost | null;
}

function defaultAudio(): AudioHost | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    const context = new AudioContext();
    const out = context.createGain();
    out.connect(context.destination);
    return { context, out };
  } catch {
    // Audio being blocked is not a reason to refuse to run the game.
    return null;
  }
}

export class NativeGameRuntime {
  private readonly game: NativeGame;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: NativeGameRuntimeOptions;
  private readonly loop: GameLoop;
  private readonly input: InputState;
  private readonly playerCount: number;

  private context2d: CanvasRenderingContext2D | null = null;
  private audio: AudioHost | null = null;
  private ctx: GameContext | null = null;

  private loaded = false;
  private destroyed = false;
  private muted = false;
  private firstFrameSent = false;

  constructor(options: NativeGameRuntimeOptions) {
    this.options = options;
    this.game = options.game;
    this.canvas = options.canvas;

    const { min, max } = this.game.players;
    const requested = options.players ?? min;
    this.playerCount = Math.min(Math.max(requested, min), max);

    this.input = new InputState(this.playerCount);
    this.loop = new GameLoop(
      (dt) => this.frame(dt),
      options.scheduler ?? browserScheduler(),
    );
  }

  get players(): number {
    return this.playerCount;
  }

  /** Prepares the canvas and the game. Mirrors adapter.loadGame(). */
  async load(): Promise<void> {
    if (this.destroyed) return;

    const { width, height } = this.game.resolution;
    this.canvas.width = width;
    this.canvas.height = height;

    const context2d = this.canvas.getContext('2d');
    if (!context2d) throw new Error('This browser could not open a 2D canvas.');
    this.context2d = context2d;

    this.audio = (this.options.createAudio ?? defaultAudio)();
    this.applyMute();

    this.ctx = {
      players: this.playerCount,
      audio: this.audio,
      saveDirty: () => this.options.onSaveDirty?.(),
    };

    await this.game.init(this.ctx);
    this.loaded = true;
    // A paused-at-start player still sees the game rather than a black box.
    this.draw();
  }

  start(): void {
    if (!this.loaded || this.destroyed) return;
    void this.audio?.context.resume();
    this.loop.start();
  }

  pause(): void {
    this.loop.stop();
    // Anything held when the loop stops would still be held on resume, which
    // is how a player comes back to a ship already thrusting.
    this.input.releaseAll();
  }

  resume(): void {
    if (!this.loaded || this.destroyed) return;
    // resume() is where the user gesture lands, so it is where audio unlocks.
    void this.audio?.context.resume();
    this.loop.start();
  }

  /**
   * Rebuilds the game's state, but carries the save across — the same way a
   * cartridge's battery survives pressing reset (D-013). A game therefore
   * serializes durable progress, such as a best score, rather than the state
   * of the current run.
   */
  async reset(): Promise<void> {
    if (!this.loaded || this.destroyed || !this.ctx) return;
    const wasRunning = this.loop.running;
    const carried = this.readSave();
    this.loop.stop();
    this.input.releaseAll();

    await this.game.init(this.ctx);
    if (carried) this.loadSave(carried);

    this.draw();
    if (wasRunning) this.loop.start();
  }

  setButton(player: number, button: NativeButton, pressed: boolean): void {
    if (this.destroyed) return;
    this.input.set(player, button, pressed);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  /** Null when the game did not opt into saves. */
  readSave(): Uint8Array | null {
    if (!this.game.serialize || this.destroyed) return null;
    try {
      const data = this.game.serialize();
      return data.byteLength > 0 ? data : null;
    } catch (error) {
      this.reportError(error);
      return null;
    }
  }

  /** False when the game cannot restore, or the data was not usable. */
  loadSave(data: Uint8Array): boolean {
    if (!this.game.restore || this.destroyed) return false;
    try {
      this.game.restore(data);
      return true;
    } catch {
      // A save written by an older version of a game must not brick it.
      return false;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.input.releaseAll();
    try {
      this.game.dispose?.();
    } catch (error) {
      this.reportError(error);
    }
    void this.audio?.context.close();
    this.audio = null;
    this.context2d = null;
    this.ctx = null;
  }

  private frame(dt: number): void {
    this.input.beginFrame();
    try {
      this.game.update(dt, this.input);
      this.draw();
    } catch (error) {
      // Stop rather than throw sixty times a second into the console.
      this.loop.stop();
      this.reportError(error);
    }
  }

  private draw(): void {
    if (!this.context2d) return;
    this.game.render(this.context2d);
    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.options.onFirstFrame?.();
    }
  }

  private applyMute(): void {
    if (this.audio) this.audio.out.gain.value = this.muted ? 0 : 1;
  }

  private reportError(error: unknown): void {
    this.options.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
