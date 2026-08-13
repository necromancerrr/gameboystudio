import { WaitlistLanding } from '@/components/WaitlistLanding';
import { ContinueShelf } from '@/components/ContinueShelf';
import { GameLibrary } from '@/components/GameLibrary';
import { getAllGames, getConsoles } from '@/catalog';
import styles from '@/components/WaitlistLanding.module.css';

export default function HomePage() {
  const games = getAllGames();

  return (
    <main className="flex-1">
      <WaitlistLanding />

      {/* The library the landing points at. Same page, same scroll — the
          Instant Contract still holds, so nothing here waits on the pitch. */}
      <section id="console" className={styles.library}>
        <div className={styles.libraryHeader}>
          <div>
            <p className={styles.eyebrow}>THE CONSOLE IS ALREADY ON</p>
            <h2>Play while we build what comes next.</h2>
          </div>
          <span>{games.length} GAMES / LIVE NOW</span>
        </div>

        {/* Above search: a returning player's intent is "resume", not "find
            something new". Renders nothing at all on a first visit. */}
        <ContinueShelf />

        <GameLibrary games={games} consoles={getConsoles()} />

        <footer className="mt-16 border-t border-hairline pt-6 text-xs text-faint">
          Every game here is published by its author under a license that permits
          redistribution. Each game page credits its creator and states its
          license.
        </footer>
      </section>
    </main>
  );
}
