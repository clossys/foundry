/**
 * One gate contract for gated application hosts. Framework-neutral: it reads
 * a Fetch `Request` and answers with a Fetch `Response`, so a consumer's
 * proxy supplies only host-specific options — sign-in path, not-authorized
 * path, sibling-origin allowlist, and a permission check. The identity
 * provider is a seam (`resolvePrincipal`), never imported here.
 *
 * Decisions, in the order they are made:
 *   1. Every response, including redirects and errors, carries
 *      `X-Robots-Tag: noindex, nofollow`.
 *   2. The RFC 9728 metadata path is served (when configured) or passed
 *      through, never gated.
 *   3. The sign-in path passes through. When the provider is unavailable or
 *      unconfigured it is still reached, with `providerUnavailable` set, and
 *      in production the response is forced to 503 with `Retry-After`.
 *   4. A signed-out or provider-unavailable request to a gated route fails
 *      closed: a navigation gets a 307 to the same host's sign-in route with
 *      a validated relative `redirect_url`; an API route or non-navigation
 *      request gets a 401 JSON body with an RFC 9728 `WWW-Authenticate`.
 *   5. A signed-in principal without permission gets a 307 (navigation) to
 *      the not-authorized route, or a 403 JSON body (API / non-navigation).
 *      The not-authorized route itself is always answered with 403.
 *
 * A provider that throws is treated as unavailable. Nothing here answers 500.
 */

export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const ROBOTS = "noindex, nofollow";

/** What the identity provider said about this request. */
export type GatePrincipalState<P = unknown> =
  | { readonly state: "signed-out" }
  | { readonly state: "unavailable" }
  | { readonly state: "signed-in"; readonly principal: P };

/** Renders the pass-through response. `providerUnavailable` is set on the sign-in route when the provider did not answer. */
export type GatedHostNext = (context: { readonly providerUnavailable: boolean }) => Response | Promise<Response>;

/** RFC 9728 protected resource metadata document. */
export interface ProtectedResourceMetadata {
  readonly resource?: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly bearer_methods_supported?: readonly string[];
}

export interface GatedHostGateOptions<P = unknown> {
  /** Same-host sign-in route, e.g. `/sign-in`. */
  readonly signInPath: string;
  /** Same-host route that renders the not-authorized page. The gate forces it to answer 403. */
  readonly notAuthorizedPath: string;
  /** Explicit sibling origins a return URL may name. Everything else falls back to `/`. */
  readonly siblingOrigins?: readonly string[];
  /** Asks the identity provider. A throw or rejection is treated as `unavailable`. */
  readonly resolvePrincipal: (request: Request) => GatePrincipalState<P> | Promise<GatePrincipalState<P>>;
  /** Permission check for a signed-in principal. Omitted means every signed-in principal is permitted. A throw denies. */
  readonly isPermitted?: (principal: P, request: Request) => boolean | Promise<boolean>;
  /** Extra path predicate for routes that must stay reachable without sign-in. */
  readonly isPublicPath?: (pathname: string) => boolean;
  /** Path prefixes always answered as API routes. Defaults to `["/api/"]`. */
  readonly apiPathPrefixes?: readonly string[];
  /** When set, the gate serves the RFC 9728 document itself. Otherwise the path passes through to `next`. */
  readonly protectedResourceMetadata?: ProtectedResourceMetadata;
  /** Production forces the unavailable sign-in state to 503 with `Retry-After`. Default false. */
  readonly production?: boolean;
  /** Seconds for `Retry-After`. Default 30. */
  readonly retryAfterSeconds?: number;
}

export type GatedHostGate = (request: Request, next: GatedHostNext) => Promise<Response>;

/**
 * A request is a navigation when the browser says so (`Sec-Fetch-Mode:
 * navigate`), when it accepts HTML, or when it is a Next.js router request
 * (`RSC` header or `_rsc` query parameter).
 */
export function isNavigationRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate") return true;
  if (/\btext\/html\b/i.test(request.headers.get("accept") ?? "")) return true;
  if (request.headers.has("rsc")) return true;
  try {
    return new URL(request.url).searchParams.has("_rsc");
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Validates a return URL: a same-host relative path, or an absolute URL whose
 * origin is in `siblingOrigins`. Everything else returns `/`.
 */
export function resolveReturnUrl(value: string | null | undefined, siblingOrigins: readonly string[] = []): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return "/";
  if (value.includes("\\") || /%5c/i.test(value) || /[\u0000-\u001f]/.test(value)) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/")) return value;
  if (!/^https?:\/\//i.test(value)) return "/";
  const origin = normalizeOrigin(value);
  if (origin === undefined) return "/";
  const allowed = siblingOrigins.map(normalizeOrigin).filter((o): o is string => o !== undefined);
  return allowed.includes(origin) ? new URL(value).href : "/";
}

/** Builds the RFC 9728 document for a request origin. `resource` defaults to that origin. */
export function buildProtectedResourceMetadata(origin: string, metadata: ProtectedResourceMetadata): Record<string, unknown> {
  return { ...metadata, resource: metadata.resource ?? origin };
}

function assertPath(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new TypeError(`${name} must be a same-host absolute path.`);
  }
}

function withHeaders(response: Response, extra: Record<string, string>, status?: number): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set("x-robots-tag", ROBOTS);
  if (status === undefined && response.status >= 300 && response.status < 400 && response.body === null) {
    return new Response(null, { status: response.status, headers });
  }
  return new Response(response.body, { status: status ?? response.status, statusText: status === undefined ? response.statusText : "", headers });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": ROBOTS, ...headers },
  });
}

/** Creates the gate. Call the result from a consumer's proxy; it always returns a Response. */
export function createGatedHostGate<P = unknown>(options: GatedHostGateOptions<P>): GatedHostGate {
  assertPath("signInPath", options.signInPath);
  assertPath("notAuthorizedPath", options.notAuthorizedPath);
  if (typeof options.resolvePrincipal !== "function") throw new TypeError("resolvePrincipal must be a function.");
  const siblings = options.siblingOrigins ?? [];
  const apiPrefixes = options.apiPathPrefixes ?? ["/api/"];
  const retryAfter = String(options.retryAfterSeconds ?? 30);

  return async (request, next) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isApi = apiPrefixes.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
    const navigation = !isApi && isNavigationRequest(request);
    const resourceMetadata = `${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}`;

    if (pathname === PROTECTED_RESOURCE_METADATA_PATH) {
      if (options.protectedResourceMetadata !== undefined) {
        return json(200, buildProtectedResourceMetadata(url.origin, options.protectedResourceMetadata), {
          "cache-control": "public, max-age=300",
        });
      }
      return withHeaders(await next({ providerUnavailable: false }), {});
    }

    let state: GatePrincipalState<P>;
    try {
      state = await options.resolvePrincipal(request);
    } catch {
      state = { state: "unavailable" };
    }

    if (pathname === options.signInPath) {
      const unavailable = state.state === "unavailable";
      const response = await next({ providerUnavailable: unavailable });
      if (unavailable && options.production === true) {
        return withHeaders(response, { "retry-after": retryAfter, "cache-control": "no-store" }, 503);
      }
      return withHeaders(response, {});
    }

    if (options.isPublicPath?.(pathname) === true) return withHeaders(await next({ providerUnavailable: false }), {});

    if (state.state !== "signed-in") {
      if (navigation) {
        const target = new URL(options.signInPath, url.origin);
        target.searchParams.set("redirect_url", resolveReturnUrl(`${pathname}${url.search}`, siblings));
        return new Response(null, {
          status: 307,
          headers: { location: `${target.pathname}${target.search}`, "cache-control": "no-store", "x-robots-tag": ROBOTS },
        });
      }
      return json(401, { error: "unauthorized" }, {
        "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"`,
      });
    }

    let permitted = true;
    if (options.isPermitted !== undefined) {
      try {
        permitted = (await options.isPermitted(state.principal, request)) === true;
      } catch {
        permitted = false;
      }
    }

    if (pathname === options.notAuthorizedPath) {
      const response = await next({ providerUnavailable: false });
      return withHeaders(response, { "cache-control": "no-store" }, 403);
    }

    if (!permitted) {
      if (navigation) {
        return new Response(null, {
          status: 307,
          headers: { location: options.notAuthorizedPath, "cache-control": "no-store", "x-robots-tag": ROBOTS },
        });
      }
      return json(403, { error: "forbidden" });
    }

    return withHeaders(await next({ providerUnavailable: false }), {});
  };
}
