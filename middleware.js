// Runs BEFORE every matched request (pages and API) on the Edge runtime.
// Job: reject anyone without a valid session, and keep each role out of pages it has no business on.
// Fine-grained checks still happen in each API route via withAuth() -- never trust the UI alone.
import { NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from './lib/jwt';

// page prefix -> roles allowed to open it
const PAGE_ROLES = {
  '/dispatch': ['admin', 'dispatcher'],
  '/fleet': ['admin', 'dispatcher'],
  '/reports': ['admin', 'dispatcher'],
  '/patients': ['admin', 'hospital_staff'],
  '/hospitals': ['admin'],
};

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  // httpOnly cookie for the browser UI, or `Authorization: Bearer <jwt>` for API clients (curl / Postman)
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const session = await verifyToken(req.cookies.get(COOKIE_NAME)?.value || bearer);

  if (!session) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const rule = Object.entries(PAGE_ROLES).find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  if (rule && !rule[1].includes(session.role)) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  // everything except the login page, the login API, and static files
  matcher: ['/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)'],
};
