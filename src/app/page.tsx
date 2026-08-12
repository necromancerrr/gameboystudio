import { ContinueShelf } from '@/components/ContinueShelf';
import { StudioHome } from '@/components/studio/Home';
import { GameLibrary } from '@/components/GameLibrary';
import { getAllGames, getConsoles } from '@/catalog';

export default function LibraryPage() {
  const games = getAllGames();

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-10">
      {/* Compact on purpose. The previous hero ate most of the first mobile
          screen and led with redistribution licensing, which no player cares
          about on arrival. It lives in the footer and on each game page. */}
      <header className="mb-4 sm:mb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          GameBoyStudio
        </h1>
        <p className="mt-1 text-sm text-muted">
          Ask for a game and play it in seconds — or pick one of{' '}
          {games.length} that start the moment you tap.
        </p>
      </header>

      {/* Shelves are ranked rather than positioned, so the catalog leads a
          first visit and recedes once someone has games of their own — without
          this file being rewritten. See components/studio/shelves.ts. */}
      <StudioHome
        continueShelf={<ContinueShelf />}
        library={<GameLibrary games={games} consoles={getConsoles()} />}
      />

      <footer className="mt-16 border-t border-hairline pt-6 text-xs text-faint">
        Every game here is published by its author under a license that permits
        redistribution. Each game page credits its creator and states its
        license.
      </footer>
    </div>
  );
}
