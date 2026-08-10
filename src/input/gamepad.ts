/**
 * Gamepad -> logical button mapping, per player.
 *
 * The Gamepad API has no events for button state, so this polls. Polling runs
 * on its own animation frame rather than inside the game loop, so a controller
 * still works while the game is paused.
 */

import { LOGICAL_BUTTONS, type LogicalButton } from '@/emulation/core/types';
import type { PlayerIndex } from './InputRouter';
import { PlayerSlots } from './PlayerSlots';

/**
 * Indexes from the W3C "standard gamepad" mapping, which is defined by physical
 * position rather than by the labels printed on the pad.
 *
 * Face buttons are the subtle part. Game Boy's A sits to the right of B, so:
 *   A <- index 1, the east face button
 *   B <- index 0, the south face button
 *
 * On a Nintendo-layout pad this lines up with the printed A and B. On an
 * Xbox-layout pad the button printed "B" becomes A — correct under the thumb,
 * which is what actually matters, and the long-standing emulator convention.
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

const AXIS_X = 0;
const AXIS_Y = 1;

/**
 * Firm threshold: the stick is standing in for a digital D-pad, so a low
 * deadzone would make diagonals chatter between directions.
 */
const AXIS_THRESHOLD = 0.5;

export interface GamepadInfo {
  id: string;
  /** The browser's gamepad index — not the player slot. */
  index: number;
  player: PlayerIndex;
  /** False when the browser could not match a known layout; mapping is a guess. */
  standardMapping: boolean;
}

export interface GamepadBindingOptions {
  /**
   * How many independent players this game accepts. At 1 every connected pad
   * drives player 0, so whichever controller someone picks up just works.
   * Above 1, slots are exclusive.
   */
  maxPlayers?: number;
  /**
   * Shared slot table. Pass the one the player component owns so pads, phones
   * and keyboards are assigned by the same rules; omit it and this binding gets
   * a private table sized by `maxPlayers`.
   */
  slots?: PlayerSlots;
  onButton: (player: PlayerIndex, button: LogicalButton, pressed: boolean) => void;
  /** Called with every assigned pad whenever the set changes. */
  onConnectionChange?: (pads: GamepadInfo[]) => void;
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

/**
 * Cleans a raw gamepad id into something worth showing a player.
 * "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c ...)" is not.
 */
export function padLabel(id: string): string {
  return id.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || 'Controller';
}

/** Returns an unbind function; callers must invoke it on teardown. */
export function bindGamepad({
  maxPlayers = 1,
  slots: providedSlots,
  onButton,
  onConnectionChange,
}: GamepadBindingOptions): () => void {
  if (typeof window === 'undefined' || !navigator.getGamepads) {
    return () => {};
  }

  // Slot policy lives in PlayerSlots so that pads, phones and keyboards are
  // assigned by one set of rules. Owning a private copy here is how a remote
  // player and a local pad would end up both believing they are player one.
  const slots = providedSlots ?? new PlayerSlots(maxPlayers);
  const held = new Map<PlayerIndex, Set<LogicalButton>>();
  let frame: number | null = null;
  let lastSignature = '';

  const heldFor = (player: PlayerIndex): Set<LogicalButton> => {
    let set = held.get(player);
    if (!set) {
      set = new Set();
      held.set(player, set);
    }
    return set;
  };

  const releasePlayer = (player: PlayerIndex) => {
    const set = held.get(player);
    if (!set) return;
    for (const button of set) onButton(player, button, false);
    set.clear();
  };

  const pollOnce = () => {
    const pads = readPads();
    const present = new Set(pads.map((pad) => String(pad.index)));
    for (const freedSlot of slots.retain('gamepad', present)) releasePlayer(freedSlot);

    const assigned: GamepadInfo[] = [];
    // player -> the buttons any of that player's pads is holding this frame
    const desired = new Map<PlayerIndex, Set<LogicalButton>>();

    for (const pad of pads) {
      const player = slots.attach({
        kind: 'gamepad',
        key: String(pad.index),
        label: padLabel(pad.id),
        memo: pad.id,
      });
      if (player === null) continue;
      assigned.push({
        id: pad.id,
        index: pad.index,
        player,
        standardMapping: pad.mapping === 'standard',
      });

      let want = desired.get(player);
      if (!want) {
        want = new Set();
        desired.set(player, want);
      }

      for (const button of LOGICAL_BUTTONS) {
        if (BUTTON_INDEXES[button].some((i) => isPressed(pad.buttons[i]))) {
          want.add(button);
          continue;
        }
        const x = pad.axes[AXIS_X] ?? 0;
        const y = pad.axes[AXIS_Y] ?? 0;
        if (
          (button === 'left' && x <= -AXIS_THRESHOLD) ||
          (button === 'right' && x >= AXIS_THRESHOLD) ||
          (button === 'up' && y <= -AXIS_THRESHOLD) ||
          (button === 'down' && y >= AXIS_THRESHOLD)
        ) {
          want.add(button);
        }
      }
    }

    // Emit edges only, so the game sees each press and release once.
    for (const [player, want] of desired) {
      const current = heldFor(player);
      for (const button of want) {
        if (!current.has(button)) {
          current.add(button);
          onButton(player, button, true);
        }
      }
      for (const button of [...current]) {
        if (!want.has(button)) {
          current.delete(button);
          onButton(player, button, false);
        }
      }
    }

    const signature = assigned
      .map((pad) => `${pad.player}:${pad.index}:${pad.id}`)
      .sort()
      .join('|');
    if (signature !== lastSignature) {
      lastSignature = signature;
      onConnectionChange?.(assigned);
    }
  };

  const poll = () => {
    frame = requestAnimationFrame(poll);
    pollOnce();
  };

  // Chrome hides gamepads until the page has seen input from them, so these
  // events are what surface a pad that was already plugged in. Reporting runs
  // immediately rather than waiting for the next frame, so connection feedback
  // does not depend on the loop having ticked.
  const handleConnection = () => {
    pollOnce();
  };

  window.addEventListener('gamepadconnected', handleConnection);
  window.addEventListener('gamepaddisconnected', handleConnection);
  frame = requestAnimationFrame(poll);

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('gamepadconnected', handleConnection);
    window.removeEventListener('gamepaddisconnected', handleConnection);
    for (const player of held.keys()) releasePlayer(player);
    held.clear();
    // The slot table can outlive this binding when it is shared, so leaving
    // pads attached would show phantom players after a remount.
    slots.retain('gamepad', new Set());
  };
}
