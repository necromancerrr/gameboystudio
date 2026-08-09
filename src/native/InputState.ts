/**
 * Per-player button state for a native game, with edge detection.
 *
 * This sits downstream of InputRouter, not beside it. The router decides what
 * a player is holding across keyboard, gamepad and touch; this turns that into
 * what a game reads on a given frame.
 *
 * The two are separate because they answer different questions. The router is
 * event-driven and knows nothing about frames; a game asks "was this pressed
 * this frame", which only exists once there is a frame.
 */

import type { InputSnapshot, NativeButton, PlayerInput } from './types';

/** Never pressed. Returned for player indexes the session does not have. */
const ABSENT_PLAYER: PlayerInput = {
  held: () => false,
  pressed: () => false,
};

class PlayerState implements PlayerInput {
  readonly heldButtons = new Set<NativeButton>();
  /** Presses seen since the last frame boundary, waiting to be reported. */
  readonly pendingPresses = new Set<NativeButton>();
  /** Presses being reported to the game for the current frame. */
  readonly framePresses = new Set<NativeButton>();

  held(button: NativeButton): boolean {
    return this.heldButtons.has(button);
  }

  pressed(button: NativeButton): boolean {
    return this.framePresses.has(button);
  }
}

export class InputState implements InputSnapshot {
  private readonly states: PlayerState[];

  constructor(readonly players: number) {
    this.states = Array.from({ length: Math.max(0, players) }, () => new PlayerState());
  }

  player(index: number): PlayerInput {
    return this.states[index] ?? ABSENT_PLAYER;
  }

  /**
   * Feed from the input router. A press is queued rather than reported
   * immediately, so a button tapped and released between two frames is still
   * seen exactly once — losing those taps is how a dash button starts feeling
   * unreliable.
   */
  set(player: number, button: NativeButton, pressed: boolean): void {
    const state = this.states[player];
    if (!state) return;
    if (pressed) {
      if (!state.heldButtons.has(button)) state.pendingPresses.add(button);
      state.heldButtons.add(button);
    } else {
      state.heldButtons.delete(button);
    }
  }

  /** Called by the runtime immediately before update, never by a game. */
  beginFrame(): void {
    for (const state of this.states) {
      state.framePresses.clear();
      for (const button of state.pendingPresses) state.framePresses.add(button);
      state.pendingPresses.clear();
    }
  }

  /** Drops everything, including queued presses. Used on pause and teardown. */
  releaseAll(): void {
    for (const state of this.states) {
      state.heldButtons.clear();
      state.pendingPresses.clear();
      state.framePresses.clear();
    }
  }
}
