import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'ailive-auth';
const MAX_AGE = 60 * 60 * 24 * 30;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: Request) {
  const expected = process.env.AILIVE_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'AILIVE_PASSWORD not configured' }, { status: 503 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const supplied = body?.password ?? '';
  if (!timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'bad password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE
  });
  return res;
}
