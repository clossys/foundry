/**
 * Where a Studio request reaches Producer's API. The browser asks its own origin (Producer serves
 * Studio); a server render asks the origin Producer started the Studio child with, so a route can
 * render its data on first paint. Outside Producer there is no origin and the path stays relative.
 */
export function producerUrl(path: string): string {
  if (typeof window !== 'undefined') return path;
  const origin = process.env.CLOSSYS_PRODUCER_ORIGIN;
  return origin ? `${origin}${path}` : path;
}
