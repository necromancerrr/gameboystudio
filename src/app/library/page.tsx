import type { Metadata } from 'next';
import Link from 'next/link';
import { ContinueShelf } from '@/components/ContinueShelf';
import { GameLibrary } from '@/components/GameLibrary';
import { getAllGames, getConsoles } from '@/catalog';

export const metadata: Metadata = {
  title: 'Beta library',
  description: 'Explore playable browser originals and licensed homebrew in the GameDex Studio beta.',
};

export default function LibraryPage() {
  const games = getAllGames();
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-lcd">Playable beta</p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">GameDex Studio</h1>
          <p className="mt-1 text-sm text-muted">{games.length} games ready to play. Keyboard, controller, and supported touch controls.</p>
        </div>
        <Link href="/" className="shrink-0 rounded-full border border-hairline px-3 py-1.5 text-xs text-muted hover:text-lcd">Beta early access</Link>
      </header>
      <p className="mb-6 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-muted">
        This is the playable library beta. AI game creation is not available in the public beta yet.
      </p>
      <ContinueShelf />
      <GameLibrary games={games} consoles={getConsoles()} />
      <footer className="mt-16 border-t border-hairline pt-6 text-xs text-faint">
        Library games credit their creators and include license details on each game page.
      </footer>
    </div>
  );
}
