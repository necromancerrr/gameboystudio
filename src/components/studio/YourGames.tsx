'use client';

/**
 * Your games, and the ones being made.
 *
 * One component covers both because they are the same shelf at different
 * moments — a game being made becomes a game you have, and splitting them would
 * make that transition a jump rather than a change of state.
 *
 * Generated games are personal; the catalog is curated. They never share a grid
 * or a filter, because mixing them damages both.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMyGames } from './useMyGames';

interface Summary {
  id: string;
  title: string;
  status: 'building' | 'ready' | 'failed';
  playUrl: string | null;
  updatedAt: string | null;
}

/** Slow enough not to hammer, fast enough that "ready" feels immediate. */
const POLL_MS = 1500;

export function useYourGames() {
  const { ids } = useMyGames();
  const [games, setGames] = useState<Summary[]>([]);

  // Poll only while something is being made. A shelf of finished games has no
  // reason to talk to the server, so the interval exists only while it earns
  // its keep.
  const building = games.filter((game) => game.status === 'building');
  const polling = building.length > 0;

  // One effect, because fetching and polling are the same subscription at two
  // rates. Everything it sets lands in a promise callback, never synchronously
  // in the effect body.
  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;

    const load = () =>
      Promise.all(
        ids.map((id) =>
          fetch(`/api/games/${id}`, { cache: 'no-store' })
            .then((response) => (response.ok ? (response.json() as Promise<Summary>) : null))
            .catch(() => null),
        ),
      ).then((loaded) => {
        if (cancelled) return;
        setGames(loaded.filter((game): game is Summary => game !== null));
      });

    void load();
    const timer = polling ? setInterval(() => void load(), POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [ids, polling]);

  return { games, building: building.length };
}

/**
 * The shelf itself, given what the hook found.
 *
 * Split from the fetching so the home can rank shelves from the same counts
 * without the shelf pushing them upward from an effect — which React rightly
 * calls a cascading render, and which would make the ordering lag a frame
 * behind the truth.
 */
export function YourGames({ games }: { games: Summary[] }) {
  if (games.length === 0) return null;

  return (
    <section className="mb-7" data-testid="your-games">
      <h2 className="mb-2.5 text-xs tracking-widest text-faint uppercase">Your games</h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {games.map((game) => (
          <li key={game.id}>
            <GameTile game={game} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GameTile({ game }: { game: Summary }) {
  const playable = game.status === 'ready' || game.playUrl !== null;

  const tile = (
    <>
      <div className="aspect-gb relative overflow-hidden rounded-md border border-hairline bg-surface">
        {game.status === 'building' ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="loading-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="text-[0.65rem] tracking-widest text-faint uppercase">Making it</span>
          </span>
        ) : game.status === 'failed' && !playable ? (
          <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[0.7rem] text-muted">
            That one did not work out
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-3xl text-lcd-deep">
            ▶
          </span>
        )}
      </div>
      <h3 className="mt-1.5 truncate text-sm text-foreground">{game.title}</h3>
      <p className="truncate text-xs text-faint">
        {game.status === 'building' ? 'making it…' : 'made for you'}
      </p>
    </>
  );

  // A game still being made is not a dead tile: its previous version is often
  // playable, and the page shows the build alongside it.
  return playable || game.status === 'building' ? (
    <Link href={`/g/${game.id}`} className="group block">
      {tile}
    </Link>
  ) : (
    <div className="block opacity-70">{tile}</div>
  );
}
