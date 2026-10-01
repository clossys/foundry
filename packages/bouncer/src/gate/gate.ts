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
 *      asking the provider. A path with an encoded slash, backslash, dot or
 *      percent sign, a doubled slash or a dot segment is ambiguous: it takes
 *      neither pass-through and is gated like any other.
 *   4. Anything not signed in, including an unavailable provider, fails
 *      closed: a navigation gets a 307 to the sign-in route, any other
 *      request (and any API route) a 401 with an RFC 9728 challenge.
 *   5. A signed-in principal the permission check does not approve with
 *      exactly `true` gets a 307 to the not-authorized route (navigation) or
 *      a 403 (anything else). The not-authorized route is forced to 403.
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
 */
import { applyGatedHostHeaders, createServiceUnavailableResponse } from "../host-responses.js";
import { createAllowedOriginPolicy, resolveSafeRedirect } from "../redirect.js";

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

export interface GatedHostGateOptions<P = unknown> {
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

export type GatedHostGate = (request: Request, next: GatedHostNext) => Promise<Response>;

/** Options for {@link createReturnUrlResolver}. */
export interface ReturnUrlResolverOptions {
  /** This host's own public origin. */
  readonly origin: string;
  /** Explicit sibling origins a return URL may name. */
  readonly siblingOrigins?: readonly string[];
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

/** A path a downstream router could read as a different route than the one matched here. */
function isAmbiguousPath(pathname: string): boolean {
  if (pathname.includes("\\") || pathname.includes("//") || /%(?:2f|5c|2e|25|00)/i.test(pathname)) return true;
  return pathname.split("/").some(isDotSegment);
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
export function createReturnUrlResolver(options: ReturnUrlResolverOptions): (value: string | null | undefined) => string {
  if (options === null || typeof options !== "object") throw new TypeError("Return-URL options must be an object.");
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
export function createGatedHostGate<P = unknown>(options: GatedHostGateOptions<P>): GatedHostGate {
  if (options === null || typeof options !== "object") throw new TypeError("Gate options must be an object.");
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
  if (options.production !== undefined && typeof options.production !== "boolean") throw new TypeError("production must be a boolean.");

  const returnUrl = createReturnUrlResolver({ origin: options.origin, siblingOrigins: options.siblingOrigins });
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

    /** Renders `next`; a throw or a non-Response becomes a 503, and `status` overrides the rendered one. */
    const render = async (providerUnavailable: boolean, status?: number): Promise<Response> => {
      try {
        const rendered = await next({ providerUnavailable });
        if (!(rendered instanceof Response)) return unavailable();
        const response = reissue(rendered, status ?? rendered.status);
        if (status === 503) response.headers.set("Retry-After", retryAfter);
        return applyGatedHostHeaders(response, status === undefined ? undefined : { noStore: true });
      } catch {
        return unavailable();
      }
    };

    const ambiguous = isAmbiguousPath(pathname);
    const isSignIn = !ambiguous && (pathname === signInPath || pathname.startsWith(signInPrefix));

    if (!isSignIn && !ambiguous && isPublicPath !== undefined) {
      let isPublic = false;
      try {
        isPublic = isPublicPath(pathname) === true;
      } catch {
        isPublic = false;
      }
      if (isPublic) return render(false);
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

    const isApi = apiPrefixes.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
    const navigation = !isApi && isNavigationRequest(request);

    if (state.state !== "signed-in") {
      if (navigation) {
        const location = `${signInPath}?redirect_url=${encodeURIComponent(returnUrl(`${pathname}${url.search}`))}`;
        return applyGatedHostHeaders(new Response(null, { status: 307, headers: { Location: location } }));
      }
      return jsonResponse(401, { error: "unauthorized" }, { "WWW-Authenticate": challenge });
    }

    if (pathname === notAuthorizedPath) return render(false, 403);

    let permitted = false;
    try {
      permitted = (await isPermitted(state.principal, request)) === true;
    } catch {
      permitted = false;
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
