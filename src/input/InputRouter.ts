/**
 * Merges every input source into per-player button state.
 *
 * Sources used to write to the emulator directly, which made button state
 * last-writer-wins: holding Left on a gamepad and then tapping and releasing
 * Left on touch would cancel the gamepad's hold.
 *
 * A button is pressed for a player if ANY of that player's sources holds it.
 * Players are fully independent — player 2 releasing Left never affects
 * player 1.
 */

import { LOGICAL_BUTTONS, type LogicalButton } from '@/emulation/core/types';

export type InputSource = 'keyboard' | 'gamepad' | 'touch';

/** Zero-based. Player 0 is the only player a retro game ever sees. */
export type PlayerIndex = number;

function slotKey(player: PlayerIndex, source: InputSource): string {
  return `${player}:${source}`;
}

export class InputRouter {
  /** `${player}:${source}` -> buttons that source currently holds. */
  private readonly held = new Map<string, Set<LogicalButton>>();
  /** player -> buttons currently reported as pressed. */
  private readonly active = new Map<PlayerIndex, Set<LogicalButton>>();

  constructor(
    private readonly onChange: (
      player: PlayerIndex,
      button: LogicalButton,
      pressed: boolean,
    ) => void,
  ) {}

  set(
    player: PlayerIndex,
    source: InputSource,
    button: LogicalButton,
    pressed: boolean,
  ): void {
    const key = slotKey(player, source);
    let sourceState = this.held.get(key);
    if (!sourceState) {
      sourceState = new Set();
      this.held.set(key, sourceState);
    }

    if (pressed) sourceState.add(button);
    else sourceState.delete(button);

    this.reconcile(player, button);
  }

  /**
   * Drops everything one of a player's sources holds. Used when the touch deck
   * hides, when a pad disconnects, and on orientation change.
   */
  releaseSource(player: PlayerIndex, source: InputSource): void {
    const sourceState = this.held.get(slotKey(player, source));
    if (!sourceState || sourceState.size === 0) return;
    const buttons = [...sourceState];
    sourceState.clear();
    for (const button of buttons) this.reconcile(player, button);
  }

  releaseAll(): void {
    const players = [...this.active.keys()];
    this.held.clear();
    for (const player of players) {
      for (const button of LOGICAL_BUTTONS) this.reconcile(player, button);
    }
  }

  private reconcile(player: PlayerIndex, button: LogicalButton): void {
    let pressedByAny = false;
    for (const [key, sourceState] of this.held) {
      if (!key.startsWith(`${player}:`)) continue;
      if (sourceState.has(button)) {
        pressedByAny = true;
        break;
      }
    }

    let playerActive = this.active.get(player);
    if (!playerActive) {
      playerActive = new Set();
      this.active.set(player, playerActive);
    }

    // Only notify on a real edge, so the game sees each press once.
    if (pressedByAny === playerActive.has(button)) return;
    if (pressedByAny) playerActive.add(button);
    else playerActive.delete(button);
    this.onChange(player, button, pressedByAny);
  }
}
