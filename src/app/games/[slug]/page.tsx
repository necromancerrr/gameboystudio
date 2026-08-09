import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GameBoyPlayer } from '@/components/GameBoyPlayer';
import { NativePlayerMount } from '@/components/NativePlayerMount';
import {
  CONSOLE_LABELS,
  getAllGames,
  getGameBySlug,
  getSeriesSiblings,
  isRetro,
  type Game,
} from '@/catalog';
import { GameCard } from '@/components/GameCard';

export function generateStaticParams() {
  return getAllGames().map((game) => ({ slug: game.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = getGameBySlug(slug);
  if (!game) return { title: 'Not found' };
  return {
    title: game.title,
    description:
      game.description ||
      `Play ${game.title} by ${game.developer} in your browser.`,
  };
}

/**
 * What a player needs to know before pressing play, in their words rather than
 * the manifest's. Nothing here names a runtime.
 */
function playerFacts(game: Game): string[] {
  const facts: string[] = [];
  if (game.players.min > 1) facts.push(`${game.players.min} players`);
  else if (game.players.max > 1) facts.push(`Up to ${game.players.max} players`);
  if (game.saves) facts.push('Saves your progress');
  if (!game.inputs.supported.includes('touch')) facts.push('Controller or keyboard');
  return facts;
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = getGameBySlug(slug);
  if (!game) notFound();

  const extraShots = game.screenshots.slice(1);
  const siblings = getSeriesSiblings(game);
  const original = !isRetro(game);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <span aria-hidden="true">&larr;</span> Library
      </Link>

      <div className="mt-6">
        {isRetro(game) ? (
          <GameBoyPlayer
            source={{
              romUrl: game.entry,
              console: game.console,
              saveKey: game.slug,
            }}
            title={game.title}
          />
        ) : (
          <NativePlayerMount
            entry={game.entry}
            slug={game.slug}
            title={game.title}
            players={game.players}
            supportsTouch={game.inputs.supported.includes('touch')}
          />
        )}
      </div>

      <article className="mt-10 border-t border-hairline pt-8">
        <header>
          {original ? (
            <p
              data-testid="original-badge"
              className="mb-2 font-mono text-[11px] tracking-[0.14em] text-lcd uppercase"
            >
              GameBoyStudio Original
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">{game.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {game.developer}
            {game.year ? ` · ${game.year}` : ''}
            {game.console ? ` · ${CONSOLE_LABELS[game.console]}` : ''}
          </p>
        </header>

        {game.description ? (
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted">
            {game.description}
          </p>
        ) : null}

        <ul className="mt-5 flex flex-wrap gap-1.5">
          {game.genre.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted"
            >
              {tag}
            </li>
          ))}
          {playerFacts(game).map((fact) => (
            <li
              key={fact}
              className="rounded-full border border-lcd-deep px-2.5 py-0.5 text-xs text-lcd"
            >
              {fact}
            </li>
          ))}
        </ul>

        {extraShots.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-faint uppercase">
              Screenshots
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {extraShots.map((shot) => (
                <li
                  key={shot}
                  className="aspect-gb relative overflow-hidden rounded border border-hairline bg-black"
                >
                  <Image
                    src={shot}
                    alt={`${game.title} screenshot`}
                    fill
                    sizes="(max-width: 640px) 50vw, 240px"
                    className="pixelated object-cover"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {siblings.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-faint uppercase">
              More in the {game.series} series
            </h2>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {siblings.map((sibling) => (
                <li key={sibling.slug}>
                  <GameCard game={sibling} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Attribution is a licence obligation for MIT and CC-BY-SA, not a
            nicety. An Original is ours, so the redistribution note that makes
            sense for a hosted ROM would be nonsense here. */}
        <footer className="mt-10 rounded-lg border border-hairline bg-surface p-4">
          {original ? (
            <>
              <h2 className="text-xs font-medium tracking-wide text-faint uppercase">
                About this game
              </h2>
              <p className="mt-3 text-sm text-muted">
                Made by GameBoyStudio, for GameBoyStudio. It runs in the browser
                with nothing to install and nothing to sign up for, like
                everything else in the library.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xs font-medium tracking-wide text-faint uppercase">
                License &amp; attribution
              </h2>
              <dl className="mt-3 grid gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
                <dt className="text-muted">License</dt>
                <dd className="font-mono text-xs text-foreground sm:text-sm">
                  {game.license}
                </dd>
                <dt className="text-muted">Author</dt>
                <dd>{game.attribution}</dd>
                {game.sourceUrl ? (
                  <>
                    <dt className="text-muted">Source</dt>
                    <dd>
                      <a
                        href={game.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all text-lcd underline-offset-2 hover:underline"
                      >
                        {game.sourceUrl}
                      </a>
                    </dd>
                  </>
                ) : null}
              </dl>
              <p className="mt-3 text-xs text-faint">
                Distributed under the terms above. GameBoyStudio hosts only ROMs
                whose license permits redistribution.
              </p>
            </>
          )}
        </footer>
      </article>
    </div>
  );
}
