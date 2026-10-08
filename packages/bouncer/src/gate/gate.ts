/**
 * One gate for gated application hosts. Framework-neutral: it reads a Fetch
 * `Request` and answers with a Fetch `Response`, so a consumer's proxy
 * supplies only host-specific options. The identity provider is a seam
 * (`resolvePrincipal`) and nothing here imports a provider or a framework.
 *
 * Every response header rule comes from `host-responses.ts` and every return
 * URL rule from `redirect.ts`; this file decides only which answer a request
 * gets.
 *
 * Decisions, in order. Nothing is rendered before the decision is made.
 *   1. A request whose URL is not http(s) is refused with 400.
 *   2. The RFC 9728 metadata path is served by the gate (GET and HEAD only)
 *      and never gated.
 *   3. The sign-in path and its sub-routes pass through to `next`; a path
 *      the consumer marks public (`isPublicPath`) passes through without
 *      asking the provider. A path with an encoded slash, backslash, dot,
 *      percent sign, null, semicolon or non-ASCII byte, a semicolon or a
 *      doubled slash is ambiguous: it takes neither pass-through and is gated
 *      like any other.
 *   4. Anything not signed in, including an unavailable provider, fails
 *      closed: a navigation gets a 307 to the sign-in route, any other
 *      request (and any API route) a 401 with an RFC 9728 challenge.
 *   5. A signed-in principal the permission check does not approve with
 *      exactly `true` gets a 307 to the not-authorized route (navigation) or
 *      a 403 (anything else). The not-authorized route is forced to 403.
 *
 * Every pass-through to a gated route (a permitted principal, the sign-in
 * route, the not-authorized route) is `Cache-Control: private, no-store` and
 * varies on `Cookie` and `Authorization`, whatever `next` set. A path
 * `isPublicPath` approves is left as `next` rendered it.
 *
 * Every URL the gate writes comes from configuration or from the request's
 * own path and query, never from the request's host or any header, and every
 * error body is a fixed string. A provider that throws, answers null or
 * answers an unknown shape is `unavailable`; a `next` that throws or returns
 * a non-Response is a 503. Nothing here answers 500.
 *
 * The 403 and 503 are set on the Response that `next` returns, so they apply
 * only when `next` returns the final response. Under a Next.js proxy,
 * `NextResponse.next()` or a rewrite can discard that status.
 *
 * Hardened mode is an explicit opt-in (`hardened: true`, an own data
 * property) and changes nothing above unless it is set. In hardened mode:
 *   - every option is read once, as an own data property, from a plain
 *     object; arrays must be dense and plain;
 *   - the permission check may answer `"permitted"`, `"denied"` or
 *     `"unavailable"`; `"unavailable"` or a throw answers 503, and an
 *     unavailable provider on a gated path answers 503 rather than sending
 *     the visitor to sign in, so uncertainty is never reported as signed out;
 *   - a navigation is a GET or HEAD whose Accept names `text/html` with a
 *     valid quality above zero, and never a server action or router request;
 *   - decoding and case folding are used only to deny: a path carrying any
 *     percent escape takes no pass-through, and a decoded or case-folded path
 *     can make a route an API route, never a public or sign-in one;
 *   - the return URL is the hardened branch of `createReturnUrlResolver`,
 *     which never names the sign-in, not-authorized or metadata route (or an
 *     `excludedReturnPaths` entry) at any representation.
 */
import { applyGatedHostHeaders, createServiceUnavailableResponse } from "../host-responses.js";
import {
  assertPlainObject,
  createAllowedOriginPolicy,
  readDenseArray,
  readExcludedPaths,
  readOwnData,
  resolveHardenedTarget,
  resolveSafeRedirect,
} from "../redirect.js";

/** Where the gate serves, and the challenge points to, the RFC 9728 document. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** What the identity provider said about this request. */
export type GatePrincipalState<P = unknown> =
  | { readonly state: "signed-out" }
  | { readonly state: "unavailable" }
  | { readonly state: "signed-in"; readonly principal: P };

/** Renders the pass-through response. `providerUnavailable` is true on the sign-in route when the provider did not answer. */
export type GatedHostNext = (context: { readonly providerUnavailable: boolean }) => Response | Promise<Response>;

/** The RFC 9728 protected resource metadata the gate serves. Unknown keys are dropped. */
export interface ProtectedResourceMetadata {
  /** Absolute http(s) URL of the protected resource. Defaults to `origin`. */
  readonly resource?: string;
  /** Issuer URLs of the authorization servers. At least one. */
  readonly authorization_servers: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly bearer_methods_supported?: readonly string[];
}

/** A hardened permission answer. `true` and `false` remain accepted as `"permitted"` and `"denied"`. */
export type GatePermissionAnswer = "permitted" | "denied" | "unavailable";

export interface GatedHostGateOptions<P = unknown> {
  /** Legacy mode. Set `hardened: true` (see {@link HardenedGatedHostGateOptions}) to opt in to the hardened contract. */
  readonly hardened?: false;
  /** Hardened mode only. */
  readonly excludedReturnPaths?: never;
  /** Hardened mode only. */
  readonly returnFallbackPath?: never;
  /** This host's own public origin, from configuration. The gate never reads the origin from the request. */
  readonly origin: string;
  /** Same-host sign-in route, such as `/sign-in`. A plain path: no query, no trailing slash. */
  readonly signInPath: string;
  /** Same-host route that renders the not-authorized page. The gate forces the response `next` returns for it to 403. */
  readonly notAuthorizedPath: string;
  /** Explicit sibling origins a return URL may name. Everything else falls back to `/`. */
  readonly siblingOrigins?: readonly string[];
  /** The RFC 9728 document. Required, because every 401 advertises it. */
  readonly protectedResourceMetadata: ProtectedResourceMetadata;
  /** Asks the identity provider. A throw, a rejection or an unknown answer is `unavailable`. */
  readonly resolvePrincipal: (request: Request) => GatePrincipalState<P> | Promise<GatePrincipalState<P>>;
  /** Permission check for a signed-in principal. Required: only the answer `true` permits. A throw or any other answer denies. */
  readonly isPermitted: (principal: P, request: Request) => boolean | Promise<boolean>;
  /** Paths that stay reachable without sign-in, such as `/robots.txt` and `/health`. Only the answer `true` makes a path public. */
  readonly isPublicPath?: (pathname: string) => boolean;
  /** Path prefixes always answered as API routes, each ending in `/`. Defaults to `["/api/"]`. */
  readonly apiPathPrefixes?: readonly string[];
  /** In production the unavailable sign-in state answers 503 with `Retry-After`. Default false. */
  readonly production?: boolean;
  /** Seconds for `Retry-After`, as `createServiceUnavailableResponse` takes it. Default 30. */
  readonly retryAfterSeconds?: number;
}

/** The hardened gate. Every option is read once, as an own data property. */
export interface HardenedGatedHostGateOptions<P = unknown>
  extends Omit<GatedHostGateOptions<P>, "hardened" | "isPermitted" | "excludedReturnPaths" | "returnFallbackPath"> {
  /** Explicit opt-in. */
  readonly hardened: true;
  /**
   * Permission check. `true` or `"permitted"` permits; `false`, `"denied"` or
   * any unknown answer denies; `"unavailable"`, a throw or a rejection
   * answers 503.
   */
  readonly isPermitted: (
    principal: P,
    request: Request,
  ) => boolean | GatePermissionAnswer | Promise<boolean | GatePermissionAnswer>;
  /** Further same-host paths a return URL must never name. At most 16. */
  readonly excludedReturnPaths?: readonly string[];
  /** Same-host path used when the return URL is refused. Default `/`; required when `/` is excluded. */
  readonly returnFallbackPath?: string;
}

export type GatedHostGate = (request: Request, next: GatedHostNext) => Promise<Response>;

/** Options for {@link createReturnUrlResolver}. */
export interface ReturnUrlResolverOptions {
  /** Legacy mode. Set `hardened: true` (see {@link HardenedReturnUrlResolverOptions}) to opt in. */
  readonly hardened?: false;
  /** Hardened mode only. */
  readonly excludedPaths?: never;
  /** Hardened mode only. */
  readonly fallbackPath?: never;
  /** This host's own public origin. */
  readonly origin: string;
  /** Explicit sibling origins a return URL may name. */
  readonly siblingOrigins?: readonly string[];
}

/** The hardened return-URL resolver. Every option is read once, as an own data property. */
export interface HardenedReturnUrlResolverOptions {
  /** Explicit opt-in. */
  readonly hardened: true;
  /** This host's own public origin. */
  readonly origin: string;
  /** Explicit sibling origins a return URL may name. Their own paths are not subject to `excludedPaths`. */
  readonly siblingOrigins?: readonly string[];
  /** Same-host paths a return URL must never name, at any representation. At most 16. */
  readonly excludedPaths?: readonly string[];
  /** Same-host path returned when a value is refused. Default `/`; required when `/` is excluded. */
  readonly fallbackPath?: string;
}

const PLAIN_SEGMENT = /^[A-Za-z0-9._~-]+$/;

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

function isPlainOwnPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value === "/") return false;
  return value
    .slice(1)
    .split("/")
    .every((segment) => PLAIN_SEGMENT.test(segment) && !isDotSegment(segment));
}

function isApiPrefix(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && value.endsWith("/") && isPlainOwnPath(value.slice(0, -1));
}

/**
 * A path a downstream router could read as a different route than the one
 * matched here: a doubled slash, a semicolon (a path parameter to some
 * routers), or an encoded slash, backslash, dot, percent sign, null,
 * semicolon or non-ASCII byte (`%80` and above, which is how the URL parser
 * writes a non-ASCII character).
 *
 * The pathname always comes from the URL parser, which turns a raw backslash
 * into `/`, resolves literal and `%2e` dot segments and percent-encodes
 * non-ASCII characters, so none of those can reach this check in raw form.
 */
const AMBIGUOUS_PATH = /\/\/|;|%(?:2f|5c|2e|25|00|3b|[89a-f][0-9a-f])/i;

function isAmbiguousPath(pathname: string): boolean {
  return AMBIGUOUS_PATH.test(pathname);
}

/** The Location header of a sign-in redirect is kept to this many characters. */
const MAX_LOCATION_LENGTH = 2048;
const NO_STORE_PRIVATE = "private, no-store";
const VARY_BY_CREDENTIALS = ["Cookie", "Authorization"];

/** Adds Cookie and Authorization to `Vary`, keeping what is there and not repeating a value (`*` stays `*`). */
function varyByCredentials(headers: Headers): void {
  const existing = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (existing.includes("*")) return;
  const seen = new Set(existing.map((value) => value.toLowerCase()));
  const added = VARY_BY_CREDENTIALS.filter((value) => !seen.has(value.toLowerCase()));
  headers.set("Vary", [...existing, ...added].join(", "));
}

function acceptsHtml(accept: string): boolean {
  return accept.split(",").some((entry) => {
    const [type, ...params] = entry.split(";").map((part) => part.trim().toLowerCase());
    if (type !== "text/html") return false;
    const q = params.find((param) => param.startsWith("q="));
    return q === undefined || Number(q.slice(2)) !== 0;
  });
}

/**
 * True when the browser says it is navigating (`Sec-Fetch-Mode: navigate`),
 * the request accepts `text/html` with a quality above zero, or it is a
 * Next.js router request (`RSC` header or `_rsc` query parameter).
 */
export function isNavigationRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate") return true;
  if (acceptsHtml(request.headers.get("accept") ?? "")) return true;
  if (request.headers.has("rsc")) return true;
  try {
    return new URL(request.url).searchParams.has("_rsc");
  } catch {
    return false;
  }
}

/**
 * Builds the return-URL validator for a host: a relative path on `origin`, or
 * an absolute URL on one of `siblingOrigins`, comes back as written (relative
 * for the host's own origin); everything else comes back as `/`. It is the
 * strict allowlist of `redirect.ts`, so a sign-in page can use the same
 * validator on its incoming `redirect_url`.
 *
 * @throws {TypeError} when `origin` or a sibling is not a plain http(s) origin.
 */
export function createReturnUrlResolver(options: ReturnUrlResolverOptions): (value: string | null | undefined) => string;
/**
 * The hardened branch: a value comes back as written only when
 * `resolveHardenedRedirect` accepts it (same rules, plus `excludedPaths`);
 * everything else comes back as `fallbackPath`, itself validated at
 * construction against the same rules.
 *
 * @throws {TypeError} when an option is malformed, when `fallbackPath` is not
 * an accepted same-host path, or when `/` is excluded and no `fallbackPath`
 * is given.
 */
export function createReturnUrlResolver(options: HardenedReturnUrlResolverOptions): (value: string | null | undefined) => string;
export function createReturnUrlResolver(
  options: ReturnUrlResolverOptions | HardenedReturnUrlResolverOptions,
): (value: string | null | undefined) => string {
  if (options === null || typeof options !== "object") throw new TypeError("Return-URL options must be an object.");
  if (readHardenedFlag(options)) {
    assertPlainObject(options, "Return-URL options");
    const excluded = readExcludedPaths(readOwnData(options, "excludedPaths", "excludedPaths"), "excludedPaths");
    return createHardenedResolver(
      readOwnData(options, "origin", "origin"),
      readOwnData(options, "siblingOrigins", "siblingOrigins"),
      excluded,
      readOwnData(options, "fallbackPath", "fallbackPath"),
      "fallbackPath",
    );
  }
  refuseHardenedOnly(options, ["excludedPaths", "fallbackPath"]);
  if (typeof options.origin !== "string") throw new TypeError("origin must be an http(s) origin string.");
  if (options.siblingOrigins !== undefined && !Array.isArray(options.siblingOrigins)) {
    throw new TypeError("siblingOrigins must be an array of origins.");
  }
  const policy = createAllowedOriginPolicy([options.origin, ...(options.siblingOrigins ?? [])]);
  const base = policy.origins[0];
  return (value) => {
    const resolved = resolveSafeRedirect(value, policy, base);
    if (resolved === undefined) return "/";
    const url = new URL(resolved);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : resolved;
  };
}

/** Reads the opt-in flag: only an own data property `true` opts in. */
function readHardenedFlag(options: object): boolean {
  const flag = readOwnData(options, "hardened", "hardened");
  if (flag !== undefined && typeof flag !== "boolean") throw new TypeError("hardened must be a boolean.");
  return flag === true;
}

/** A hardened-only option set without `hardened: true` is refused rather than silently ignored. */
function refuseHardenedOnly(options: object, keys: readonly string[]): void {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor !== undefined && (!("value" in descriptor) || descriptor.value !== undefined)) {
      throw new TypeError(`${key} is a hardened option; set hardened: true to use it.`);
    }
  }
}

function createHardenedResolver(
  originInput: unknown,
  siblingsInput: unknown,
  excluded: readonly string[],
  fallbackInput: unknown,
  fallbackName: string,
): (value: string | null | undefined) => string {
  if (typeof originInput !== "string") throw new TypeError("origin must be an http(s) origin string.");
  const siblings = siblingsInput === undefined ? [] : readDenseArray(siblingsInput, "siblingOrigins", Number.MAX_SAFE_INTEGER);
  if (!siblings.every((sibling): sibling is string => typeof sibling === "string")) {
    throw new TypeError("siblingOrigins must be an array of origins.");
  }
  const policy = createAllowedOriginPolicy([originInput, ...siblings]);
  const base = policy.origins[0] as string;
  if (fallbackInput === undefined && excluded.some((path) => path === "/")) {
    throw new TypeError(`Excluding / requires an explicit ${fallbackName}.`);
  }
  const fallbackValue = fallbackInput ?? "/";
  if (typeof fallbackValue !== "string" || !fallbackValue.startsWith("/")) throw new TypeError(`${fallbackName} must be a same-host path.`);
  const fallbackResolved = resolveHardenedTarget(fallbackValue, policy, base, excluded);
  if (fallbackResolved === undefined || new URL(fallbackResolved).origin !== base) {
    throw new TypeError(`${fallbackName} must be a plain, non-excluded same-host path.`);
  }
  const fallback = fallbackValue;
  return (value) => {
    const resolved = resolveHardenedTarget(value, policy, base, excluded);
    if (resolved === undefined) return fallback;
    const url = new URL(resolved);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : resolved;
  };
}

function parseHttpUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${name} must be an array of non-empty strings.`);
  }
  return [...value];
}

function buildMetadataDocument(origin: string, input: unknown): string {
  if (input === null || typeof input !== "object") throw new TypeError("protectedResourceMetadata is required.");
  const metadata = input as Partial<ProtectedResourceMetadata>;
  const servers = stringList(metadata.authorization_servers, "authorization_servers");
  if (servers.length === 0 || servers.some((server) => parseHttpUrl(server) === undefined)) {
    throw new TypeError("authorization_servers must name at least one http(s) issuer URL without credentials.");
  }
  let resource = origin;
  if (metadata.resource !== undefined) {
    const parsed = parseHttpUrl(metadata.resource);
    if (parsed === undefined || parsed.hash) throw new TypeError("resource must be an http(s) URL without credentials or a fragment.");
    resource = metadata.resource;
  }
  return JSON.stringify({
    resource,
    authorization_servers: servers,
    ...(metadata.scopes_supported === undefined ? {} : { scopes_supported: stringList(metadata.scopes_supported, "scopes_supported") }),
    ...(metadata.bearer_methods_supported === undefined
      ? {}
      : { bearer_methods_supported: stringList(metadata.bearer_methods_supported, "bearer_methods_supported") }),
  });
}

function normalizeState<P>(value: unknown): GatePrincipalState<P> {
  if (typeof value === "object" && value !== null) {
    const { state } = value as { state?: unknown };
    if (state === "signed-out") return { state };
    if (state === "signed-in" && "principal" in value) return value as GatePrincipalState<P>;
  }
  return { state: "unavailable" };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return applyGatedHostHeaders(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
  );
}

const HARDENED_QUALITY = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
/** Next.js router, prefetch and server-action request headers: never a navigation in hardened mode. */
const ROUTER_OR_ACTION_HEADERS = ["rsc", "next-action", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"];

/** `text/html` named exactly, with no quality or a valid RFC 9110 quality above zero. */
function acceptsHtmlHardened(accept: string): boolean {
  return accept.split(",").some((entry) => {
    const [type, ...params] = entry.split(";").map((part) => part.trim());
    if (type !== "text/html") return false;
    let quality = 1;
    for (const param of params) {
      const equals = param.indexOf("=");
      const name = (equals === -1 ? param : param.slice(0, equals)).trim();
      if (name !== "q" && name !== "Q") continue;
      const value = equals === -1 ? "" : param.slice(equals + 1).trim();
      if (!HARDENED_QUALITY.test(value)) return false;
      quality = Number(value);
    }
    return quality > 0;
  });
}

function isHardenedNavigationRequest(request: Request, url: URL): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (ROUTER_OR_ACTION_HEADERS.some((name) => request.headers.has(name))) return false;
  if (url.searchParams.has("_rsc")) return false;
  return acceptsHtmlHardened(request.headers.get("accept") ?? "");
}

/** An API route under the path as written, decoded or case-folded. A path that cannot be decoded counts as one. */
function isHardenedApiPath(pathname: string, prefixes: readonly string[]): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return [pathname, pathname.toLowerCase(), decoded, decoded.toLowerCase()].some((path) =>
    prefixes.some((prefix) => {
      const lower = prefix.toLowerCase();
      return path === lower.slice(0, -1) || path.startsWith(lower) || path === prefix.slice(0, -1) || path.startsWith(prefix);
    }),
  );
}

const HARDENED_GATE_KEYS = [
  "origin",
  "signInPath",
  "notAuthorizedPath",
  "siblingOrigins",
  "protectedResourceMetadata",
  "resolvePrincipal",
  "isPermitted",
  "isPublicPath",
  "apiPathPrefixes",
  "production",
  "retryAfterSeconds",
  "excludedReturnPaths",
  "returnFallbackPath",
] as const;
const METADATA_KEYS = ["resource", "authorization_servers", "scopes_supported", "bearer_methods_supported"] as const;

/** A frozen snapshot of the hardened options: own data properties only, arrays copied dense. */
function snapshotHardenedOptions<P>(input: object): HardenedGatedHostGateOptions<P> {
  assertPlainObject(input, "Gate options");
  const snapshot: Record<string, unknown> = { hardened: true };
  for (const key of HARDENED_GATE_KEYS) {
    let value = readOwnData(input, key, key);
    if ((key === "siblingOrigins" || key === "apiPathPrefixes") && value !== undefined) {
      value = readDenseArray(value, key, Number.MAX_SAFE_INTEGER);
    }
    if (key === "protectedResourceMetadata" && value !== null && typeof value === "object") {
      assertPlainObject(value, key);
      const metadata: Record<string, unknown> = {};
      for (const field of METADATA_KEYS) {
        let fieldValue = readOwnData(value, field, field);
        if (field !== "resource" && fieldValue !== undefined) fieldValue = readDenseArray(fieldValue, field, Number.MAX_SAFE_INTEGER);
        if (fieldValue !== undefined) metadata[field] = fieldValue;
      }
      value = metadata;
    }
    if (value !== undefined) snapshot[key] = value;
  }
  return Object.freeze(snapshot) as unknown as HardenedGatedHostGateOptions<P>;
}

/** A copy whose headers are mutable, so a pass-through of `Response.redirect()` can still be tagged. */
function reissue(response: Response, status: number): Response {
  return new Response(response.body, {
    status,
    statusText: status === response.status ? response.statusText : "",
    headers: new Headers(response.headers),
  });
}

/**
 * Creates the gate. Call the result from a consumer's proxy; it always
 * returns a Response.
 *
 * @throws {TypeError} when an option is missing or malformed. Messages name
 * the option, never its value.
 */
export function createGatedHostGate<P = unknown>(options: GatedHostGateOptions<P>): GatedHostGate;
/**
 * Creates the hardened gate (see the file header). It always returns a
 * Response.
 *
 * @throws {TypeError} when an option is missing, malformed, inherited or an
 * accessor. Messages name the option, never its value.
 */
export function createGatedHostGate<P = unknown>(options: HardenedGatedHostGateOptions<P>): GatedHostGate;
export function createGatedHostGate<P = unknown>(
  input: GatedHostGateOptions<P> | HardenedGatedHostGateOptions<P>,
): GatedHostGate {
  if (input === null || typeof input !== "object") throw new TypeError("Gate options must be an object.");
  const hardened = readHardenedFlag(input);
  if (!hardened) refuseHardenedOnly(input, ["excludedReturnPaths", "returnFallbackPath"]);
  const options = hardened ? snapshotHardenedOptions<P>(input) : input;
  const { signInPath, notAuthorizedPath, resolvePrincipal, isPermitted, isPublicPath } = options;
  const apiPrefixes = options.apiPathPrefixes ?? ["/api/"];
  if (!isPlainOwnPath(signInPath)) throw new TypeError("signInPath must be a plain same-host path without a query or trailing slash.");
  if (!isPlainOwnPath(notAuthorizedPath)) throw new TypeError("notAuthorizedPath must be a plain same-host path without a query or trailing slash.");
  const signInPrefix = `${signInPath}/`;
  if (
    notAuthorizedPath === signInPath ||
    notAuthorizedPath.startsWith(signInPrefix) ||
    signInPath === PROTECTED_RESOURCE_METADATA_PATH ||
    signInPath.startsWith(`${PROTECTED_RESOURCE_METADATA_PATH}/`) ||
    notAuthorizedPath === PROTECTED_RESOURCE_METADATA_PATH
  ) {
    throw new TypeError("signInPath, notAuthorizedPath and the metadata path must be distinct routes.");
  }
  if (typeof resolvePrincipal !== "function") throw new TypeError("resolvePrincipal must be a function.");
  if (typeof isPermitted !== "function") throw new TypeError("isPermitted must be a function; there is no permit-everyone default.");
  if (isPublicPath !== undefined && typeof isPublicPath !== "function") throw new TypeError("isPublicPath must be a function.");
  if (!Array.isArray(apiPrefixes) || !apiPrefixes.every(isApiPrefix)) {
    throw new TypeError("apiPathPrefixes must be an array of plain paths that end in a slash.");
  }
  const reserved = ["/api", "/_next", ...apiPrefixes.filter(isApiPrefix).map((prefix) => prefix.slice(0, -1))];
  for (const route of [signInPath, notAuthorizedPath]) {
    if (reserved.some((root) => route === root || route.startsWith(`${root}/`))) {
      throw new TypeError("signInPath and notAuthorizedPath must not be or sit under /api, /_next or an apiPathPrefixes entry.");
    }
  }
  if (options.production !== undefined && typeof options.production !== "boolean") throw new TypeError("production must be a boolean.");

  const returnUrl = hardened
    ? createHardenedResolver(
        options.origin,
        options.siblingOrigins,
        [signInPath, notAuthorizedPath, PROTECTED_RESOURCE_METADATA_PATH, ...readExcludedPaths(options.excludedReturnPaths, "excludedReturnPaths")],
        options.returnFallbackPath,
        "returnFallbackPath",
      )
    : createReturnUrlResolver({ origin: options.origin, siblingOrigins: options.siblingOrigins });
  const origin = new URL(options.origin).origin;
  const metadataBody = buildMetadataDocument(origin, options.protectedResourceMetadata);
  const challenge = `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_METADATA_PATH}"`;
  const production = options.production === true;
  const retryAfter = createServiceUnavailableResponse({ retryAfterSeconds: options.retryAfterSeconds }).headers.get("Retry-After") ?? "30";
  const unavailable = () => createServiceUnavailableResponse({ retryAfterSeconds: options.retryAfterSeconds });

  return async (request, next) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return jsonResponse(400, { error: "bad_request" }, { "Cache-Control": "no-store" });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return jsonResponse(400, { error: "bad_request" }, { "Cache-Control": "no-store" });
    }
    const { pathname } = url;

    if (pathname === PROTECTED_RESOURCE_METADATA_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse(405, { error: "method_not_allowed" }, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      }
      return applyGatedHostHeaders(
        new Response(request.method === "HEAD" ? null : metadataBody, {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
        }),
      );
    }

    /**
     * Renders `next`; a throw or a non-Response becomes a 503, and `status`
     * overrides the rendered one. A gated pass-through (anything but a public
     * path) is always `private, no-store` and varies on credentials, whatever
     * `next` set, and loses `Surrogate-Control` and every `*CDN-Cache-Control`
     * header, so a shared cache cannot keep it for a signed-out visitor.
     */
    const render = async (providerUnavailable: boolean, status?: number, gated = true): Promise<Response> => {
      try {
        const rendered = await next({ providerUnavailable });
        if (!(rendered instanceof Response)) return unavailable();
        const response = reissue(rendered, status ?? rendered.status);
        if (status === 503) response.headers.set("Retry-After", retryAfter);
        applyGatedHostHeaders(response, gated ? { noStore: true } : undefined);
        if (gated) {
          for (const name of [...response.headers.keys()]) {
            const lower = name.toLowerCase();
            if (lower === "surrogate-control" || lower.endsWith("cdn-cache-control")) response.headers.delete(name);
          }
          response.headers.set("Cache-Control", NO_STORE_PRIVATE);
          varyByCredentials(response.headers);
        }
        return response;
      } catch {
        return unavailable();
      }
    };

    // Hardened: any percent escape is a reason to deny a pass-through, never to grant one.
    const ambiguous = isAmbiguousPath(pathname) || (hardened && pathname.includes("%"));
    const isSignIn = !ambiguous && (pathname === signInPath || pathname.startsWith(signInPrefix));

    if (!isSignIn && !ambiguous && isPublicPath !== undefined) {
      let isPublic = false;
      try {
        isPublic = isPublicPath(pathname) === true;
      } catch {
        isPublic = false;
      }
      if (isPublic) return render(false, undefined, false);
    }

    let state: GatePrincipalState<P>;
    try {
      state = normalizeState<P>(await resolvePrincipal(request));
    } catch {
      state = { state: "unavailable" };
    }

    if (isSignIn) {
      const providerUnavailable = state.state === "unavailable";
      return render(providerUnavailable, providerUnavailable && production ? 503 : undefined);
    }

    const isApi = hardened
      ? isHardenedApiPath(pathname, apiPrefixes)
      : apiPrefixes.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
    const navigation = !isApi && (hardened ? isHardenedNavigationRequest(request, url) : isNavigationRequest(request));

    // Hardened: a provider that did not answer is uncertainty, not a signed-out visitor.
    if (hardened && state.state === "unavailable") return unavailable();

    if (state.state !== "signed-in") {
      if (navigation) {
        const signInLocation = (target: string) => `${signInPath}?redirect_url=${encodeURIComponent(target)}`;
        let location = signInLocation(returnUrl(`${pathname}${url.search}`));
        if (location.length > MAX_LOCATION_LENGTH) location = signInLocation("/");
        return applyGatedHostHeaders(new Response(null, { status: 307, headers: { Location: location } }));
      }
      return jsonResponse(401, { error: "unauthorized" }, { "WWW-Authenticate": challenge });
    }

    if (pathname === notAuthorizedPath) return render(false, 403);

    let permitted = false;
    if (hardened) {
      let answer: GatePermissionAnswer;
      try {
        const value: unknown = await isPermitted(state.principal, request);
        answer = value === true || value === "permitted" ? "permitted" : value === "unavailable" ? "unavailable" : "denied";
      } catch {
        answer = "unavailable";
      }
      if (answer === "unavailable") return unavailable();
      permitted = answer === "permitted";
    } else {
      try {
        permitted = (await isPermitted(state.principal, request)) === true;
      } catch {
        permitted = false;
      }
    }
    if (!permitted) {
      if (navigation) {
        return applyGatedHostHeaders(new Response(null, { status: 307, headers: { Location: notAuthorizedPath } }));
      }
      return jsonResponse(403, { error: "forbidden" });
    }

    return render(false);
  };
}
