import Image from 'next/image';
import { getPreview, type Game } from '@/catalog';
import { GamePreview } from '@/components/GamePreview';

/**
 * The visual tile for a game: a verified gameplay loop where one exists,
 * otherwise the curated screenshot. Shared by the library grid and the
 * Continue shelf so both stay consistent.
 */
export function GameThumb({
  game,
  priority = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px',
}: {
  game: Game;
  priority?: boolean;
  sizes?: string;
}) {
  const preview = getPreview(game);
  const cover = game.screenshots[0];

  if (preview) {
    return <GamePreview preview={preview} alt={`${game.title} gameplay`} eager={priority} />;
  }

  if (!cover) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-faint">
        No screenshot
      </div>
    );
  }

  return (
    <Image
      src={cover}
      alt=""
      fill
      sizes={sizes}
      priority={priority}
      className="pixelated object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}
