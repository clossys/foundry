/** A validated, closed set of web origins permitted as redirect destinations. */
export interface AllowedOriginPolicy {
  readonly origins: readonly string[];
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function parseOrigin(value: string): string | undefined {
  if (value.includes("\\") || value !== value.trim()) return undefined;
  const url = parseHttpUrl(value);
  if (url === undefined || url.pathname !== "/" || url.search || url.hash) return undefined;
  return url.origin;
}

/**
 * Creates a strict allowlist of absolute HTTP(S) origins.
 *
 * Duplicate origins are tolerated and collapsed to their first occurrence —
 * an allowlist built from configuration (env vars with the same fallback
 * literal, merged lists, etc.) commonly contains repeats, and a set of
 * allowed origins is inherently a set. Only genuinely invalid entries
 * (non-string, malformed, empty, credential-bearing, or path/query-bearing)
 * throw.
 */
export function createAllowedOriginPolicy(allowedOrigins: readonly string[]): AllowedOriginPolicy {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError("An allowed-origin policy must contain at least one origin.");
  }

  const origins = allowedOrigins.map((origin) => {
    if (typeof origin !== "string") throw new TypeError("Allowed origins must be strings.");
    const parsed = parseOrigin(origin);
    if (parsed === undefined) throw new TypeError("Allowed origins must be absolute HTTP(S) origins without paths or credentials.");
    return parsed;
  });

  const deduped = [...new Set(origins)];
  return Object.freeze({ origins: Object.freeze(deduped) });
}

/** Returns true only for an HTTP(S), credential-free URL whose origin is allowlisted. */
export function isAllowedOrigin(origin: string, policy: AllowedOriginPolicy): boolean {
  if (typeof origin !== "string" || origin !== origin.trim() || origin.includes("\\") || !policy || !Array.isArray(policy.origins)) return false;
  const url = parseHttpUrl(origin);
  return url !== undefined && policy.origins.includes(url.origin);
}

function hasUnsafeTargetSyntax(target: string): boolean {
  return (
    target.length === 0 ||
    target !== target.trim() ||
    target.includes("\\") ||
    /%5c/i.test(target) ||
    target.startsWith("//")
  );
}

/**
 * Resolves an allowlisted absolute URL or an absolute-path target against an
 * explicit allowlisted base origin. It returns `undefined` for every
 * untrusted-input rejection rather than falling back to a potentially
 * caller-controlled value — never throwing on attacker-controlled `target`
 * content.
 *
 * `baseOrigin` is a different kind of input: it is caller-supplied, not
 * attacker-controlled, and it is mandatory whenever `target` is a
 * path-style target. Omitting it entirely for a path-style target is a
 * programming error, not a security outcome, so this throws a `TypeError`
 * in that case instead of returning the same `undefined` used for a
 * rejected target. When `baseOrigin` is present but is not itself an
 * allowlisted origin, that is a legitimate untrusted-input-style rejection
 * and still returns `undefined`, as does every other unsafe target.
 */
export function resolveSafeRedirect(
  target: string | null | undefined,
  policy: AllowedOriginPolicy,
  baseOrigin?: string,
): string | undefined {
  if (typeof target !== "string" || !policy || hasUnsafeTargetSyntax(target)) return undefined;

  const isPathTarget = target.startsWith("/");
  const isHttpTarget = /^https?:\/\//i.test(target);
  if (!isPathTarget && !isHttpTarget) return undefined;

  let base: string | undefined;
  if (isPathTarget) {
    if (baseOrigin === undefined) {
      throw new TypeError("resolveSafeRedirect requires baseOrigin for a path-style target.");
    }
    if (!isAllowedOrigin(baseOrigin, policy)) return undefined;
    base = baseOrigin;
  }

  try {
    const url = new URL(target, base);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    if (!policy.origins.includes(url.origin)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
