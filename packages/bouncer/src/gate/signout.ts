/**
 * A generic Fetch sign-out endpoint. Framework-neutral: it reads a Fetch
 * `Request` and answers with a Fetch `Response`. The identity provider is a
 * seam (`signOut`); nothing here imports a provider or a framework.
 *
 * Decisions, in order:
 *   1. GET or HEAD answers an empty `303` to the configured confirmation page
 *      with `no-store`. It reads nothing from the provider and changes no
 *      cookie, so a link, prefetch or image can never sign anyone out.
 *   2. Any method other than GET, HEAD or POST answers `405`.
 *   3. A POST is checked for origin before its body, cookies, session or
 *      provider are touched. A present, non-`null` `Origin` must equal the
 *      configured origin exactly; a missing or `null` one is accepted only
 *      with `Sec-Fetch-Site: same-origin`. Anything else answers `403`. The
 *      body is never read, so a native form post and a `fetch` post are
 *      handled alike.
 *   4. An accepted POST reserves its local cleanup first, then runs the
 *      provider under one fixed {@link SIGN_OUT_DEADLINE_MS} deadline that
 *      covers everything the provider does. Whatever happens (success,
 *      error, timeout) it answers exactly one `303`: to the terminal page
 *      when the provider finished in time, otherwise to the fallback page.
 *      Both carry the same cleanup. Nothing in the response claims that the
 *      remote session was revoked.
 *
 * Local cleanup is `Clear-Site-Data: "cache", "storage"` (never `"cookies"`,
 * which would reach every host of the site) and one expiring `Set-Cookie`
 * per configured cookie name and scope. Scopes come only from configuration:
 * no request header ever chooses a domain. A rule may also expire
 * `<name>_<suffix>` cookies the request carries; those are bounded, and an
 * oversized or overfull request skips them (and provider verification)
 * rather than claiming complete removal.
 *
 * Every target is validated at construction, including that none of them is
 * this endpoint (at any representation), so the endpoint never loops on
 * itself. Every option is read once, as an own data property of a plain
 * object; arrays must be dense and plain.
 *
 * The deadline is a timer: it bounds asynchronous work only. A provider
 * callback that blocks synchronously cannot be preempted and must itself be
 * bounded.
 */
import { applyGatedHostHeaders } from "../host-responses.js";
import {
  assertPlainObject,
  createAllowedOriginPolicy,
  readDenseArray,
  readExcludedPaths,
  readOwnData,
  resolveHardenedTarget,
} from "../redirect.js";

/** The fixed whole deadline of a sign-out POST, in milliseconds. */
export const SIGN_OUT_DEADLINE_MS = 5000;

/** The exact `Clear-Site-Data` value of a sign-out. Never `"cookies"`. */
export const SIGN_OUT_CLEAR_SITE_DATA = '"cache", "storage"';

const LIMITS = Object.freeze({
  cookieHeaderBytes: 16384,
  cookieNameLength: 256,
  suffixLength: 64,
  rules: 16,
  dynamicNames: 16,
  scopesPerRule: 4,
  expiryTuples: 128,
  setCookieBytes: 32768,
});

/** Where a cookie is expired. Omit `domain` for a host-only cookie. */
export interface SignOutCookieScope {
  /** The host itself or one of its parent domains, lower-case, with no leading dot. */
  readonly domain?: string;
  /** Default `/`. */
  readonly path?: string;
}

/** A cookie the sign-out expires. */
export interface SignOutCookieRule {
  /** Exact cookie name, expired on every sign-out whether or not the request carries it. */
  readonly name: string;
  /** Also expire `<name>_<suffix>` cookies the request carries (suffix of 1–64 `[A-Za-z0-9_-]`). Default false. */
  readonly matchSuffixes?: boolean;
  /** At most 4. Default: host-only, path `/`. */
  readonly scopes?: readonly SignOutCookieScope[];
}

/** What the provider callback receives. */
export interface SignOutContext {
  readonly request: Request;
  /** Aborted when the deadline passes or the response has been decided. */
  readonly signal: AbortSignal;
  /** Request cookies read within bounds, or `undefined` when the request was over a bound: verification is then skipped. */
  readonly cookies: ReadonlyMap<string, string> | undefined;
  /** Milliseconds left before the deadline; 0 once the response has been decided. */
  remainingMs(): number;
  /** False once the deadline has passed or the response has been decided. Check it before every further step. */
  isActive(): boolean;
}

export interface SignOutHandlerOptions {
  /** This endpoint's own public origin, from configuration. The only `Origin` a POST may carry. */
  readonly origin: string;
  /** This endpoint's own path, such as `/sign-out`. No target may name it or anything under it. */
  readonly path: string;
  /** Same-host page a GET or HEAD is sent to; it should render a form that POSTs here. */
  readonly confirmationPath: string;
  /** Same-host page after a sign-out the provider finished in time. Default `/`; required when `/` is excluded. */
  readonly terminalPath?: string;
  /** Same-host page after a provider error or timeout. Default `terminalPath`. */
  readonly fallbackPath?: string;
  /** Further same-host paths no target may name. At most 16. */
  readonly excludedPaths?: readonly string[];
  /** Cookies to expire. At least one rule, at most 16. */
  readonly cookies: readonly SignOutCookieRule[];
  /** Signs the session out with the provider. Runs under the deadline; a throw or rejection selects the fallback. */
  readonly signOut: (context: SignOutContext) => void | Promise<void>;
}

export type SignOutHandler = (request: Request) => Promise<Response>;

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SUFFIX = /^[A-Za-z0-9_-]+$/;
const COOKIE_PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,=:@-]+(?:\/[A-Za-z0-9._~!$&'()*+,=:@-]+)*)?$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const EXPIRES = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0";
const ALLOW = "GET, HEAD, POST";

interface Scope {
  readonly domain: string | undefined;
  readonly path: string;
}

interface Rule {
  readonly name: string;
  readonly matchSuffixes: boolean;
  readonly scopes: readonly Scope[];
}

function isIpHost(hostname: string): boolean {
  return hostname.startsWith("[") || /^[0-9.]+$/.test(hostname);
}

function readScope(input: unknown, hostname: string, name: string): Scope {
  assertPlainObject(input, "cookie scope");
  const domain = readOwnData(input, "domain", "domain");
  const path = readOwnData(input, "path", "path") ?? "/";
  if (typeof path !== "string" || !COOKIE_PATH.test(path) || /\/\.{1,2}(?:\/|$)/.test(path)) {
    throw new TypeError("A cookie scope path must be a plain path such as /.");
  }
  if (domain !== undefined) {
    if (typeof domain !== "string" || !DOMAIN.test(domain) || isIpHost(hostname) || /^[0-9.]+$/.test(domain)) {
      throw new TypeError("A cookie scope domain must be a lower-case host name.");
    }
    if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
      throw new TypeError("A cookie scope domain must be the configured host or one of its parent domains.");
    }
  }
  if (name.startsWith("__Host-") && (domain !== undefined || path !== "/")) {
    throw new TypeError("A __Host- cookie can only be expired host-only at path /.");
  }
  return Object.freeze({ domain: domain as string | undefined, path });
}

function readRule(input: unknown, hostname: string, secure: boolean): Rule {
  assertPlainObject(input, "cookie rule");
  const name = readOwnData(input, "name", "name");
  if (typeof name !== "string" || name.length === 0 || name.length > LIMITS.cookieNameLength || !COOKIE_NAME.test(name)) {
    throw new TypeError(`A cookie name must be 1-${LIMITS.cookieNameLength} cookie token characters.`);
  }
  if ((name.startsWith("__Host-") || name.startsWith("__Secure-")) && !secure) {
    throw new TypeError("A __Host- or __Secure- cookie needs an https origin.");
  }
  const matchSuffixes = readOwnData(input, "matchSuffixes", "matchSuffixes") ?? false;
  if (typeof matchSuffixes !== "boolean") throw new TypeError("matchSuffixes must be a boolean.");
  const scopesInput = readOwnData(input, "scopes", "scopes");
  const scopes =
    scopesInput === undefined
      ? [Object.freeze({ domain: undefined, path: "/" })]
      : readDenseArray(scopesInput, "scopes", LIMITS.scopesPerRule).map((scope) => readScope(scope, hostname, name));
  if (scopes.length === 0) throw new TypeError("A cookie rule needs at least one scope.");
  return Object.freeze({ name, matchSuffixes, scopes: Object.freeze(scopes) });
}

function expiry(name: string, scope: Scope, secure: boolean): string {
  return `${name}=; Path=${scope.path}; ${EXPIRES}${scope.domain === undefined ? "" : `; Domain=${scope.domain}`}${secure ? "; Secure" : ""}`;
}

function tupleKey(name: string, scope: Scope): string {
  return `${name}\n${scope.domain ?? ""}\n${scope.path}`;
}

interface Cleanup {
  readonly values: readonly string[];
  /** False when a bound was reached: dynamic cleanup stopped early and verification is skipped. */
  readonly withinBounds: boolean;
  readonly cookies: ReadonlyMap<string, string> | undefined;
}

function readCookieHeader(header: string | null): Map<string, string> | undefined {
  const cookies = new Map<string, string>();
  if (header === null) return cookies;
  if (header.length > LIMITS.cookieHeaderBytes) return undefined;
  for (const part of header.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) continue;
    const name = part.slice(0, equals).trim();
    if (name.length === 0 || name.length > LIMITS.cookieNameLength || !COOKIE_NAME.test(name)) continue;
    if (!cookies.has(name)) cookies.set(name, part.slice(equals + 1).trim());
  }
  return cookies;
}

/**
 * Creates the sign-out endpoint. Use the result for GET, HEAD and POST (and
 * any other method, which it refuses).
 *
 * @throws {TypeError} when an option is missing, malformed, inherited or an
 * accessor, when a target names this endpoint or an excluded path, or when
 * the unconditional cleanup would not fit its bounds. Messages name the
 * option, never its value.
 */
export function createSignOutHandler(options: SignOutHandlerOptions): SignOutHandler {
  assertPlainObject(options, "Sign-out options");
  const originInput = readOwnData(options, "origin", "origin");
  const pathInput = readOwnData(options, "path", "path");
  const signOut = readOwnData(options, "signOut", "signOut");
  if (typeof originInput !== "string") throw new TypeError("origin must be an http(s) origin string.");
  const policy = createAllowedOriginPolicy([originInput]);
  const origin = policy.origins[0] as string;
  const { hostname, protocol } = new URL(origin);
  const secure = protocol === "https:";
  if (typeof signOut !== "function") throw new TypeError("signOut must be a function.");
  const [path] = readExcludedPaths([pathInput], "path");
  if (path === undefined || path === "/") throw new TypeError("path must be a plain same-host path other than /.");
  const excluded = [path, ...readExcludedPaths(readOwnData(options, "excludedPaths", "excludedPaths"), "excludedPaths")];

  const target = (value: unknown, name: string): string => {
    if (typeof value !== "string" || !value.startsWith("/")) throw new TypeError(`${name} must be a same-host path.`);
    const resolved = resolveHardenedTarget(value, policy, origin, excluded);
    if (resolved === undefined || new URL(resolved).origin !== origin) {
      throw new TypeError(`${name} must be a plain same-host path that is not this endpoint or an excluded path.`);
    }
    return resolved;
  };
  const confirmation = target(readOwnData(options, "confirmationPath", "confirmationPath"), "confirmationPath");
  const terminalInput = readOwnData(options, "terminalPath", "terminalPath");
  if (terminalInput === undefined && excluded.includes("/")) throw new TypeError("Excluding / requires an explicit terminalPath.");
  const terminal = target(terminalInput ?? "/", "terminalPath");
  const fallbackInput = readOwnData(options, "fallbackPath", "fallbackPath");
  const fallback = fallbackInput === undefined ? terminal : target(fallbackInput, "fallbackPath");

  const rules = readDenseArray(readOwnData(options, "cookies", "cookies"), "cookies", LIMITS.rules).map((rule) =>
    readRule(rule, hostname, secure),
  );
  if (rules.length === 0) throw new TypeError("cookies must name at least one cookie, such as the session cookie.");

  // The unconditional cleanup is reserved first and must fit on its own.
  const reservedKeys = new Set<string>();
  const reserved: string[] = [];
  let reservedBytes = 0;
  for (const rule of rules) {
    for (const scope of rule.scopes) {
      const key = tupleKey(rule.name, scope);
      if (reservedKeys.has(key)) continue;
      reservedKeys.add(key);
      const value = expiry(rule.name, scope, secure);
      reserved.push(value);
      reservedBytes += value.length;
    }
  }
  if (reserved.length > LIMITS.expiryTuples || reservedBytes > LIMITS.setCookieBytes) {
    throw new TypeError("The configured cookie cleanup does not fit the Set-Cookie bounds.");
  }
  const suffixRules = rules.filter((rule) => rule.matchSuffixes);

  const cleanupFor = (request: Request): Cleanup => {
    const cookies = readCookieHeader(request.headers.get("cookie"));
    if (cookies === undefined) return { values: reserved, withinBounds: false, cookies: undefined };
    const values = [...reserved];
    const keys = new Set(reservedKeys);
    let bytes = reservedBytes;
    let names = 0;
    for (const name of cookies.keys()) {
      const tuples: { key: string; value: string }[] = [];
      for (const rule of suffixRules) {
        if (!name.startsWith(`${rule.name}_`)) continue;
        const suffix = name.slice(rule.name.length + 1);
        if (suffix.length === 0 || suffix.length > LIMITS.suffixLength || !SUFFIX.test(suffix)) continue;
        for (const scope of rule.scopes) {
          const key = tupleKey(name, scope);
          if (keys.has(key) || tuples.some((tuple) => tuple.key === key)) continue;
          tuples.push({ key, value: expiry(name, scope, secure) });
        }
      }
      if (tuples.length === 0) continue;
      names += 1;
      const added = tuples.reduce((sum, tuple) => sum + tuple.value.length, 0);
      if (names > LIMITS.dynamicNames || values.length + tuples.length > LIMITS.expiryTuples || bytes + added > LIMITS.setCookieBytes) {
        return { values, withinBounds: false, cookies: undefined };
      }
      for (const tuple of tuples) {
        keys.add(tuple.key);
        values.push(tuple.value);
      }
      bytes += added;
    }
    return { values, withinBounds: true, cookies };
  };

  const empty = (status: number, headers: Record<string, string>): Response =>
    applyGatedHostHeaders(new Response(null, { status, headers: { ...headers, "Cache-Control": "no-store" } }), { noStore: true });

  const originAccepted = (request: Request): boolean => {
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin !== null && requestOrigin !== "null") return requestOrigin === origin;
    return request.headers.get("sec-fetch-site") === "same-origin";
  };

  const runProvider = async (request: Request, cookies: ReadonlyMap<string, string> | undefined): Promise<boolean> => {
    const startedAt = Date.now();
    const deadlineAt = startedAt + SIGN_OUT_DEADLINE_MS;
    const controller = new AbortController();
    let decided = false;
    const isActive = () => !decided && Date.now() < deadlineAt;
    const context: SignOutContext = Object.freeze({
      request,
      signal: controller.signal,
      cookies,
      remainingMs: () => (isActive() ? deadlineAt - Date.now() : 0),
      isActive,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), SIGN_OUT_DEADLINE_MS);
    });
    let work: Promise<boolean>;
    try {
      work = Promise.resolve((signOut as SignOutHandlerOptions["signOut"])(context)).then(
        () => true,
        () => false,
      );
    } catch {
      work = Promise.resolve(false);
    }
    try {
      const finished = await Promise.race([work, timeout]);
      return finished && Date.now() < deadlineAt;
    } finally {
      decided = true;
      clearTimeout(timer);
      controller.abort();
    }
  };

  return async (request) => {
    const method = request.method;
    if (method === "GET" || method === "HEAD") return empty(303, { Location: confirmation });
    if (method !== "POST") return empty(405, { Allow: ALLOW });
    if (!originAccepted(request)) return empty(403, {});

    const cleanup = cleanupFor(request);
    const completed = await runProvider(request, cleanup.withinBounds ? cleanup.cookies : undefined);
    const headers = new Headers({
      Location: completed ? terminal : fallback,
      "Cache-Control": "no-store",
      "Clear-Site-Data": SIGN_OUT_CLEAR_SITE_DATA,
    });
    for (const value of cleanup.values) headers.append("Set-Cookie", value);
    return applyGatedHostHeaders(new Response(null, { status: 303, headers }), { noStore: true });
  };
}
