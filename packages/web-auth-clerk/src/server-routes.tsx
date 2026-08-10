import {
  createAllowedOriginPolicy,
  resolveSafeRedirect,
} from "@vespeneventures/auth";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { ReactNode } from "react";

import { ClerkSignInBlock, type ClerkSignInProps } from "./client.js";

type SearchParameters = Record<string, string | string[] | undefined>;
type PageProps = { searchParams?: Promise<SearchParameters> };

function firstParameter(
  parameters: SearchParameters | undefined,
  name: string,
): string | undefined {
  const value = parameters?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function assertLocalPath(target: string): string {
  if (
    !target.startsWith("/")
    || target.startsWith("//")
    || target.includes("\\")
  ) {
    throw new TypeError("redirect target must be a single-slash absolute path");
  }
  return target;
}

export function resolveRequestRedirect(
  requestUrl: string,
  candidates: ReadonlyArray<string | null | undefined>,
  allowedOrigins: readonly string[] = [],
): string {
  const requestOrigin = new URL(requestUrl).origin;
  const policy = createAllowedOriginPolicy([requestOrigin, ...allowedOrigins]);
  for (const candidate of candidates) {
    const resolved = resolveSafeRedirect(candidate, policy, requestOrigin);
    if (resolved) return resolved;
  }
  return new URL("/", requestOrigin).toString();
}

export interface ClerkSignInPageOptions {
  chrome?: (children: ReactNode) => ReactNode;
  appearance?: ClerkSignInProps["appearance"];
  redirectUrl?: string;
  signedInRedirect?: string;
  redirectFromSearchParam?: string;
  /** Required before a search parameter may influence a redirect. */
  redirectOrigin?: string;
  allowedRedirectOrigins?: readonly string[];
  copy?: Pick<
    ClerkSignInProps,
    "eyebrow" | "heading" | "subtitle" | "signup_href" | "signup_label"
  >;
}

/** Creates a Next.js sign-in page with a same-origin redirect policy. */
export function createClerkSignInPage(options: ClerkSignInPageOptions = {}) {
  const configuredRedirect = options.redirectUrl
    ? assertLocalPath(options.redirectUrl)
    : undefined;
  const configuredSignedInRedirect = options.signedInRedirect
    ? assertLocalPath(options.signedInRedirect)
    : undefined;

  return async function ClerkSignInPage({ searchParams }: PageProps = {}) {
    const parameters = options.redirectFromSearchParam
      ? await searchParams
      : undefined;
    const requested = options.redirectFromSearchParam
      ? firstParameter(parameters, options.redirectFromSearchParam)
      : undefined;
    const dynamicRedirect = options.redirectOrigin
      ? resolveRequestRedirect(
          options.redirectOrigin,
          [requested],
          options.allowedRedirectOrigins,
        )
      : undefined;

    const session = await auth();
    if (session.userId) {
      redirect(
        dynamicRedirect
        ?? configuredSignedInRedirect
        ?? configuredRedirect
        ?? "/",
      );
    }

    const form = (
      <ClerkSignInBlock
        appearance={options.appearance}
        redirect_url={dynamicRedirect ?? configuredRedirect}
        {...options.copy}
      />
    );
    return options.chrome ? options.chrome(form) : form;
  };
}

/** Creates a permanent redirect for a fixed, local compatibility route. */
export function createRedirectRoute(target: string) {
  const safeTarget = assertLocalPath(target);
  return async function GET() {
    permanentRedirect(safeTarget);
  };
}

export interface SignOutRouteOptions {
  extraCookiesToClear?: readonly string[];
  redirectTo?: string;
  allowedRedirectOrigins?: readonly string[];
  getRedirectTarget?: (request: Request) => string | null;
}

/** Creates a GET route that revokes the active session before redirecting. */
export function createSignOutRoute(options: SignOutRouteOptions = {}) {
  return async function GET(request: Request) {
    const session = await auth();
    if (session.sessionId) {
      const client = await clerkClient();
      await client.sessions.revokeSession(session.sessionId);
    }

    const jar = await cookies();
    for (const name of options.extraCookiesToClear ?? []) {
      jar.delete(name);
    }

    const dynamic = options.getRedirectTarget?.(request) ?? null;
    const target = resolveRequestRedirect(
      request.url,
      [dynamic, options.redirectTo, "/"],
      options.allowedRedirectOrigins,
    );
    return NextResponse.redirect(target);
  };
}
