/**
 * The one Studio origin every rendered check uses: $STUDIO_ORIGIN when set, otherwise the single
 * local preview port (4503). A runner that starts its own Studio listens on this origin's port;
 * no check carries a port of its own.
 */
export const STUDIO_DEFAULT_ORIGIN = 'http://127.0.0.1:4503';

/** The origin (scheme, host, port) of $STUDIO_ORIGIN, or of the default when it is unset or empty. */
export function studioOrigin(env = process.env) {
  return new URL(env.STUDIO_ORIGIN || STUDIO_DEFAULT_ORIGIN).origin;
}

/** The port a self-started Studio listens on for that origin. */
export function studioPort(env = process.env) {
  const url = new URL(studioOrigin(env));
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

/**
 * The bound on the specimen site's build after a Studio start. Measured 2026-11-10: a cold start
 * served its first `/__specimen` 306 s after `produce` listened (load 7), so 900 s with headroom.
 */
export const SPECIMEN_READY_SECONDS = 900;

/**
 * Wait until the Studio's specimen routes answer. Every `/__specimen` response waits on the pinned
 * specimen site (one vite build per layer, cold after a start or a pin change), and a route that
 * frames a specimen cannot fire its load event before that, so a route timed during the build
 * reads as hung. A bare `/__specimen` answers (any HTTP status) only once that build settled.
 * Resolves to the wait in ms; rejects past the bound, so a site that never builds is a failure,
 * never skipped. The per-route bounds stay as they are: this only keeps the build out of them.
 */
export async function specimensReady(origin, { timeoutMs = SPECIMEN_READY_SECONDS * 1000, get = fetch, pause = 500 } = {}) {
  const start = Date.now();
  for (;;) {
    const left = timeoutMs - (Date.now() - start);
    if (left <= 0) throw new Error(`the specimen site at ${origin} did not answer /__specimen within ${timeoutMs / 1000} s`);
    try { await get(`${origin}/__specimen`, { signal: AbortSignal.timeout(Math.min(left, 30_000)) }); return Date.now() - start; }
    catch { await new Promise(accept => setTimeout(accept, Math.min(pause, Math.max(0, timeoutMs - (Date.now() - start))))); }
  }
}
