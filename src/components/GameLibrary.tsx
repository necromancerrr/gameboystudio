'use client';

/**
 * The library grid with search and console filtering.
 *
 * Filtering is client-side rather than through the URL. At this catalog size an
 * index is pointless and every keystroke can filter instantly, and it lets the
 * homepage go back to being fully static. The trade is that a filtered view is
 * no longer linkable — worth revisiting if the catalog grows enough that
 * sharing one matters.
 */

import { useEffect, useMemo, useState } from 'react';
import { GameCard } from '@/components/GameCard';
import { CONSOLE_LABELS, isMultiplayer, searchGames, type Game } from '@/catalog';
import type { ConsoleId } from '@/emulation/core/types';
import { loadHostedGames } from '@/hosted/loadHostedGames';

/** 'original' is not a console, but from the shelf it reads as one more source. */
type ConsoleFilter = ConsoleId | 'all' | 'original';

export function GameLibrary({
  games,
  consoles,
}: {
  games: readonly Game[];
  consoles: readonly ConsoleId[];
}) {
  const [query, setQuery] = useState('');
  const [consoleFilter, setConsole] = useState<ConsoleFilter>('all');
  const [twoPlayer, setTwoPlayer] = useState(false);
  const [hosted, setHosted] = useState<readonly Game[]>([]);

  /**
   * Hosted games arrive after the page does, on purpose.
   *
   * The compiled catalog is rendered by the server and never waits on the
   * network — the Instant Contract is binding, so a slow or dead hosted origin
   * must cost the player nothing. Hosted titles simply appear when they resolve,
   * and never at all if they do not.
   */
  useEffect(() => {
    const controller = new AbortController();
    void loadHostedGames(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.games.length > 0) setHosted(result.games);
      if (result.problem) console.warn('[GameBoyStudio] hosted games:', result.problem);
    });
    return () => controller.abort();
  }, []);

  const allGames = useMemo(() => [...games, ...hosted], [games, hosted]);

  // An Original is a first-party game we wrote, which is `runtime: 'native'`.
  // It used to be tested as "has no console", which was the same set until
  // hosted games arrived — those have no console either, and are not ours.
  const isOriginal = (game: Game) => game.runtime === 'native';
  const hasOriginals = useMemo(() => allGames.some(isOriginal), [allGames]);
  const hasMultiplayer = useMemo(() => allGames.some(isMultiplayer), [allGames]);

  const visible = useMemo(() => {
    const byConsole =
      consoleFilter === 'all'
        ? allGames
        : consoleFilter === 'original'
          ? allGames.filter(isOriginal)
          : allGames.filter((game) => game.console === consoleFilter);
    const byPlayers = twoPlayer ? byConsole.filter(isMultiplayer) : byConsole;
    return searchGames(byPlayers, query);
  }, [allGames, consoleFilter, twoPlayer, query]);

  return (
    <>
      <div className="mb-5 flex flex-col gap-2.5 sm:mb-6 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search games"
            aria-label="Search games"
            data-testid="library-search"
            className="w-full rounded-full border border-hairline bg-surface px-4 py-2 text-sm text-foreground placeholder:text-faint focus:border-lcd-deep focus:outline-none"
          />
        </div>

        <nav aria-label="Filter by console" className="flex flex-wrap gap-2">
          <FilterChip active={consoleFilter === 'all'} onClick={() => setConsole('all')}>
            All
          </FilterChip>
          {hasOriginals ? (
            <FilterChip
              active={consoleFilter === 'original'}
              onClick={() => setConsole('original')}
            >
              Originals
            </FilterChip>
          ) : null}
          {consoles.map((id) => (
            <FilterChip
              key={id}
              active={consoleFilter === id}
              onClick={() => setConsole(id)}
            >
              {CONSOLE_LABELS[id]}
            </FilterChip>
          ))}

          {/* A different axis from console, so it is separated rather than
              filed alongside as if it were one more source. */}
          {hasMultiplayer ? (
            <>
              <span aria-hidden="true" className="mx-0.5 my-1 w-px self-stretch bg-hairline" />
              <FilterChip
                active={twoPlayer}
                onClick={() => setTwoPlayer((on) => !on)}
                testId="filter-two-player"
              >
                Two players
              </FilterChip>
            </>
          ) : null}
        </nav>
      </div>

      {visible.length === 0 ? (
        <p data-testid="library-empty" className="py-16 text-center text-sm text-muted">
          {query.trim()
            ? `Nothing matches “${query}”.`
            : 'Nothing here matches those filters.'}
        </p>
      ) : (
        <ul
          data-testid="library-grid"
          className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5"
        >
          {visible.map((game, index) => (
            <li key={game.slug}>
              <GameCard game={game} priority={index < 5} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={[
        'rounded-full border px-3 py-1.5 text-xs transition-colors',
        active
          ? 'border-lcd-deep bg-lcd-deep/25 text-lcd'
          : 'border-hairline text-muted hover:border-hairline-strong hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
