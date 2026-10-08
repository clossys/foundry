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
    /[\u0000-\u001f\u007f]/.test(target) ||
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
    // `new URL` removes dot segments and encoded dots, so judge the normalised
    // path: a leading `//` here would be read as a different host if relativised.
    if (url.pathname.startsWith("//")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** The longest redirect target, and Location value, the hardened branch writes. */
export const MAX_HARDENED_LOCATION_LENGTH = 2048;

/** Options for {@link resolveHardenedRedirect}. Only own data properties are read. */
export interface HardenedRedirectOptions {
  /**
   * Same-host paths a target on the base origin must never name, each a plain
   * path such as `/sign-in`. A target is refused when any representation that
   * is inspected (as written, normalised, percent-decoded and case-folded) is
   * one of these paths or sits under it.
   */
  readonly excludedPaths?: readonly string[];
}

/** At most this many excluded paths. */
const MAX_EXCLUDED_PATHS = 16;
/** Printable ASCII without space: everything else is refused, never re-encoded. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
/** A percent sign not followed by two hex digits is malformed. */
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i;
/** Encoded slash, backslash, dot, percent sign or null: a second reading could differ from the first. */
const ENCODED_SEPARATOR = /%(?:2f|5c|2e|25|00)/i;
const AUTHORITY = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[0-9]{1,5})?$/i;
const ABSOLUTE_TARGET = /^(https?):\/\/([^/?#]*)([/?#].*)?$/i;
const PLAIN_EXCLUDED_PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,=:@-]+(?:\/[A-Za-z0-9._~!$&'()*+,=:@-]+)*)?$/;

/**
 * Reads an own data property. An accessor throws; an inherited property is
 * not read at all, so it can never carry authority.
 *
 * @internal Shared by the hardened Bouncer surfaces; not a root export.
 */
export function readOwnData(source: object, key: string, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new TypeError(`${name} must be a data property, not an accessor.`);
  return descriptor.value;
}

/**
 * Checks that `value` is a plain options object (its prototype is
 * `Object.prototype` or `null`).
 *
 * @internal
 */
export function assertPlainObject(value: unknown, name: string): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
}

/**
 * Copies a dense, plain array of at most `max` items, reading each index once
 * as an own data property. Holes, accessors, subclasses and over-long arrays
 * throw.
 *
 * @internal
 */
export function readDenseArray(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${name} must be a plain array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length: unknown = lengthDescriptor?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > max) {
    throw new TypeError(`${name} must hold at most ${max} items.`);
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError(`${name} must be a dense array of data items.`);
    copy.push(descriptor.value);
  }
  return copy;
}

/**
 * Validates a list of excluded same-host paths.
 *
 * @internal
 */
export function readExcludedPaths(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  return readDenseArray(value, name, MAX_EXCLUDED_PATHS).map((path) => {
    if (typeof path !== "string" || !PLAIN_EXCLUDED_PATH.test(path) || /\/\.{1,2}(?:\/|$)/.test(path)) {
      throw new TypeError(`${name} must hold plain same-host paths such as /sign-in.`);
    }
    return path;
  });
}

function decodeOnce(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Collapses repeated slashes and backslashes, then removes dot segments. */
function normalisePath(value: string): string | undefined {
  try {
    return new URL(value.replace(/[\\/]+/g, "/"), "http://normalise.invalid").pathname;
  } catch {
    return undefined;
  }
}

/** True when `path` is `excluded` or sits under it (`/`, or a `;` path parameter). */
function namesExcluded(path: string, excluded: string): boolean {
  if (excluded === "/") return path === "/" || path === "";
  return path === excluded || path.startsWith(`${excluded}/`) || path.startsWith(`${excluded};`);
}

/**
 * Every representation of `rawPath` a downstream reader could act on, or
 * `undefined` when one of them cannot be computed. Decoding and case folding
 * here only ever add reasons to refuse.
 */
function pathRepresentations(rawPath: string, parsedPath: string): string[] | undefined {
  const seen = new Set<string>([rawPath, parsedPath]);
  let current = parsedPath;
  for (let round = 0; round < 3; round += 1) {
    const decoded = decodeOnce(current);
    if (decoded === undefined) return undefined;
    if (decoded === current) break;
    seen.add(decoded);
    current = decoded;
  }
  if (/%[0-9a-f]{2}/i.test(current) && decodeOnce(current) !== current) return undefined;
  const representations: string[] = [];
  for (const value of seen) {
    const normalised = normalisePath(value);
    if (normalised === undefined) return undefined;
    representations.push(value, normalised, value.toLowerCase(), normalised.toLowerCase());
  }
  return representations;
}

/**
 * The hardened counterpart of {@link resolveSafeRedirect}: it resolves only a
 * target that every reader reads the same way, and returns `undefined` for
 * everything else, never throwing on the target.
 *
 * On top of the allowlist it refuses a target that is not printable ASCII;
 * carries any userinfo, even an empty one; has an authority other than a
 * plain host and optional port; has a malformed percent escape or an encoded
 * slash, backslash, dot, percent sign or null; is rewritten in any way by the
 * URL parser (dot segments, re-encoding, a dangling `?` or `#`); is longer
 * than {@link MAX_HARDENED_LOCATION_LENGTH}; or, on `baseOrigin`, names an
 * excluded path under any inspected representation. A sibling origin's own
 * paths are not subject to the exclusions.
 *
 * @throws {TypeError} only for a malformed `options`, which is configuration.
 */
export function resolveHardenedRedirect(
  target: string | null | undefined,
  policy: AllowedOriginPolicy,
  baseOrigin: string,
  options?: HardenedRedirectOptions,
): string | undefined {
  let excluded: string[] = [];
  if (options !== undefined) {
    assertPlainObject(options, "Hardened redirect options");
    excluded = readExcludedPaths(readOwnData(options, "excludedPaths", "excludedPaths"), "excludedPaths");
  }
  return resolveHardenedTarget(target, policy, baseOrigin, excluded);
}

/**
 * {@link resolveHardenedRedirect} with an exclusion list the caller has
 * already validated.
 *
 * @internal
 */
export function resolveHardenedTarget(
  target: string | null | undefined,
  policy: AllowedOriginPolicy,
  baseOrigin: string,
  excluded: readonly string[],
): string | undefined {
  if (typeof target !== "string" || target.length === 0 || target.length > MAX_HARDENED_LOCATION_LENGTH) return undefined;
  if (!policy || !Array.isArray(policy.origins) || !isAllowedOrigin(baseOrigin, policy)) return undefined;
  if (!PRINTABLE_ASCII.test(target) || target.includes("\\") || MALFORMED_ESCAPE.test(target)) return undefined;

  let rawAuthority: string | undefined;
  let rest: string;
  if (target.startsWith("/")) {
    if (target.startsWith("//")) return undefined;
    rest = target;
  } else {
    const match = ABSOLUTE_TARGET.exec(target);
    if (match === null) return undefined;
    rawAuthority = match[2] ?? "";
    rest = match[3] ?? "";
    if (rawAuthority.includes("@") || !AUTHORITY.test(rawAuthority)) return undefined;
  }

  const hashAt = rest.indexOf("#");
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const rawHash = hashAt === -1 ? "" : rest.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const rawPath = (queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)) || "/";
  const rawSearch = queryAt === -1 ? "" : beforeHash.slice(queryAt);
  if (ENCODED_SEPARATOR.test(rawPath)) return undefined;

  let url: URL;
  try {
    url = new URL(target, new URL(baseOrigin).origin);
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
  if (!policy.origins.includes(url.origin)) return undefined;
  if (rawAuthority !== undefined) {
    const lower = rawAuthority.toLowerCase();
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    if (lower !== url.host && lower !== `${url.hostname}:${defaultPort}`) return undefined;
  }
  if (url.pathname !== rawPath || url.search !== rawSearch || url.hash !== rawHash) return undefined;
  if (url.href.length > MAX_HARDENED_LOCATION_LENGTH) return undefined;

  if (url.origin === new URL(baseOrigin).origin && excluded.length > 0) {
    const representations = pathRepresentations(rawPath, url.pathname);
    if (representations === undefined) return undefined;
    for (const path of representations) {
      for (const exclusion of excluded) {
        if (namesExcluded(path, exclusion.toLowerCase()) || namesExcluded(path, exclusion)) return undefined;
      }
    }
  }
  return url.href;
}
