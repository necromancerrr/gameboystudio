import Image from 'next/image';
import Link from 'next/link';
import { getPreview, type Game } from '@/catalog';
import { GamePreview } from '@/components/GamePreview';

/**
 * Homebrew has no box art, so the card is built around the thing that does
 * exist: a screen grab. Framing every tile at the Game Boy's own aspect ratio
 * makes the grid read as deliberate rather than as missing covers.
 *
 * Gameplay preview loops replace the static image in the next step.
 */
export function GameCard({ game, priority = false }: { game: Game; priority?: boolean }) {
  const cover = game.screenshots[0];
  const preview = getPreview(game);

  return (
    <Link
      href={`/games/${game.slug}`}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-lcd"
    >
      <div className="aspect-gb relative overflow-hidden rounded-lg border border-hairline bg-black transition-colors group-hover:border-hairline-strong">
        {preview ? (
          <GamePreview preview={preview} alt={`${game.title} gameplay`} eager={priority} />
        ) : cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
            priority={priority}
            className="pixelated object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-faint">
            No screenshot
          </div>
        )}

        <span className="absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-lcd backdrop-blur-sm">
          {game.console}
        </span>
      </div>

      <div className="mt-2.5">
        <h3 className="truncate text-sm font-medium text-foreground group-hover:text-lcd">
          {game.title}
        </h3>
        <p className="truncate text-xs text-muted">{game.developer}</p>
        {game.series ? (
          <p className="mt-0.5 truncate text-[11px] text-faint">
            {game.series} series
          </p>
        ) : null}
      </div>
    </Link>
  );
}
