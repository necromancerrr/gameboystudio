import { WaitlistLanding } from '@/components/WaitlistLanding';
import { ContinueShelf } from '@/components/ContinueShelf';
import { StudioHome } from '@/components/studio/Home';
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
            <h2>Ask for a game, or play one that is already here.</h2>
          </div>
          <span>{games.length} GAMES / LIVE NOW</span>
        </div>

        {/* Where the pitch above becomes something you can use: that one asks
            for an email, this asks for a game and hands one back. The ask is
            the entry to the loop, so it leads the live section rather than
            sitting inside the marketing.

            Everything below it is ranked rather than positioned — the catalog
            leads a first visit and recedes once someone has games of their own,
            and Continue outranks both for a returning player. Handing the two
            shelves in as props keeps that ordering in one small file instead of
            in this markup. See components/studio/shelves.ts. */}
        <StudioHome
          continueShelf={<ContinueShelf />}
          library={<GameLibrary games={games} consoles={getConsoles()} />}
        />

        <footer className="mt-16 border-t border-hairline pt-6 text-xs text-faint">
          Every game here is published by its author under a license that permits
          redistribution. Each game page credits its creator and states its
          license.
        </footer>
      </section>
    </main>
  );
}
