import type { ConsoleId } from '@/emulation/core/types';
import { GAMES } from './games';
import previewManifest from './previews.json';
import type { Game, GameRuntime, InputProfile, RetroGame } from './types';

export { GAMES };
export type { Game, GameRuntime, InputProfile, RetroGame };
export { CONSOLE_LABELS } from './types';

/** True for anything the emulator hosts, i.e. everything that is not native. */
export function isRetro(game: Game): game is RetroGame {
  return game.runtime !== 'native';
}

/** A verified gameplay loop. Only games that earned one appear here. */
export interface GamePreviewAsset {
  loop: string;
  still: string;
  frames: number;
  fps: number;
}

const PREVIEWS = previewManifest as Record<string, GamePreviewAsset>;

/**
 * Returns a loop only if one was generated AND approved by eye. Most games
 * legitimately have none and fall back to their curated screenshot — see
 * scripts/preview-recipes.json for the per-game reasoning.
 */
export function getPreview(game: Game): GamePreviewAsset | null {
  return PREVIEWS[game.slug] ?? null;
}

/** Curated order. See the rank field — alphabetical buried the good ones. */
export function getAllGames(): readonly Game[] {
  return GAMES;
}

export function getGameBySlug(slug: string): Game | undefined {
  return GAMES.find((game) => game.slug === slug);
}

export function getGamesByConsole(console: ConsoleId): Game[] {
  return GAMES.filter((game) => game.console === console);
}

/** Console ids present in the catalog, in display order. */
export function getConsoles(): ConsoleId[] {
  const order: ConsoleId[] = ['GB', 'GBC'];
  return order.filter((id) => GAMES.some((game) => game.console === id));
}

/**
 * Games two or more people can play at once.
 *
 * `players.max` rather than `min`, so a game that also works solo still answers
 * "what can the two of us play" — the question the facet exists for.
 */
export function isMultiplayer(game: Game): boolean {
  return game.players.max > 1;
}

/** Other titles sharing a series, excluding the game itself. */
export function getSeriesSiblings(game: Game): Game[] {
  if (!game.series) return [];
  return GAMES.filter((other) => other.series === game.series && other.slug !== game.slug);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    // Strip diacritics so "swiatow" matches "Światów".
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Substring match across the fields a person would actually type: title,
 * developer, series and genre. At 20 games this runs on every keystroke with
 * no debounce and no index.
 */
export function searchGames(games: readonly Game[], query: string): Game[] {
  const q = normalize(query.trim());
  if (!q) return [...games];
  const terms = q.split(/\s+/);

  return games.filter((game) => {
    const haystack = normalize(
      [game.title, game.developer, game.series ?? '', ...game.genre].join(' '),
    );
    return terms.every((term) => haystack.includes(term));
  });
}
