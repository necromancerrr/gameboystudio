import Link from 'next/link';
import { ContinueShelf } from '@/components/ContinueShelf';
import { GameLibrary } from '@/components/GameLibrary';
import { getAllGames, getConsoles } from '@/catalog';

export default function LibraryPage() {
  const games = getAllGames();

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-10">
      {/* Compact on purpose. The previous hero ate most of the first mobile
          screen and led with redistribution licensing, which no player cares
          about on arrival. It lives in the footer and on each game page. */}
      <header className="mb-4 flex items-start justify-between gap-4 sm:mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            GameBoyStudio
          </h1>
          <p className="mt-1 text-sm text-muted">
            {games.length} small games that start the moment you tap. Keyboard,
            controller, or right here on your phone.
          </p>
        </div>

        {/* The pitch for what is not built yet lives on its own page. The
            games here already play, so nothing gates the library. */}
        <Link
          href="/early-access"
          className="shrink-0 rounded-full border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:border-lcd-deep hover:text-lcd"
        >
          Early access
        </Link>
      </header>

      {/* Above search: a returning player's intent is "resume", not "find
          something new". Renders nothing at all on a first visit. */}
      <ContinueShelf />

      <GameLibrary games={games} consoles={getConsoles()} />

      <footer className="mt-16 border-t border-hairline pt-6 text-xs text-faint">
        Every game here is published by its author under a license that permits
        redistribution. Each game page credits its creator and states its
        license.
      </footer>
    </div>
  );
}
