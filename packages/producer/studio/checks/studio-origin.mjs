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
