/**
 * How is my game doing, and what can I play?
 *
 * The only shape that crosses to the browser is `GameView`, which has no
 * revisions, no source paths and no build output in it by construction.
 */
import { NextResponse } from 'next/server';
import { getGame, isBuilding } from '@/lib/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = getGame(id);
  if (!game) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // A job in flight outranks the recorded status: the file says what the last
  // attempt did, the map says whether one is happening now.
  const status = isBuilding(id) ? 'building' : game.status;
  return NextResponse.json({ ...game, status }, { headers: { 'cache-control': 'no-store' } });
}
