'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GAMES, type Game } from '@/catalog';
import { matchRequest } from '@/catalog/matchRequest';
import { loadHostedGames } from '@/hosted/loadHostedGames';
import { useMyGames } from './useMyGames';

const EXAMPLES = [
  'a memory game where you repeat a pattern',
  'dodge the falling rocks',
  'a two-player game',
];

type Search = { request: string; matches: Game[]; incomplete: boolean; declined: boolean };

/** Search never creates a game. Creation is a separate, deliberate action. */
export function Ask({ compact = false }: { compact?: boolean }) {
  const inputId = useId();
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'search' | 'create' | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lock = useRef(false);
  const operation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const { remember } = useMyGames();
  const router = useRouter();

  useEffect(() => () => {
    operation.current += 1;
    abort.current?.abort();
  }, []);

  const find = useCallback(async (text: string) => {
    const asked = text.trim();
    if (!asked || lock.current) return;
    lock.current = true;
    const current = ++operation.current;
    const controller = new AbortController();
    abort.current = controller;
    setRequest(asked);
    setBusy('search');
    setSearch(null);
    setProblem(null);
    try {
      const hosted = await loadHostedGames(controller.signal);
      if (current !== operation.current) return;
      setSearch({ request: asked, matches: matchRequest([...GAMES, ...hosted.games], asked), incomplete: Boolean(hosted.problem), declined: false });
    } catch {
      if (current === operation.current) setProblem('The library search did not finish. Please try again.');
    } finally {
      if (current === operation.current) { lock.current = false; setBusy(null); }
    }
  }, []);

  const create = useCallback(async () => {
    if (!search || (search.matches.length > 0 && !search.declined) || lock.current) return;
    lock.current = true;
    const current = ++operation.current;
    setBusy('create');
    setProblem(null);
    try {
      const response = await fetch('/api/games', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: search.request }),
      });
      if (!response.ok) throw new Error('no');
      const { id } = (await response.json()) as { id: string };
      if (typeof id !== 'string' || !id) throw new Error('missing id');
      remember(id);
      if (current !== operation.current) return;
      setRequest('');
      setSearch(null);
      router.refresh();
    } catch {
      if (current === operation.current) setProblem('Creation could not start. You can keep playing the library and try again later.');
    } finally {
      if (current === operation.current) { lock.current = false; setBusy(null); }
    }
  }, [search, remember, router]);

  const canCreate = search && (search.matches.length === 0 || search.declined);
  return (
    <section className={compact ? 'mt-8' : 'mb-7'} data-testid="ask">
      <label htmlFor={inputId} className="text-sm text-muted">
        {compact ? 'What would you like to play next?' : 'Describe the game you have in mind'}
      </label>
      <p className="mt-1 text-xs text-faint">Search the library first. If nothing fits, try creating something new.</p>
      <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void find(request); }}>
        <input id={inputId} value={request} onChange={(event) => { setRequest(event.target.value); setSearch(null); setProblem(null); }}
          placeholder="a game where…" maxLength={300} disabled={Boolean(busy)} data-testid="ask-input"
          className="w-full rounded-full border border-hairline bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-lcd-deep focus:outline-none disabled:opacity-60" />
        <button type="submit" disabled={Boolean(busy) || !request.trim()} data-testid="ask-submit"
          className="shrink-0 rounded-full border border-lcd-deep bg-lcd-deep/25 px-4 py-2.5 text-sm text-lcd transition-colors hover:bg-lcd-deep/40 disabled:opacity-40">
          {busy === 'search' ? 'Searching…' : 'Find a game'}
        </button>
      </form>
      {!compact && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
        {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => void find(example)} disabled={Boolean(busy)}
          className="underline decoration-dotted underline-offset-4 transition-colors hover:text-muted">{example}</button>)}
      </div>}
      {search && <div className="mt-4 rounded-2xl border border-hairline p-4" data-testid="ask-results">
        <p className="text-sm" role="status">{canCreate ? 'No suitable match for your idea yet.' : 'These games may fit your idea. Try one now.'}</p>
        {search.incomplete && <p className="mt-1 text-xs text-muted">Some hosted games could not be checked. These results cover the available library.</p>}
        {!canCreate && <>
          <ul className="mt-3 space-y-2">{search.matches.slice(0, 5).map((game) => <li key={game.slug}>
            <Link href={`/games/${game.slug}`} className="text-sm text-lcd underline underline-offset-4">Play {game.title}</Link>
            <p className="mt-1 text-xs text-muted">{game.description}</p>
          </li>)}</ul>
          <button type="button" onClick={() => setSearch({ ...search, declined: true })} className="mt-3 text-xs text-muted underline underline-offset-4">None of these fit my idea</button>
        </>}
        {canCreate && <>
          <p className="mt-2 text-xs text-muted">Try experimental game creation, then play and ask for changes. AI generation needs a configured model; otherwise the builder supports a limited set of game patterns.</p>
          <button type="button" onClick={() => void create()} disabled={Boolean(busy)} data-testid="ask-create"
            className="mt-3 rounded-full border border-lcd-deep bg-lcd-deep/25 px-4 py-2 text-sm text-lcd disabled:opacity-40">{busy === 'create' ? 'Starting…' : 'Create this game'}</button>
        </>}
        <button type="button" disabled={Boolean(busy)} onClick={() => { setSearch(null); setProblem(null); }} className="ml-3 mt-3 text-xs text-muted underline underline-offset-4">Close</button>
      </div>}
      {problem && <p className="mt-2 text-xs text-red-400" role="alert">{problem}</p>}
    </section>
  );
}
