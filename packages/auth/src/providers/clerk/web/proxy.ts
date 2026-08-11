import { clerkMiddleware, createRouteMatcher, type ClerkMiddlewareAuth, type ClerkMiddlewareOptions } from "@clerk/nextjs/server";
import { NextResponse, type NextMiddleware, type NextRequest } from "next/server";
import { devAuthBypassEnabled, devAuthBypassIsKeyless } from "./dev-bypass.js";

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
