import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GameBoyPlayer } from '@/components/GameBoyPlayer';
import { CONSOLE_LABELS, getAllGames, getGameBySlug } from '@/catalog';

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

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = getGameBySlug(slug);
  if (!game) notFound();

  const extraShots = game.screenshots.slice(1);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <span aria-hidden="true">&larr;</span> Library
      </Link>

      <div className="mt-6">
        <GameBoyPlayer
          source={{
            romUrl: game.romPath,
            console: game.console,
            saveKey: game.slug,
          }}
          title={game.title}
        />
      </div>

      <article className="mt-10 border-t border-hairline pt-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{game.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {game.developer}
            {game.year ? ` · ${game.year}` : ''} ·{' '}
            {CONSOLE_LABELS[game.console]}
          </p>
        </header>

        {game.description ? (
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted">
            {game.description}
          </p>
        ) : null}

        {game.genre.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-1.5">
            {game.genre.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

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

        {/* Attribution is a licence obligation for MIT and CC-BY-SA, not a nicety. */}
        <footer className="mt-10 rounded-lg border border-hairline bg-surface p-4">
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
        </footer>
      </article>
    </div>
  );
}
