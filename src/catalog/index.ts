import type { ConsoleId } from '@/emulation/core/types';
import { GAMES } from './games';
import type { Game } from './types';

export { GAMES };
export type { Game };
export { CONSOLE_LABELS } from './types';

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
