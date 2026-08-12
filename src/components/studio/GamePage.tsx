'use client';

/**
 * A generated game, and the loop around it.
 *
 *   PLAY → CHANGE → (still playing) → PLAY AGAIN → SHARE
 *
 * The rule that shapes this page is that **the game never goes away**. A change
 * is happening somewhere else; what is on screen stays playable the whole time,
 * because `playUrl` comes from the pointer and the pointer only ever moves to a
 * revision that is ready (D-024). So a build in flight is a line of text next to
 * a running game, not a spinner where the game used to be.
 *
 * Whoever owns the game gets the change controls; a visitor arriving by link
 * gets the game. There are no accounts to check, so ownership is simply whether
 * this browser is the one that asked — which is honest about what it is, and
 * fails in the harmless direction.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HostedPlayer } from '@/components/HostedPlayer';
import type { HostedGame } from '@/hosted/manifest';
import { useMyGames } from './useMyGames';
import { Ask } from './Ask';

interface ChangeView {
  id: string;
  request: string;
  current: boolean;
  failed: boolean;
}

interface GameView {
  id: string;
  title: string;
  status: 'building' | 'ready' | 'failed';
  playUrl: string | null;
  understood: string[];
  couldNotDo: string[];
  changes: ChangeView[];
  canUndo: boolean;
  updatedAt: string | null;
}

const POLL_MS = 1500;

/**
 * Changes worth offering without knowing what the game is.
 *
 * Deliberately not generated from the spec: a chip that names something the
 * game does not have is worse than no chip, and the honest answer to "what can
 * I change" is still being learned. What a chip cannot express, the box below
 * it can.
 */
const CHIPS = ['make it faster', 'make it slower', 'make it harder', 'make it easier'];

/**
 * The player takes a catalog game. A generated game is not in the catalog and
 * must never be — it is unlisted, personal, and not curated. So it is adapted
 * at the boundary instead, which keeps generated play out of the catalog types
 * entirely.
 */
function asHostedGame(view: GameView, frameUrl: string): HostedGame {
  return {
    slug: `generated-${view.id}`,
    title: view.title,
    developer: 'You',
    description: '',
    year: null,
    runtime: 'hosted',
    entry: frameUrl,
    frameUrl,
    // Until a generated game can declare otherwise, one player and every input.
    players: { min: 1, max: 1 },
    inputs: { required: [], supported: ['gamepad', 'keyboard', 'touch'] },
    saves: false,
    console: null,
    genre: [],
    screenshots: [],
    license: 'LicenseRef-GameBoyStudio-Original',
    attribution: 'GameBoyStudio',
    sourceUrl: '',
    homepageUrl: '',
    rank: 0,
    series: null,
  };
}

export function GamePage({ id }: { id: string }) {
  const [view, setView] = useState<GameView | null>(null);
  const [missing, setMissing] = useState(false);
  const { ids } = useMyGames();
  const mine = ids.includes(id);

  const building = view?.status === 'building';

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetch(`/api/games/${id}`, { cache: 'no-store' })
        .then(async (response) => {
          if (cancelled) return;
          if (response.status === 404) {
            setMissing(true);
            return;
          }
          if (!response.ok) return;
          setView((await response.json()) as GameView);
        })
        .catch(() => {});

    void load();
    // Only while something is being made. Once it settles, the page is static
    // and has no reason to keep talking to the server.
    const timer = building ? setInterval(() => void load(), POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, building]);

  if (missing) {
    return (
      <p className="py-16 text-center text-sm text-muted">
        That game is not here.{' '}
        <Link href="/" className="text-lcd underline underline-offset-4">
          Ask for one
        </Link>
        .
      </p>
    );
  }

  if (!view) return <p className="py-16 text-center text-sm text-faint">Loading…</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4">
        <h1 className="text-xl text-foreground">{view.title}</h1>
        <p className="mt-0.5 text-xs text-faint">
          {building
            ? view.playUrl
              ? 'Making your change. Keep playing — this one stays until the new one works.'
              : 'Making it. This takes a moment.'
            : view.status === 'failed' && view.playUrl
              ? 'That change did not work out. This is the version you had.'
              : 'Made for you'}
        </p>
      </header>

      {view.playUrl ? (
        <HostedPlayer key={view.playUrl} game={asHostedGame(view, view.playUrl)} />
      ) : (
        <div className="aspect-gb flex items-center justify-center rounded-lg border border-hairline bg-surface">
          <span className="flex flex-col items-center gap-3">
            <span className="loading-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="text-xs tracking-widest text-faint uppercase">
              {view.status === 'failed' ? 'It did not work' : 'Making it'}
            </span>
          </span>
        </div>
      )}

      {mine ? <Creator view={view} onChanged={setView} /> : <VisitorFooter />}
    </div>
  );
}

function Creator({
  view,
  onChanged,
}: {
  view: GameView;
  onChanged: (view: GameView) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const building = view.status === 'building';

  const ask = useCallback(
    async (request: string) => {
      const asked = request.trim();
      if (!asked || busy || building) return;
      setBusy(true);
      setProblem(null);
      try {
        const response = await fetch(`/api/games/${view.id}/changes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request: asked }),
        });
        if (!response.ok) throw new Error('no');
        setText('');
        // Show "making" immediately rather than on the next poll: the person
        // just pressed a button and needs to see that it landed.
        onChanged({ ...view, status: 'building' });
      } catch {
        setProblem('That change did not start. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [busy, building, onChanged, view],
  );

  const goBack = useCallback(
    async (body: Record<string, unknown>) => {
      setProblem(null);
      const response = await fetch(`/api/games/${view.id}/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setProblem('That version is not there to go back to.');
        return;
      }
      const refreshed = await fetch(`/api/games/${view.id}`, { cache: 'no-store' });
      if (refreshed.ok) onChanged((await refreshed.json()) as GameView);
    },
    [onChanged, view.id],
  );

  return (
    <section className="mt-6" data-testid="creator">
      {view.couldNotDo.length > 0 ? (
        <p className="mb-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted">
          Could not do: {view.couldNotDo.join('; ')}
        </p>
      ) : null}

      <h2 className="mb-2 text-xs tracking-widest text-faint uppercase">Change it</h2>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => void ask(chip)}
            disabled={busy || building}
            data-testid="change-chip"
            className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-lcd-deep hover:text-lcd disabled:opacity-40"
          >
            {chip}
          </button>
        ))}
      </div>

      <form
        className="mt-2.5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(text);
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="or say what to change…"
          maxLength={300}
          disabled={busy || building}
          data-testid="change-input"
          className="w-full rounded-full border border-hairline bg-surface px-4 py-2 text-sm text-foreground placeholder:text-faint focus:border-lcd-deep focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || building || !text.trim()}
          data-testid="change-submit"
          className="shrink-0 rounded-full border border-lcd-deep bg-lcd-deep/25 px-4 py-2 text-sm text-lcd transition-colors hover:bg-lcd-deep/40 disabled:opacity-40"
        >
          {building ? 'Making…' : 'Change it'}
        </button>
      </form>

      {problem ? <p className="mt-2 text-xs text-red-400">{problem}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ShareButton id={view.id} shareable={view.playUrl !== null} />
        {view.canUndo ? (
          <button
            type="button"
            onClick={() => void goBack({ undo: true })}
            data-testid="undo"
            className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
          >
            Undo last change
          </button>
        ) : null}
      </div>

      {view.changes.length > 1 ? (
        <ol className="mt-5 space-y-1.5" data-testid="changes">
          {view.changes.map((change) => (
            <li key={change.id} className="flex items-baseline gap-2 text-xs">
              <span
                className={
                  change.current ? 'text-lcd' : change.failed ? 'text-faint' : 'text-muted'
                }
              >
                {change.request}
              </span>
              {change.current ? (
                <span className="text-[0.65rem] tracking-widest text-faint uppercase">playing</span>
              ) : change.failed ? (
                <span className="text-[0.65rem] tracking-widest text-faint uppercase">
                  did not work
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void goBack({ changeId: change.id })}
                  className="text-[0.65rem] tracking-widest text-faint uppercase underline underline-offset-4 hover:text-lcd"
                >
                  play this one
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <Ask compact />
    </section>
  );
}

/**
 * Copying the link, not publishing it.
 *
 * The URL is stable and unlisted, and it always resolves to the last version
 * that worked — that is the pointer's job, so there is nothing to decide here.
 */
function ShareButton({ id, shareable }: { id: string; shareable: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      disabled={!shareable}
      data-testid="share"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(`${window.location.origin}/g/${id}`)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
      className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
      title={shareable ? 'Anyone with the link can play it' : 'Playable first, then shareable'}
    >
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

function VisitorFooter() {
  return (
    <section className="mt-8" data-testid="visitor">
      <p className="text-xs text-faint">Someone made this with GameBoyStudio.</p>
      <Ask compact />
    </section>
  );
}
