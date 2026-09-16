import { clerkMiddleware, createRouteMatcher, type ClerkMiddlewareAuth, type ClerkMiddlewareOptions } from "@clerk/nextjs/server";
import { NextResponse, type NextMiddleware, type NextRequest } from "next/server";
import nextPackageJson from "next/package.json" with { type: "json" };
import { devAuthBypassEnabled, devAuthBypassIsKeyless } from "./dev-bypass.js";
import { assertPeerVersion } from "../../../internal/peer-version.js";

/**
 * `@clerk/nextjs` and `next` are two of this package's optional peers (see
 * package.json's `peerDependenciesMeta`). This is the EDGE-safe entry point
 * (published as `./providers/clerk/web/proxy`, reachable only through
 * `proxy-entry.ts`) — genuinely edge-runtime code, not merely "never
 * bundled for the browser": a Next.js Edge Middleware bundle has no
 * filesystem at all, so `resolveInstalledPeerVersion`
 * (`internal/resolve-installed-peer-version.ts`, `node:module`/`node:fs`
 * based) is unusable here even conditionally, for the same reason
 * `internal/peer-version.ts`'s own header gives for `client.tsx`: an ES
 * module's top-level imports are all eagerly evaluated together, and
 * `node:fs`/`node:module` cannot be resolved at all for that target —
 * confirmed empirically for THIS file's would-be resolver,
 * `resolveInstalledPeerVersion` itself, with `esbuild --bundle
 * --platform=browser`, which fails with `Could not resolve "node:fs"`
 * (and `"node:module"`, `"node:path"`) before any of this file's own code
 * would even run.
 *
 * `next` IS guarded here, unlike `@clerk/nextjs` below, because `next`'s
 * own `package.json` declares NO `exports` field at all (confirmed by
 * reading `node_modules/next/package.json` directly) — Node's `exports`
 * restriction only applies to a package that opts into it, so
 * `next/package.json` resolves as an ordinary JSON import, exactly like
 * any other file in an unrestricted package, with no `node:fs` of our own
 * involved: the module loader (Node's, or a bundler's) reads it, not this
 * file. Confirmed edge/browser-safe the same way `resolveInstalledPeerVersion`
 * above was confirmed unsafe: `esbuild --bundle --platform=browser` against
 * this file's own built `proxy.js` resolves clean — see `proxy.test.ts`.
 *
 * `@clerk/nextjs` is NOT range-guarded here, and this is a real,
 * documented gap rather than an oversight: `@clerk/nextjs`'s own
 * `package.json` DOES declare an `exports` field (`.`, `./server`,
 * `./errors`, `./internal`, `./webhooks`, `./experimental`, `./legacy`,
 * `./types`), and it does not list `./package.json` — confirmed by
 * attempting `require("@clerk/nextjs/package.json")` against the real
 * installed 7.9.1, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. Its
 * public surface also exports no version constant of any kind (confirmed
 * by grepping every file under its built `dist/` for `PACKAGE_VERSION`,
 * `SDK_VERSION`, and `LIB_VERSION` — no match). There is therefore no
 * signal this file, or `client.tsx`, could read `@clerk/nextjs`'s
 * installed version from without `node:fs` — a permanent constraint of
 * THIS peer's own published shape, not a gap in this package's effort;
 * see `client.tsx`'s own header for the identical conclusion reached
 * independently for the browser side. `@clerk/nextjs`'s PRESENCE is still
 * guarded: the unconditional import at the top of this file already
 * throws Node's own named `ERR_MODULE_NOT_FOUND` if it is not installed
 * at all, a deliberately accepted tradeoff (an absent peer still fails
 * loudly, just not with THIS package's own wording) — what remains
 * uncovered is specifically an INSTALLED-but-incompatible `@clerk/nextjs`,
 * which will surface as whatever `clerkMiddleware`/`createRouteMatcher`
 * themselves happen to throw instead of a named range error.
 * `internal/peer-guard-coverage.test.ts` encodes this as a deliberate,
 * checked exception rather than silence.
 * `NEXT_DECLARED_RANGE` must match package.json's `peerDependencies.next`
 * exactly — `proxy.test.ts` asserts that directly.
 */
export const NEXT_DECLARED_RANGE = ">=16 <17";
assertPeerVersion({ peer: "next", declaredRange: NEXT_DECLARED_RANGE, foundVersion: nextPackageJson.version });

export type ClerkMiddlewareOptionsCallback = (request: NextRequest) => ClerkMiddlewareOptions | Promise<ClerkMiddlewareOptions>;

interface SiteProxyHooks {
  clerkOptions?: ClerkMiddlewareOptions | ClerkMiddlewareOptionsCallback;
  afterAuth?: (request: NextRequest) => Response | void | Promise<Response | void>;
  decorateResponse?: (request: NextRequest, response: Response) => void;
}

export type SiteProxyConfig = SiteProxyHooks & (
  | { publicRoutes?: string[]; protectedRoutes?: never }
  | { publicRoutes?: never; protectedRoutes: string[] }
);

const DEFAULT_PUBLIC_ROUTES = ["/sign-in(.*)", "/sign-up(.*)"];

async function finishResponse(request: NextRequest, config: Pick<SiteProxyConfig, "afterAuth" | "decorateResponse">): Promise<Response> {
  const response = (await config.afterAuth?.(request)) ?? NextResponse.next();
  config.decorateResponse?.(request, response);
  return response;
}

function hasPublishableKey(options: ClerkMiddlewareOptions | undefined): boolean {
  return typeof options?.publishableKey === "string" && options.publishableKey.trim().length > 0;
}

/** Creates a Clerk-backed Next.js proxy with an explicit route policy. */
export function createSiteProxy(config: SiteProxyConfig = {}): NextMiddleware {
  if (config.publicRoutes && config.protectedRoutes) throw new TypeError("createSiteProxy accepts publicRoutes or protectedRoutes, not both");
  const isProtected = config.protectedRoutes
    ? createRouteMatcher(config.protectedRoutes)
    : (() => { const isPublic = createRouteMatcher(config.publicRoutes ?? DEFAULT_PUBLIC_ROUTES); return (request: NextRequest) => !isPublic(request); })();
  const handler = async (auth: ClerkMiddlewareAuth, request: NextRequest) => {
    if (!devAuthBypassEnabled() && isProtected(request)) await auth.protect();
    return finishResponse(request, config);
  };
  if (devAuthBypassIsKeyless()) {
    if (typeof config.clerkOptions === "function") {
      const clerkOptions = config.clerkOptions;
      return async (request, event) => {
        const options = await clerkOptions(request);
        if (!hasPublishableKey(options)) return finishResponse(request, config);
        return clerkMiddleware(handler, options)(request, event);
      };
    }
    if (!hasPublishableKey(config.clerkOptions)) return (request) => finishResponse(request, config);
  }
  if (typeof config.clerkOptions === "function") return clerkMiddleware(handler, config.clerkOptions);
  if (config.clerkOptions) return clerkMiddleware(handler, config.clerkOptions);
  return clerkMiddleware(handler);
}

export const createClerkMiddleware = createSiteProxy;
