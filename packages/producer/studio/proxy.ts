import { NextResponse, type NextRequest } from 'next/server';
import { studioLandings, studioPages } from './generated/studio-map';

/**
 * A page record with group tabs opens on its first tab (Publisher's projected landing). Answering
 * that here makes it an HTTP redirect: inside the installed loading boundary the page's own
 * `redirect()` streams after the shell, as a 200 with a meta refresh and no page.
 */
export function proxy(request: NextRequest) {
  const record = studioPages.find(page => page.path === request.nextUrl.pathname);
  const landing = record && studioLandings[record.id];
  if (!record || !landing || landing === record.path) return NextResponse.next();
  const target = request.nextUrl.clone();
  target.pathname = landing;
  return NextResponse.redirect(target, 307);
}

/** Page requests only: Next's own assets are never a page record. */
export const config = { matcher: ['/((?!_next/).*)'] };
