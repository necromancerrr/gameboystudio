import Link from 'next/link';
import { GameCard } from '@/components/GameCard';
import { CONSOLE_LABELS, getAllGames, getConsoles } from '@/catalog';
import type { ConsoleId } from '@/emulation/core/types';

function isConsoleId(value: string | undefined): value is ConsoleId {
  return value === 'GB' || value === 'GBC';
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ console?: string }>;
}) {
  const params = await searchParams;
  // Filtering through the URL keeps the library usable without client JS and
  // makes a filtered view linkable.
  const active = isConsoleId(params.console) ? params.console : null;

  const all = getAllGames();
  const games = active ? all.filter((game) => game.console === active) : all;
  const consoles = getConsoles();

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-8">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">GameBoyStudio</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted">
          Game Boy and Game Boy Color homebrew, playable in the browser. Every
          title here is published under a license that permits redistribution.
        </p>
      </header>

      <nav aria-label="Filter by console" className="mb-6 flex flex-wrap gap-2">
        <FilterLink href="/" active={active === null}>
          All {all.length}
        </FilterLink>
        {consoles.map((id) => (
          <FilterLink
            key={id}
            href={`/?console=${id}`}
            active={active === id}
          >
            {CONSOLE_LABELS[id]}{' '}
            {all.filter((game) => game.console === id).length}
          </FilterLink>
        ))}
      </nav>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
        {games.map((game, index) => (
          <li key={game.slug}>
            <GameCard game={game} priority={index < 5} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-lcd-deep bg-lcd-deep/25 text-lcd'
          : 'border-hairline text-muted hover:border-hairline-strong hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}
