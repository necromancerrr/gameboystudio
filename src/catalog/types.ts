import type { ConsoleId } from '@/emulation/core/types';

/**
 * Which runtime hosts the game. This, not `console`, picks the adapter — a
 * native game has no console at all.
 *
 * `hosted` games are the only ones that do not appear in the compiled catalog:
 * they arrive at runtime through the manifest (D-018), so this union is the one
 * place the two catalogs meet.
 */
export type GameRuntime = 'gb' | 'gbc' | 'native' | 'hosted';

/**
 * The platform input vocabulary, narrowed to the profiles something in the
 * product actually reads today. Pointer and motion exist in
 * PLATFORM_DIRECTION.md but nothing consumes them, so they are not modelled
 * yet.
 */
export type InputProfile = 'gamepad' | 'keyboard' | 'touch';

export interface Game {
  slug: string;
  title: string;
  developer: string;
  /** May be empty — Homebrew Hub metadata is sparse. UI must tolerate this. */
  description: string;
  year: number | null;

  runtime: GameRuntime;
  /** ROM path for `gb`/`gbc`; native module id for `native`. */
  entry: string;
  /**
   * How many people can play at once. Discovery needs this to answer "what can
   * two of us play", so it is not derivable from the runtime.
   */
  players: { min: number; max: number };
  /**
   * `required` is what you must have to play at all — empty means any supported
   * profile is enough. A two-controller game lists `gamepad` here so the
   * platform can say so before you launch it.
   */
  inputs: {
    required: readonly InputProfile[];
    supported: readonly InputProfile[];
  };
  /** Progress persists across sessions. Battery RAM for retro, serialize() for native. */
  saves: boolean;

  /** Display metadata for retro titles. Null for native games, which have no console. */
  console: ConsoleId | null;

  genre: string[];
  screenshots: string[];
  /** SPDX identifier, verified against the upstream repository. See D-008. */
  license: string;
  attribution: string;
  /** Upstream repository or author page. */
  sourceUrl: string;
  homepageUrl: string;

  /** Curated position in the library. Lower sorts first. */
  rank: number;
  /** Shared name for related titles, so the grid can group rather than repeat. */
  series: string | null;
}

/**
 * A game the emulator can host. Narrowing to this is what lets the player
 * component keep a non-null console. `npm run verify:catalog` asserts the
 * runtime and console agree, so the narrowing cannot become a lie in data.
 */
export type RetroGame = Game & { runtime: 'gb' | 'gbc'; console: ConsoleId };

export const CONSOLE_LABELS: Record<ConsoleId, string> = {
  GB: 'Game Boy',
  GBC: 'Game Boy Color',
};
