/**
 * Asking for a game.
 *
 * Returns as soon as the work has started, not when it is finished. That is the
 * whole shape of the feature: a person asks, gets an id, and goes back to
 * playing something while their game is built.
 */
import { NextResponse } from 'next/server';
import { listGames, startNewGame } from '@/lib/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A request longer than this is not a game description. */
const MAX_REQUEST = 300;

export async function GET() {
  return NextResponse.json({ games: listGames() });
}

export async function POST(request: Request) {
  let body: { request?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const asked = typeof body.request === 'string' ? body.request.trim() : '';
  if (!asked) return NextResponse.json({ error: 'say what you want to play' }, { status: 400 });
  if (asked.length > MAX_REQUEST) {
    return NextResponse.json({ error: 'that is a very long request' }, { status: 400 });
  }

  return NextResponse.json(startNewGame(asked), { status: 202 });
}
