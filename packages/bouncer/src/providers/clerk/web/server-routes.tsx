import { createAllowedOriginPolicy, resolveSafeRedirect } from "../../../redirect.js";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { ReactNode } from "react";
import { ClerkSignInBlock, type ClerkSignInProps } from "./client.js";
import { devAuthBypassIsKeyless } from "./dev-bypass.js";
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
 * exactly — `server-routes.test.ts` asserts that directly.
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
  return async function ClerkSignInPage({ searchParams }: PageProps = {}) {
    const keylessBypass = devAuthBypassIsKeyless() && !options.publishableKey?.trim();
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

export interface SignOutRouteOptions {
  extraCookiesToClear?: readonly string[];
  redirectTo?: string;
  allowedRedirectOrigins?: readonly string[];
  publishableKey?: string;
  getRedirectTarget?: (request: Request) => string | null;
}

function isSameOriginPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin !== origin.trim() || origin.includes("\\")) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.origin === new URL(request.url).origin;
  } catch { return false; }
}

/** Creates a same-origin POST route that revokes the active session before redirecting. */
export function createSignOutRoute(options: SignOutRouteOptions = {}) {
  return async function POST(request: Request) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    if (!isSameOriginPost(request)) return new Response(null, { status: 403 });
    if (!devAuthBypassIsKeyless() || Boolean(options.publishableKey?.trim())) {
      const session = await auth();
      if (session.sessionId) { const client = await clerkClient(); await client.sessions.revokeSession(session.sessionId); }
    }
    const jar = await cookies();
    for (const name of options.extraCookiesToClear ?? []) jar.delete(name);
    const dynamic = options.getRedirectTarget?.(request) ?? null;
    const target = resolveRequestRedirect(request.url, [dynamic, options.redirectTo, "/"], options.allowedRedirectOrigins) ?? new URL("/", request.url).toString();
    return NextResponse.redirect(target, 303);
  };
}
