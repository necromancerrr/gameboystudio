/**
 * Merges every input source into one button state.
 *
 * Sources used to write to the emulator directly, which made button state
 * last-writer-wins: holding Left on a gamepad and then tapping and releasing
 * Left on touch would cancel the gamepad's hold. Harmless while only keyboard
 * and gamepad existed, and immediately visible once touch was added — the
 * conflict happens exactly during controller-connect transitions.
 *
 * A button is pressed if ANY source holds it.
 */

import { LOGICAL_BUTTONS, type LogicalButton } from '@/emulation/core/types';

export type InputSource = 'keyboard' | 'gamepad' | 'touch';

export class InputRouter {
  private readonly held = new Map<InputSource, Set<LogicalButton>>();
  private readonly active = new Set<LogicalButton>();

  constructor(
    private readonly onChange: (button: LogicalButton, pressed: boolean) => void,
  ) {}

  set(source: InputSource, button: LogicalButton, pressed: boolean): void {
    let sourceState = this.held.get(source);
    if (!sourceState) {
      sourceState = new Set();
      this.held.set(source, sourceState);
    }

    if (pressed) sourceState.add(button);
    else sourceState.delete(button);

    this.reconcile(button);
  }

  /** Drops everything one source holds. Used when touch hides or a pad drops. */
  releaseSource(source: InputSource): void {
    const sourceState = this.held.get(source);
    if (!sourceState || sourceState.size === 0) return;
    const buttons = [...sourceState];
    sourceState.clear();
    for (const button of buttons) this.reconcile(button);
  }

  releaseAll(): void {
    this.held.clear();
    for (const button of LOGICAL_BUTTONS) this.reconcile(button);
  }

  private reconcile(button: LogicalButton): void {
    let pressedByAny = false;
    for (const sourceState of this.held.values()) {
      if (sourceState.has(button)) {
        pressedByAny = true;
        break;
      }
    }

    // Only notify on a real edge, so the emulator sees each press once.
    if (pressedByAny === this.active.has(button)) return;
    if (pressedByAny) this.active.add(button);
    else this.active.delete(button);
    this.onChange(button, pressedByAny);
  }
}
