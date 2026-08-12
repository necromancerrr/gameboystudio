/**
 * What the SDK reports about itself so a bundle can be checked.
 *
 * `gbs check` needs to know that input arrived and was decoded correctly. It
 * cannot learn that by watching the screen: D-022 is explicit that requiring
 * "input moves something" is action-game bias, and a turn-based or text game
 * would fail such a rule while being perfectly well-formed.
 *
 * So the SDK answers for itself. A probe asks what the runtime observed — how
 * many frames it has run, which buttons it currently holds, which it saw
 * pressed — and the checker compares that against what it sent. Delivery and
 * decoding are proven; interpretation is left to the game, where it belongs.
 *
 * This is a conformance facility, not a gameplay one. A game never sees it, and
 * the host never sends a probe during play.
 */

import type { GbsButton } from './protocol.js';

export interface ProbeMessage {
  t: 'probe';
}

export interface ProbeResultMessage {
  t: 'probeResult';
  /** Frames the game's `update` has been given. */
  frames: number;
  /** Whether the runtime believes the loop is currently running. */
  running: boolean;
  /** Players this session was loaded with, after clamping. */
  players: number;
  /** Buttons currently held, as `player:button`. */
  held: string[];
  /** Buttons seen pressed since the last probe, as `player:button`. */
  pressed: string[];
  /** Whether the game supplied serialize/restore, so `saves` can be checked. */
  canSave: boolean;
}

export function isProbe(value: unknown): value is ProbeMessage {
  return typeof value === 'object' && value !== null && (value as { t?: unknown }).t === 'probe';
}

/** Tracks what the runtime actually observed, for the probe to report. */
export class ConformanceRecord {
  frames = 0;
  private readonly pressedSeen = new Set<string>();

  noteFrame(): void {
    this.frames += 1;
  }

  notePressed(player: number, button: GbsButton): void {
    this.pressedSeen.add(`${player}:${button}`);
  }

  drainPressed(): string[] {
    const seen = [...this.pressedSeen];
    this.pressedSeen.clear();
    return seen.sort();
  }
}
