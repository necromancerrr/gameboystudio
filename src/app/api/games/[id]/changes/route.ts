/**
 * Asking for a change.
 *
 * Like asking for a game, this returns immediately. The game the person has
 * stays playable the entire time — D-024 guarantees it, and this endpoint never
 * touches the pointer.
 */
import { NextResponse } from 'next/server';
import { getGame, startChange } from '@/lib/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getGame(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: { request?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const asked = typeof body.request === 'string' ? body.request.trim() : '';
  if (!asked) return NextResponse.json({ error: 'say what to change' }, { status: 400 });
  if (asked.length > MAX_REQUEST) {
    return NextResponse.json({ error: 'that is a very long request' }, { status: 400 });
  }

  const started = startChange(id, asked);
  if (!started.ok) {
    return NextResponse.json({ error: started.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
