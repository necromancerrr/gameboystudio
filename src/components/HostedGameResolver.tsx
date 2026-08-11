'use client';

/**
 * Resolves a slug the application was not built with.
 *
 * The server cannot know a hosted game exists — that is the whole point of M5 —
 * so an unknown slug reaches the client, which reads the validated manifest and
 * either mounts the game or reports a genuine not-found.
 *
 * Hosted games keep `/games/[slug]` URLs on purpose. A separate URL shape would
 * tell players which runtime is behind a game, and D-014 bars runtime internals
 * from player-facing UI.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HostedPlayer } from '@/components/HostedPlayer';
import { loadHostedGames } from '@/hosted/loadHostedGames';
import type { HostedGame } from '@/hosted/manifest';

type State = { phase: 'looking' } | { phase: 'found'; game: HostedGame } | { phase: 'missing' };

export function HostedGameResolver({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ phase: 'looking' });

  useEffect(() => {
    const controller = new AbortController();
    void loadHostedGames(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const game = result.games.find((candidate) => candidate.slug === slug);
      setState(game ? { phase: 'found', game } : { phase: 'missing' });
      if (result.problem) console.warn('[GameBoyStudio] hosted games:', result.problem);
    });
    return () => controller.abort();
  }, [slug]);

  if (state.phase === 'looking') {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <span className="loading-dots text-xs tracking-widest text-faint" aria-label="Loading">
          <i />
          <i />
          <i />
        </span>
      </main>
    );
  }

  if (state.phase === 'missing') {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="text-lg font-semibold">That game is not here</h1>
        <p className="text-sm text-muted">
          It may have been removed, or the link may be wrong.
        </p>
        <Link href="/" className="text-sm text-lcd underline underline-offset-4">
          Back to the library
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-6 sm:px-8 sm:py-10">
      <Link href="/" className="text-sm text-muted transition-colors hover:text-foreground">
        ← Library
      </Link>
      <div className="mt-4">
        <HostedPlayer game={state.game} />
      </div>
      <section className="mt-8">
        <h1 className="text-lg font-semibold tracking-tight">{state.game.title}</h1>
        <p className="mt-1 text-sm text-muted">{state.game.developer}</p>
        {state.game.description ? (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">
            {state.game.description}
          </p>
        ) : null}
      </section>
    </main>
  );
}
