/**
 * A generated game's page, and its share URL.
 *
 * `/g/<id>` rather than `/games/<slug>`: generated games are unlisted and
 * personal, and putting them under the catalog's route would be the first step
 * toward putting them in the catalog. They are a different kind of thing and
 * they get a different address.
 *
 * The page is a shell — everything below it polls, because a game can be being
 * made while it is being played.
 */

import type { Metadata } from 'next';
import { GamePage } from '@/components/studio/GamePage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your game',
  // Unlisted means unlisted: a shared link should not turn into a search result.
  robots: { index: false, follow: false },
};

export default async function GeneratedGamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-10">
      <GamePage id={id} />
    </div>
  );
}
