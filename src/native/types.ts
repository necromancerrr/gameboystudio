/**
 * The native game contract.
 *
 * A native game implements this directly instead of being interpreted by an
 * emulator. It is not an engine and not a file format — the host owns the
 * things every game gets wrong (the loop, normalized input, edge detection,
 * audio unlock, mute, save storage), and the game supplies `update` and
 * `render`.
 *
 * Nothing here is speculative: every member is either called by
 * NativeGameRuntime today or is the hook a game needs to persist progress.
 */

import type { LogicalButton } from '@/emulation/core/types';

/**
 * Native games use the same eight logical buttons as retro, because that is
 * what the input layer produces today. This is a floor, not a ceiling — D-014
 * points native games at a wider gamepad vocabulary, and widening it is a
 * change to `src/input`, not to this contract.
 */
export type NativeButton = LogicalButton;

export interface PlayerInput {
  held(button: NativeButton): boolean;
  /**
   * True on exactly one frame per press. Edge detection lives here so that
   * every game does not reimplement it — and so a tap that begins and ends
   * between two frames is still seen once rather than swallowed.
   */
  pressed(button: NativeButton): boolean;
}

export interface InputSnapshot {
  /** How many players this session is running with. */
  readonly players: number;
  /**
   * Out-of-range indexes return an input that is never pressed rather than
   * throwing. A two-player game running solo should degrade, not crash.
   */
  player(index: number): PlayerInput;
}

/**
 * Web Audio, already unlocked by the host. A game connects its sources to
 * `out` and never touches `destination`, so the host's mute works without the
 * game participating.
 */
export interface AudioHost {
  readonly context: AudioContext;
  readonly out: GainNode;
}

export interface GameContext {
  readonly players: number;
  /** Null when the browser has no Web Audio, or it could not be created. */
  readonly audio: AudioHost | null;
  /**
   * Call when persistent state changed. The host decides when to actually
   * serialize and where to put the bytes; the game only reports the fact.
   */
  saveDirty(): void;
}

export interface NativeGame {
  readonly resolution: { width: number; height: number };
  readonly players: { min: number; max: number };

  /**
   * Build initial state. Called again by `reset()`, so it must fully
   * re-initialize rather than assume it runs once.
   */
  init(ctx: GameContext): void | Promise<void>;

  /** `dt` is seconds since the previous frame, clamped by the loop. */
  update(dt: number, input: InputSnapshot): void;
  render(g: CanvasRenderingContext2D): void;

  /** Opt into saves and Continue. A game without these simply has no save. */
  serialize?(): Uint8Array;
  restore?(data: Uint8Array): void;

  dispose?(): void;
}
