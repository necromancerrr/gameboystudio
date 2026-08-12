/**
 * Going back.
 *
 * Undo is "the previous version that worked", not "the previous revision" — a
 * failed attempt is never something you can land on.
 */
import { NextResponse } from 'next/server';
import { goBackTo, undoLastChange } from '@/lib/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { undo?: unknown; changeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  try {
    const result = body.undo
      ? undoLastChange(id)
      : goBackTo(id, typeof body.changeId === 'string' ? body.changeId : '');
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
