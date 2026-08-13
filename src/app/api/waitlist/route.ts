import { NextResponse } from 'next/server';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';

  if (!EMAIL.test(email) || email.length > 254) {
    return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400 });
  }

  const endpoint = process.env.GBS_WAITLIST_ENDPOINT?.trim();
  if (!endpoint) {
    return NextResponse.json(
      { message: 'Early-access registration is not connected yet. Try again after launch setup.' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.GBS_WAITLIST_TOKEN
          ? { authorization: `Bearer ${process.env.GBS_WAITLIST_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ email, source: 'gameboystudio-landing' }),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[waitlist] endpoint rejected signup', response.status);
      return NextResponse.json({ message: 'Could not register this player yet.' }, { status: 502 });
    }

    return NextResponse.json({
      message: 'PLAYER REGISTERED — we’ll send the access signal when it is ready.',
    });
  } catch (error) {
    console.error('[waitlist] endpoint unavailable', error);
    return NextResponse.json({ message: 'Could not register this player yet.' }, { status: 502 });
  }
}
