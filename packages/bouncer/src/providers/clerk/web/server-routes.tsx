import { assertPlainObject, createAllowedOriginPolicy, readDenseArray, readOwnData, resolveSafeRedirect, utf8ByteLength } from "../../../redirect.js";
import { createSignOutHandler, type SignOutContext, type SignOutCookieRule } from "../../../gate/signout.js";
import { auth, clerkClient, verifyToken } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { ReactNode } from "react";
import { ClerkSignInBlock, type ClerkSignInProps } from "./client.js";
import { devAuthBypassIsKeyless } from "./dev-bypass.js";
import { createMissingSettingsReporter } from "./missing-settings.js";
import { assertPeerVersion } from "../../../internal/peer-version.js";
import { resolveInstalledPeerVersion } from "../../../internal/resolve-installed-peer-version.js";

/**
 * `@clerk/nextjs` and `next` are two of this package's optional peers
 * (see package.json's `peerDependenciesMeta`). This is this package's
 * "server" subpath (published as `./providers/clerk/web/server`,
 * `foundryReleaseVerification.next.serverSubpaths` in package.json),
 * reachable ONLY through `web/server.ts` — a separate file from
 * `web/index.ts` (the CLIENT subpath, `./providers/clerk/web`, which
 * re-exports exclusively from `./client.js` and never touches this
 * module). Being genuinely Node-context, never bundled for the browser,
 * makes it safe for `resolve-installed-peer-version.ts`'s
 * `node:module`/`node:fs`-based resolver — the edge-safe
 * `proxy.ts`/`proxy-entry.ts` and the browser-side `client.tsx`
 * deliberately import only the pure `peer-version.js` (see those files'
 * own comments; see `peer-version.ts`'s own header for why that split
 * exists at all). An absent or out-of-range peer here previously
 * surfaced as whatever `@clerk/nextjs/server`'s own call surface happened
 * to crash on, with nothing naming a version range as the cause. Both
 * declared-range constants must match package.json's `peerDependencies`
 * exactly, confirmed directly by this package's own (unshipped) test
 * suite.
 */
export const CLERK_NEXTJS_DECLARED_RANGE = ">=7 <8";
export const NEXT_DECLARED_RANGE = ">=16 <17";
assertPeerVersion({
  peer: "@clerk/nextjs",
  declaredRange: CLERK_NEXTJS_DECLARED_RANGE,
  foundVersion: resolveInstalledPeerVersion("@clerk/nextjs", import.meta.url),
});
assertPeerVersion({
  peer: "next",
  declaredRange: NEXT_DECLARED_RANGE,
  foundVersion: resolveInstalledPeerVersion("next", import.meta.url),
});

type SearchParameters = Record<string, string | string[] | undefined>;
type PageProps = { searchParams?: Promise<SearchParameters> };

function firstParameter(parameters: SearchParameters | undefined, name: string): string | undefined {
  const value = parameters?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function assertLocalPath(target: string): string {
  if (
    typeof target !== "string" ||
    target !== target.trim() ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    /%5c/i.test(target) ||
    /[\u0000-\u001f\u007f]/.test(target)
  ) throw new TypeError("redirect target must be a single-slash absolute path");
  return target;
}

export function resolveRequestRedirect(requestUrl: string, candidates: ReadonlyArray<string | null | undefined>, allowedOrigins: readonly string[] = []): string | undefined {
  const requestOrigin = new URL(requestUrl).origin;
  const additionalOrigins = allowedOrigins.map((origin) => {
    const normalized = createAllowedOriginPolicy([origin]).origins[0];
    if (normalized === undefined) throw new TypeError("Allowed origin normalization failed.");
    return normalized;
  }).filter((origin) => origin !== requestOrigin);
  const policy = createAllowedOriginPolicy([requestOrigin, ...additionalOrigins]);
  for (const candidate of candidates) {
    const resolved = resolveSafeRedirect(candidate, policy, requestOrigin);
    if (resolved) return resolved;
  }
  return undefined;
}

export interface ClerkSignInPageOptions {
  chrome?: (children: ReactNode) => ReactNode;
  appearance?: ClerkSignInProps["appearance"];
  publishableKey?: string;
  redirectUrl?: string;
  signedInRedirect?: string;
  redirectFromSearchParam?: string;
  redirectOrigin?: string;
  allowedRedirectOrigins?: readonly string[];
  copy?: Pick<ClerkSignInProps, "eyebrow" | "heading" | "subtitle" | "signup_href" | "signup_label">;
}

/** Creates a Next.js sign-in page with a same-origin redirect policy. */
export function createClerkSignInPage(options: ClerkSignInPageOptions = {}) {
  const configuredRedirect = options.redirectUrl ? assertLocalPath(options.redirectUrl) : undefined;
  const configuredSignedInRedirect = options.signedInRedirect ? assertLocalPath(options.signedInRedirect) : undefined;
  const reportMissingSettings = createMissingSettingsReporter();
  return async function ClerkSignInPage({ searchParams }: PageProps = {}) {
    const keylessBypass = devAuthBypassIsKeyless() && !options.publishableKey?.trim();
    // The page shows only the user-facing unavailable message; the missing
    // settings are named once in the server log, never on the page.
    if (!keylessBypass) reportMissingSettings({ publishableKey: options.publishableKey });
    const parameters = options.redirectFromSearchParam ? await searchParams : undefined;
    const requested = options.redirectFromSearchParam ? firstParameter(parameters, options.redirectFromSearchParam) : undefined;
    const dynamicRedirect = options.redirectOrigin ? resolveRequestRedirect(options.redirectOrigin, [requested], options.allowedRedirectOrigins) : undefined;
    const session = keylessBypass ? { userId: null } : await auth();
    if (session.userId) redirect(dynamicRedirect ?? configuredSignedInRedirect ?? configuredRedirect ?? "/");
    const form = keylessBypass ? null : <ClerkSignInBlock appearance={options.appearance} redirect_url={dynamicRedirect ?? configuredRedirect} {...options.copy} />;
    return options.chrome ? options.chrome(form) : form;
  };
}

/** Creates a permanent redirect for a fixed, local compatibility route. */
export function createRedirectRoute(target: string) {
  const safeTarget = assertLocalPath(target);
  return async function GET() { permanentRedirect(safeTarget); };
}

/**
 * The original sign-out options: a POST-only route that may follow a
 * configured or dynamic target. Its fields are unchanged; the `never`
 * markers only refuse the hardened-only keys at compile time.
 *
 * `SignOutRouteOptions` is now a union, and TypeScript cannot `extend` a
 * union: an interface that extended `SignOutRouteOptions` should extend this
 * type instead.
 */
export interface LegacySignOutRouteOptions {
  readonly hardened?: false;
  extraCookiesToClear?: readonly string[];
  redirectTo?: string;
  allowedRedirectOrigins?: readonly string[];
  publishableKey?: string;
  getRedirectTarget?: (request: Request) => string | null;
  readonly origin?: never;
  readonly path?: never;
  readonly confirmationPath?: never;
  readonly terminalPath?: never;
  readonly fallbackPath?: never;
  readonly excludedPaths?: never;
  readonly cookies?: never;
  readonly expiredSessionFallback?: never;
}

interface ExpiredSessionFallbackClaims {
  /** The exact `iss` the session token must carry, such as the instance's Frontend API URL. */
  readonly issuer: string;
  /** The `azp` values a token may carry. At least one, at most 16. */
  readonly authorizedParties: readonly string[];
  /** Also check `aud` against these, when set. At most 16. */
  readonly audience?: string | readonly string[];
  /** Cookie names to read the expired token from, tried in order. Default `["__session"]`; 1–4. */
  readonly sources?: readonly string[];
  /** How long after `exp` a token may still name the session to revoke, in milliseconds. A positive integer, at most 86400000 (24 hours). */
  readonly maxExpiredAgeMs: number;
  /** How far in the future `iat` and `nbf` may be, in milliseconds, independent of `maxExpiredAgeMs`. Default 5000; at most 60000. */
  readonly futureSkewMs?: number;
}

/**
 * Lets the hardened route revoke a session whose token has just expired, so
 * `auth()` no longer names it. The token is verified with Clerk's own
 * `verifyToken`, using exactly one key source, and its claims are then
 * checked again here. A token that fails anything names no session.
 */
export type ClerkExpiredSessionFallback = ExpiredSessionFallbackClaims &
  (
    | { /** PEM public key, for networkless verification. */ readonly jwtKey: string; readonly secretKey?: never; readonly apiUrl?: never }
    | { readonly jwtKey?: never; /** Loads the instance's JWKS. */ readonly secretKey: string; readonly apiUrl?: string }
  );

/**
 * The hardened sign-out route, opted into with `hardened: true`. Serve the
 * returned handler for both GET and POST. See `createSignOutHandler` in the
 * `./gate` subpath for the request rules; this route supplies Clerk's own
 * session lookup, verification and revocation, and never takes a redirect,
 * cookie or callback policy from the request or from a caller callback.
 */
export interface HardenedSignOutRouteOptions {
  readonly hardened: true;
  readonly origin: string;
  readonly path: string;
  readonly confirmationPath: string;
  readonly terminalPath?: string;
  readonly fallbackPath?: string;
  readonly excludedPaths?: readonly string[];
  readonly publishableKey?: string;
  /**
   * Further cookies to expire, after the defaults (host-only `__session` and
   * `__client_uat` at `/`, with their suffixed variants). Name `__refresh`,
   * `__clerk_db_jwt` or a parent-domain scope here when the deployment uses
   * them; the defaults alone do not claim to match Clerk's own sign-out.
   */
  readonly cookies?: readonly SignOutCookieRule[];
  readonly expiredSessionFallback?: ClerkExpiredSessionFallback;
  readonly extraCookiesToClear?: never;
  readonly redirectTo?: never;
  readonly allowedRedirectOrigins?: never;
  readonly getRedirectTarget?: never;
  readonly signOut?: never;
}

export type SignOutRouteOptions = LegacySignOutRouteOptions | HardenedSignOutRouteOptions;

function isSameOriginPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin !== origin.trim() || origin.includes("\\")) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.origin === new URL(request.url).origin;
  } catch { return false; }
}

const HARDENED_ONLY_KEYS = ["origin", "path", "confirmationPath", "terminalPath", "fallbackPath", "excludedPaths", "cookies", "expiredSessionFallback"] as const;
const LEGACY_ONLY_KEYS = ["extraCookiesToClear", "redirectTo", "allowedRedirectOrigins", "getRedirectTarget", "signOut"] as const;
const DEFAULT_COOKIE_RULES: readonly SignOutCookieRule[] = Object.freeze([
  Object.freeze({ name: "__session", matchSuffixes: true }),
  Object.freeze({ name: "__client_uat", matchSuffixes: true }),
]);
const FALLBACK_LIMITS = Object.freeze({
  sources: 4,
  tokenBytes: 16384,
  attempts: 3,
  revokeIds: 3,
  parties: 16,
  futureSkewMs: 60000,
  maxExpiredAgeMs: 86_400_000,
});
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/;
const SESSION_ID = /^sess_[A-Za-z0-9]{1,64}$/;

/** An own property that is set: an accessor, or a data property whose value is not `undefined`. */
function isSetOwn(source: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor !== undefined && (!("value" in descriptor) || descriptor.value !== undefined);
}

function readStringList(value: unknown, name: string, max: number): string[] {
  const list = readDenseArray(value, name, max);
  if (list.length === 0 || list.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${name} must hold 1-${max} non-empty strings.`);
  }
  return list as string[];
}

interface Fallback {
  readonly keyOptions: { readonly jwtKey: string } | { readonly secretKey: string; readonly apiUrl?: string };
  readonly issuer: string;
  readonly authorizedParties: readonly string[];
  readonly audience: readonly string[] | undefined;
  readonly sources: readonly string[];
  readonly maxExpiredAgeMs: number;
  readonly futureSkewMs: number;
}

function readFallback(input: unknown): Fallback | undefined {
  if (input === undefined) return undefined;
  assertPlainObject(input, "expiredSessionFallback");
  const read = (key: string) => readOwnData(input, key, `expiredSessionFallback.${key}`);
  const jwtKey = read("jwtKey");
  const secretKey = read("secretKey");
  const apiUrl = read("apiUrl");
  if ((jwtKey === undefined) === (secretKey === undefined)) {
    throw new TypeError("expiredSessionFallback needs exactly one of jwtKey or secretKey.");
  }
  let keyOptions: Fallback["keyOptions"];
  if (jwtKey !== undefined) {
    if (typeof jwtKey !== "string" || jwtKey.trim().length === 0) throw new TypeError("expiredSessionFallback.jwtKey must be a PEM public key.");
    if (apiUrl !== undefined) throw new TypeError("expiredSessionFallback.apiUrl applies only with secretKey.");
    keyOptions = Object.freeze({ jwtKey });
  } else {
    if (typeof secretKey !== "string" || secretKey.trim().length === 0) throw new TypeError("expiredSessionFallback.secretKey must be a non-empty string.");
    if (apiUrl !== undefined && (typeof apiUrl !== "string" || !/^https:\/\/[^/?#@\s]+\/?$/.test(apiUrl))) {
      throw new TypeError("expiredSessionFallback.apiUrl must be an https origin.");
    }
    keyOptions = Object.freeze(apiUrl === undefined ? { secretKey } : { secretKey, apiUrl: apiUrl as string });
  }
  const issuer = read("issuer");
  if (typeof issuer !== "string" || !/^https?:\/\/[^\s]+$/.test(issuer)) throw new TypeError("expiredSessionFallback.issuer must be an http(s) URL.");
  const authorizedParties = readStringList(read("authorizedParties"), "expiredSessionFallback.authorizedParties", FALLBACK_LIMITS.parties);
  const audienceInput = read("audience");
  const audience =
    audienceInput === undefined
      ? undefined
      : typeof audienceInput === "string" && audienceInput.length > 0
        ? [audienceInput]
        : readStringList(audienceInput, "expiredSessionFallback.audience", FALLBACK_LIMITS.parties);
  const sourcesInput = read("sources");
  const sources = sourcesInput === undefined ? ["__session"] : readStringList(sourcesInput, "expiredSessionFallback.sources", FALLBACK_LIMITS.sources);
  if (sources.some((source) => !COOKIE_NAME.test(source))) throw new TypeError("expiredSessionFallback.sources must hold cookie names.");
  const maxExpiredAgeMs = read("maxExpiredAgeMs");
  if (
    typeof maxExpiredAgeMs !== "number" ||
    !Number.isSafeInteger(maxExpiredAgeMs) ||
    maxExpiredAgeMs <= 0 ||
    maxExpiredAgeMs > FALLBACK_LIMITS.maxExpiredAgeMs
  ) {
    throw new TypeError(`expiredSessionFallback.maxExpiredAgeMs must be an integer from 1 to ${FALLBACK_LIMITS.maxExpiredAgeMs}.`);
  }
  const futureSkewMs = read("futureSkewMs") ?? 5000;
  if (typeof futureSkewMs !== "number" || !Number.isSafeInteger(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > FALLBACK_LIMITS.futureSkewMs) {
    throw new TypeError(`expiredSessionFallback.futureSkewMs must be an integer from 0 to ${FALLBACK_LIMITS.futureSkewMs}.`);
  }
  return Object.freeze({
    keyOptions,
    issuer,
    authorizedParties: Object.freeze([...authorizedParties]),
    audience: audience === undefined ? undefined : Object.freeze([...audience]),
    sources: Object.freeze([...sources]),
    maxExpiredAgeMs,
    futureSkewMs,
  });
}

/** Seconds since the epoch as exact milliseconds, or `undefined` when the claim is not a safe integer or overflows. */
function claimMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  const ms = value * 1000;
  return Number.isSafeInteger(ms) ? ms : undefined;
}

/**
 * Re-checks a payload Clerk has already verified and returns the session it
 * names, or `undefined`. `verifyToken` checks no issuer, and its single clock
 * skew (widened here to the expired age) also loosens `iat` and `nbf`, so
 * those are checked again with their own bound.
 */
function verifiedSessionId(payload: unknown, fallback: Fallback, now: number): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const claim = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  };
  if (claim("iss") !== fallback.issuer) return undefined;
  const azp = claim("azp");
  if (typeof azp !== "string" || !fallback.authorizedParties.includes(azp)) return undefined;
  if (fallback.audience !== undefined) {
    const aud = claim("aud");
    const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
    if (!audiences.some((value) => typeof value === "string" && fallback.audience?.includes(value))) return undefined;
  }
  const sub = claim("sub");
  if (typeof sub !== "string" || sub.length === 0) return undefined;
  const exp = claimMs(claim("exp"));
  const iat = claimMs(claim("iat"));
  const nbfClaim = claim("nbf");
  const nbf = nbfClaim === undefined ? undefined : claimMs(nbfClaim);
  if (exp === undefined || iat === undefined || (nbfClaim !== undefined && nbf === undefined)) return undefined;
  if (iat > exp || (nbf !== undefined && nbf > exp)) return undefined;
  const latestStart = now + fallback.futureSkewMs;
  const oldestEnd = exp + fallback.maxExpiredAgeMs;
  if (!Number.isSafeInteger(latestStart) || !Number.isSafeInteger(oldestEnd)) return undefined;
  if (iat > latestStart || (nbf !== undefined && nbf > latestStart) || oldestEnd <= now) return undefined;
  const sid = claim("sid");
  return typeof sid === "string" && SESSION_ID.test(sid) ? sid : undefined;
}

async function expiredSessionIds(fallback: Fallback, context: SignOutContext): Promise<string[]> {
  const cookies = context.cookies;
  if (cookies === undefined) return [];
  const ids: string[] = [];
  let attempts = 0;
  for (const source of fallback.sources) {
    if (attempts >= FALLBACK_LIMITS.attempts || ids.length >= FALLBACK_LIMITS.revokeIds || !context.isActive()) break;
    const token = cookies.get(source);
    if (token === undefined || token.length === 0 || utf8ByteLength(token) > FALLBACK_LIMITS.tokenBytes) continue;
    attempts += 1;
    let payload: unknown;
    try {
      payload = await verifyToken(token, {
        ...fallback.keyOptions,
        authorizedParties: [...fallback.authorizedParties],
        ...(fallback.audience === undefined ? {} : { audience: [...fallback.audience] }),
        clockSkewInMs: fallback.maxExpiredAgeMs,
      });
    } catch {
      continue;
    }
    if (!context.isActive()) break;
    const sid = verifiedSessionId(payload, fallback, Date.now());
    if (sid !== undefined && !ids.includes(sid)) ids.push(sid);
  }
  return ids;
}

function createHardenedSignOutRoute(options: object): (request: Request) => Promise<Response> {
  assertPlainObject(options, "Sign-out route options");
  for (const key of LEGACY_ONLY_KEYS) {
    if (isSetOwn(options, key)) throw new TypeError(`The hardened sign-out route does not take ${key}.`);
  }
  const read = (key: string) => readOwnData(options, key, key);
  const publishableKey = read("publishableKey");
  if (publishableKey !== undefined && typeof publishableKey !== "string") throw new TypeError("publishableKey must be a string.");
  const extraRules = read("cookies");
  // The kernel validates every rule; this only copies a dense, plain list.
  const cookies = [...DEFAULT_COOKIE_RULES, ...(extraRules === undefined ? [] : (readDenseArray(extraRules, "cookies", 14) as SignOutCookieRule[]))];
  const fallback = readFallback(read("expiredSessionFallback"));

  const signOut = async (context: SignOutContext): Promise<void> => {
    if (devAuthBypassIsKeyless() && !(publishableKey as string | undefined)?.trim()) return;
    const session = await auth();
    if (!context.isActive()) return;
    const active = session.sessionId;
    const ids = typeof active === "string" && active.length > 0 ? [active] : fallback === undefined ? [] : await expiredSessionIds(fallback, context);
    if (ids.length === 0 || !context.isActive()) return;
    const client = await clerkClient();
    for (const id of ids.slice(0, FALLBACK_LIMITS.revokeIds)) {
      if (!context.isActive()) return;
      await client.sessions.revokeSession(id);
    }
  };

  return createSignOutHandler({
    origin: read("origin") as string,
    path: read("path") as string,
    confirmationPath: read("confirmationPath") as string,
    terminalPath: read("terminalPath") as string | undefined,
    fallbackPath: read("fallbackPath") as string | undefined,
    excludedPaths: read("excludedPaths") as readonly string[] | undefined,
    cookies,
    signOut,
  });
}

/**
 * Creates the sign-out route.
 *
 * Without `hardened: true` this is the original same-origin POST route that
 * revokes the active session before redirecting, unchanged. With it, the
 * route is the hardened Fetch handler described on
 * {@link HardenedSignOutRouteOptions}; serve it for both GET and POST.
 */
export function createSignOutRoute(options?: LegacySignOutRouteOptions): (request: Request) => Promise<Response>;
export function createSignOutRoute(options: HardenedSignOutRouteOptions): (request: Request) => Promise<Response>;
/** Either shape, for a caller that forwards a `SignOutRouteOptions` value it did not build itself. */
export function createSignOutRoute(options?: SignOutRouteOptions): (request: Request) => Promise<Response>;
export function createSignOutRoute(options: SignOutRouteOptions = {}) {
  const flag = Object.getOwnPropertyDescriptor(options, "hardened");
  if (flag !== undefined) {
    if (!("value" in flag) || (flag.value !== true && flag.value !== false && flag.value !== undefined)) {
      throw new TypeError("hardened must be true, false or absent.");
    }
    if (flag.value === true) return createHardenedSignOutRoute(options);
  }
  // A hardened-only key left undefined is ignored, as the gate does; a set one is refused.
  for (const key of HARDENED_ONLY_KEYS) {
    if (isSetOwn(options, key)) throw new TypeError(`${key} needs hardened: true.`);
  }
  const legacy = options as LegacySignOutRouteOptions;
  return async function POST(request: Request) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    if (!isSameOriginPost(request)) return new Response(null, { status: 403 });
    if (!devAuthBypassIsKeyless() || Boolean(legacy.publishableKey?.trim())) {
      const session = await auth();
      if (session.sessionId) { const client = await clerkClient(); await client.sessions.revokeSession(session.sessionId); }
    }
    const jar = await cookies();
    for (const name of legacy.extraCookiesToClear ?? []) jar.delete(name);
    const dynamic = legacy.getRedirectTarget?.(request) ?? null;
    const target = resolveRequestRedirect(request.url, [dynamic, legacy.redirectTo, "/"], legacy.allowedRedirectOrigins) ?? new URL("/", request.url).toString();
    return NextResponse.redirect(target, 303);
  };
}
