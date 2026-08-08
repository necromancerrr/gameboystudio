/**
 * Gamepad -> logical button mapping.
 *
 * The Gamepad API has no events for button state, so this polls. Polling runs
 * on its own animation frame rather than inside the emulator loop, so a
 * controller still works while the game is paused.
 */

import { LOGICAL_BUTTONS, type LogicalButton } from '@/emulation/core/types';

/**
 * Indexes from the W3C "standard gamepad" mapping, which is defined by physical
 * position rather than by the labels printed on the pad.
 *
 * Face buttons are the subtle part. Game Boy's A sits to the right of B, so:
 *   A <- index 1, the east face button
 *   B <- index 0, the south face button
 *
 * On a Nintendo-layout pad this lines up with the printed A and B. On an
 * Xbox-layout pad the button printed "B" becomes Game Boy A — correct under the
 * thumb, which is what actually matters, and the long-standing convention in
 * emulators. Mapping by label instead would mirror the buttons on one of the
 * two layouts.
 */
const BUTTON_INDEXES: Record<LogicalButton, readonly number[]> = {
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  a: [1], // east
  b: [0], // south
  start: [9], // Start / Menu / Options / Plus
  select: [8], // Back / Share / View / Minus
};

/** Left stick axes, used as an alternative to the D-pad. */
const AXIS_X = 0;
const AXIS_Y = 1;

/**
 * Firm threshold: the stick is standing in for a digital D-pad, so a low
 * deadzone would make diagonals chatter between directions.
 */
const AXIS_THRESHOLD = 0.5;

export interface GamepadInfo {
  id: string;
  index: number;
  /** False when the browser could not match a known layout; mapping is a guess. */
  standardMapping: boolean;
}

export interface GamepadBindingOptions {
  onButton: (button: LogicalButton, pressed: boolean) => void;
  /** Called with the active pad, or null when none is connected. */
  onConnectionChange?: (pad: GamepadInfo | null) => void;
}

function isPressed(button: GamepadButton | undefined): boolean {
  if (!button) return false;
  // Analog triggers report `value`; treat anything past half travel as a press.
  return button.pressed || button.value > 0.5;
}

function readPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  const pads: Gamepad[] = [];
  for (const pad of navigator.getGamepads()) {
    if (pad) pads.push(pad);
  }
  return pads;
}

/** Returns an unbind function; callers must invoke it on teardown. */
export function bindGamepad({
  onButton,
  onConnectionChange,
}: GamepadBindingOptions): () => void {
  if (typeof window === 'undefined' || !navigator.getGamepads) {
    return () => {};
  }

  const held = new Set<LogicalButton>();
  let frame: number | null = null;
  let lastPadKey: string | null = null;

  const reportConnection = (pads: Gamepad[]) => {
    const pad = pads[0] ?? null;
    const key = pad ? `${pad.index}:${pad.id}` : null;
    if (key === lastPadKey) return;
    lastPadKey = key;
    onConnectionChange?.(
      pad
        ? {
            id: pad.id,
            index: pad.index,
            standardMapping: pad.mapping === 'standard',
          }
        : null,
    );
  };

  const poll = () => {
    frame = requestAnimationFrame(poll);

    const pads = readPads();
    reportConnection(pads);

    for (const button of LOGICAL_BUTTONS) {
      let pressed = false;

      // Merge every connected pad so whichever one the player picks up works.
      for (const pad of pads) {
        for (const index of BUTTON_INDEXES[button]) {
          if (isPressed(pad.buttons[index])) {
            pressed = true;
            break;
          }
        }
        if (pressed) break;

        const x = pad.axes[AXIS_X] ?? 0;
        const y = pad.axes[AXIS_Y] ?? 0;
        if (
          (button === 'left' && x <= -AXIS_THRESHOLD) ||
          (button === 'right' && x >= AXIS_THRESHOLD) ||
          (button === 'up' && y <= -AXIS_THRESHOLD) ||
          (button === 'down' && y >= AXIS_THRESHOLD)
        ) {
          pressed = true;
          break;
        }
      }

      // Emit edges only, so the emulator sees presses and releases once each.
      if (pressed && !held.has(button)) {
        held.add(button);
        onButton(button, true);
      } else if (!pressed && held.has(button)) {
        held.delete(button);
        onButton(button, false);
      }
    }
  };

  // Chrome hides gamepads until the page has seen input from them, so these
  // events are what surface a pad that was already plugged in.
  const handleConnection = () => {
    reportConnection(readPads());
  };

  window.addEventListener('gamepadconnected', handleConnection);
  window.addEventListener('gamepaddisconnected', handleConnection);
  frame = requestAnimationFrame(poll);

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('gamepadconnected', handleConnection);
    window.removeEventListener('gamepaddisconnected', handleConnection);
    // Release anything still held so the emulator can't be left stuck.
    for (const button of held) onButton(button, false);
    held.clear();
  };
}
