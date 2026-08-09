'use client';

/**
 * "Continue" — the shortest path from wanting to keep playing to playing.
 *
 * Two honesty rules shape this:
 *
 * 1. The label depends on whether saved progress ACTUALLY exists, not on
 *    whether the cartridge supports saving. A battery-backed game the player
 *    opened for ten seconds has nothing to resume, so it says "Play again"
 *    exactly like the six games with no save support at all. From the player's
 *    side both restart, so both must read the same.
 *
 * 2. Nothing renders for a first-time visitor. No heading, no empty state, no
 *    "you haven't played anything yet" — an empty shelf is worse than no shelf.
 */

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getGameBySlug, type Game } from '@/catalog';
import { GameThumb } from '@/components/GameThumb';
import { hasSave } from '@/emulation/core/saveStorage';
import {
  getActivityServerSnapshot,
  getActivitySnapshot,
  subscribeToActivity,
} from '@/storage/playActivity';

/** Beyond this the shelf stops being a shortcut and becomes a second library. */
const MAX_SHOWN = 6;

interface ContinueEntry {
  game: Game;
  resumable: boolean;
}

export function ContinueShelf() {
  // The server snapshot is empty, so nothing renders during SSR or hydration
  // and a first-time visitor never sees a flash of empty shelf.
  const activity = useSyncExternalStore(
    subscribeToActivity,
    getActivitySnapshot,
    getActivityServerSnapshot,
  );

  const entries = useMemo<ContinueEntry[]>(
    () =>
      activity
        .slice(0, MAX_SHOWN)
        .map((item) => {
          const game = getGameBySlug(item.slug);
          // Skip games that have left the catalog rather than rendering a hole.
          return game ? { game, resumable: hasSave(game.slug) } : null;
        })
        .filter((entry): entry is ContinueEntry => entry !== null),
    [activity],
  );

  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="continue-heading" className="mb-7" data-testid="continue-shelf">
      <h2
        id="continue-heading"
        className="mb-3 text-xs font-medium tracking-wide text-faint uppercase"
      >
        Continue
      </h2>

      {/* A scroll row rather than a wrapping grid: it caps the vertical space
          this takes above the library, which matters most on a phone. */}
      {/* scroll-pl matches the padding: without it, snapping scrolls past the
          inset on load and the first card sits flush to the screen edge while
          everything else is aligned. */}
      <ul className="-mx-5 flex snap-x snap-mandatory scroll-pl-5 gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:scroll-pl-0 sm:px-0">
        {entries.map(({ game, resumable }) => (
          <li key={game.slug} className="w-[148px] shrink-0 snap-start sm:w-[168px]">
            <Link
              href={`/games/${game.slug}`}
              className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-lcd"
            >
              <div className="aspect-gb relative overflow-hidden rounded-lg border border-hairline bg-black transition-colors group-hover:border-hairline-strong">
                <GameThumb game={game} sizes="168px" />
              </div>
              <h3 className="mt-2 truncate text-sm font-medium text-foreground group-hover:text-lcd">
                {game.title}
              </h3>
              <p
                data-testid="continue-state"
                data-resumable={resumable ? 'true' : 'false'}
                className={`truncate text-xs ${resumable ? 'text-lcd' : 'text-muted'}`}
              >
                {resumable ? 'Continue' : 'Play again'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
