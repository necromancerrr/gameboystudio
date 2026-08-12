'use client';

/**
 * The home, composed rather than laid out.
 *
 * Nothing here is positional. Each shelf says whether it applies and how
 * strongly it wants the top, and this renders them in that order — so the
 * catalog leads a first visit because nothing else applies, and recedes on its
 * own once a person has games of their own. See shelves.ts.
 *
 * The ask sits above all of it and is not part of the ranking.
 */

import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { getGameBySlug } from '@/catalog';
import {
  getActivityServerSnapshot,
  getActivitySnapshot,
  subscribeToActivity,
} from '@/storage/playActivity';
import { Ask } from './Ask';
import { YourGames, useYourGames } from './YourGames';
import { orderShelves, type ShelfId } from './shelves';

export function StudioHome({
  library,
  continueShelf,
}: {
  library: ReactNode;
  continueShelf: ReactNode;
}) {
  // Fetched here, so the ranking and the shelf read the same numbers in the
  // same render.
  const { games, building } = useYourGames();

  // Counted the same way ContinueShelf decides what to render — entries that
  // resolve to a catalog game — so the shelf can never rank above the fold and
  // then draw nothing. A generated game's slug is not in the catalog, which is
  // correct: it belongs to "Your games", not to "Continue".
  const activity = useSyncExternalStore(
    subscribeToActivity,
    getActivitySnapshot,
    getActivityServerSnapshot,
  );
  const playedCount = activity.filter((entry) => getGameBySlug(entry.slug)).length;

  const order = orderShelves({ building, yours: games.length, played: playedCount });

  const shelves: Record<ShelfId, ReactNode> = {
    // "Making" and "yours" are the same component: a game being made becomes a
    // game you have, and that should be a change of state rather than a jump.
    making: null,
    continue: continueShelf,
    yours: <YourGames games={games} />,
    library,
  };

  return (
    <>
      <Ask />
      {/* `making` has no node of its own — it is the `yours` shelf in a
          different state, and its place in the ranking is the whole point of
          it. So it ranks, and renders nothing. */}
      {order.map((id) =>
        shelves[id] ? <Fragment key={id}>{shelves[id]}</Fragment> : null,
      )}
    </>
  );
}
