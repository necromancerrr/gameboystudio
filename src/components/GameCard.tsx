import Link from 'next/link';
import type { Game } from '@/catalog';
import { GameThumb } from '@/components/GameThumb';

/**
 * Homebrew has no box art, so the card is built around the thing that does
 * exist: gameplay. Framing every tile at the Game Boy's own aspect ratio makes
 * the grid read as deliberate rather than as missing covers.
 */
export function GameCard({ game, priority = false }: { game: Game; priority?: boolean }) {
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-lcd"
    >
      <div className="aspect-gb relative overflow-hidden rounded-lg border border-hairline bg-black transition-colors group-hover:border-hairline-strong">
        <GameThumb game={game} priority={priority} />
        {/* One badge slot, two meanings: which console a game came from, or
            that it came from us. */}
        <span className="absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-lcd backdrop-blur-sm">
          {game.console ?? 'ORIGINAL'}
        </span>
        {game.players.min > 1 ? (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-amber-300 backdrop-blur-sm">
            2P
          </span>
        ) : null}
      </div>

      <div className="mt-2.5">
        <h3 className="truncate text-sm font-medium text-foreground group-hover:text-lcd">
          {game.title}
        </h3>
        <p className="truncate text-xs text-muted">{game.developer}</p>
        {game.series ? (
          <p className="mt-0.5 truncate text-[11px] text-faint">{game.series} series</p>
        ) : null}
      </div>
    </Link>
  );
}
