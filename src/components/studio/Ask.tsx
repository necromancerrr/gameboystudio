'use client';

/**
 * The ask.
 *
 * Not a shelf, and not a page: it is the entry to the loop, so it belongs
 * wherever someone might want the next thing — including under a game they have
 * just finished playing.
 *
 * Asking does not navigate. A build takes tens of seconds, and being sent to a
 * waiting room makes that feel like a commitment; being left where you are
 * makes it feel free. The catalog is what makes that true, which is why
 * generation did not have to replace it.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMyGames } from './useMyGames';

const EXAMPLES = [
  'a memory game where you repeat a pattern',
  'dodge the falling rocks',
  'a two-player game where you collect coins',
];

export function Ask({ compact = false }: { compact?: boolean }) {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { remember } = useMyGames();
  const router = useRouter();

  const ask = useCallback(
    async (text: string) => {
      const asked = text.trim();
      if (!asked || busy) return;
      setBusy(true);
      setProblem(null);
      try {
        const response = await fetch('/api/games', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request: asked }),
        });
        if (!response.ok) throw new Error('no');
        const { id } = (await response.json()) as { id: string };
        remember(id);
        setRequest('');
        // Refresh rather than navigate: the making shelf appears where they
        // already are, and they can keep playing.
        router.refresh();
      } catch {
        setProblem('That did not start. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [busy, remember, router],
  );

  return (
    <section className={compact ? 'mt-8' : 'mb-7'} data-testid="ask">
      <label htmlFor="ask" className="text-sm text-muted">
        {compact ? 'Want something else?' : 'What do you want to play?'}
      </label>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(request);
        }}
      >
        <input
          id="ask"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="a game where…"
          maxLength={300}
          disabled={busy}
          data-testid="ask-input"
          className="w-full rounded-full border border-hairline bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-lcd-deep focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !request.trim()}
          data-testid="ask-submit"
          className="shrink-0 rounded-full border border-lcd-deep bg-lcd-deep/25 px-4 py-2.5 text-sm text-lcd transition-colors hover:bg-lcd-deep/40 disabled:opacity-40"
        >
          {busy ? 'Starting…' : 'Make it'}
        </button>
      </form>

      {!compact ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void ask(example)}
              disabled={busy}
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-muted"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {problem ? <p className="mt-2 text-xs text-red-400">{problem}</p> : null}
    </section>
  );
}
