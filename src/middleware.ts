import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'ailive-auth';
const PUBLIC_PREFIXES = ['/api/', '/login', '/_next/', '/favicon', '/icon-', '/apple-touch', '/sw.js', '/manifest', '/design-x'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const password = process.env.AILIVE_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === password) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?from=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
