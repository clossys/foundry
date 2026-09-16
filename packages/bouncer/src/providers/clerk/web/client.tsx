"use client";

import { ClerkProvider, SignIn } from "@clerk/nextjs";
import { Fragment, version as reactVersion, type ComponentProps, type ReactNode } from "react";
import { devAuthBypassIsKeyless } from "./dev-bypass.js";
import { assertPeerVersion } from "../../../internal/peer-version.js";

/**
 * `react` and `@clerk/nextjs` are two of this package's optional peers
 * (see package.json's `peerDependenciesMeta`). This is a `"use client"`
 * module — reachable from a browser bundle, not just a Node process — so
 * `react`'s version check reads its own exported `version` directly
 * rather than `resolve-installed-peer-version.ts`'s Node-only fs-based
 * resolver (`verify.ts` and `server-routes.tsx` are the Node-context
 * files that use that resolver — see their own comments). This file
 * deliberately imports only `assertPeerVersion` from `../../../internal/
 * peer-version.js`, never anything from `resolve-installed-peer-
 * version.js`: that file's `node:module`/`node:fs` imports cannot resolve
 * in a browser bundle at all, even for a named export never called from
 * here — see `peer-version.ts`'s own header, and confirmed directly
 * against this package's own `resolveInstalledPeerVersion`: `esbuild
 * --bundle --platform=browser` against it fails with `Could not resolve
 * "node:fs"` (and `"node:module"`, `"node:path"`).
 *
 * `@clerk/nextjs` is imported unconditionally above but is NOT
 * range-guarded in this file, and this is a real, documented gap, not an
 * oversight — and NOT, contrary to an earlier version of this comment,
 * covered by `server-routes.tsx`: `./providers/clerk/web` and
 * `./providers/clerk/web/client` (this file's own two `exports` subpaths)
 * resolve to `client-index.ts` / `index.ts`, both of which re-export
 * exclusively from THIS file, and neither ever imports
 * `server-routes.tsx` — confirmed by reading their own `export … from`
 * statements, not assumed. `@clerk/nextjs` publishes no version signal
 * this file could read even if it wanted to: its own `package.json`
 * declares an `exports` field (`.`, `./server`, `./errors`, `./internal`,
 * `./webhooks`, `./experimental`, `./legacy`, `./types`) that does not
 * list `./package.json` — confirmed by attempting
 * `require("@clerk/nextjs/package.json")` against the real installed
 * 7.9.1, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — and its public
 * surface exports no version constant of any kind (confirmed by grepping
 * every file under its built `dist/` for `PACKAGE_VERSION`,
 * `SDK_VERSION`, and `LIB_VERSION` — no match). The only technique that
 * CAN read it, `resolveInstalledPeerVersion`, needs `node:fs`, which is
 * unusable here for the same reason it is unusable for `react` above.
 * This is a permanent constraint of `@clerk/nextjs`'s own published
 * shape, not a gap in this package's effort — see `proxy.ts`'s own header
 * for the identical conclusion reached independently for the edge-safe
 * side, and `internal/peer-guard-coverage.test.ts`, which encodes this as
 * a deliberate, checked exception rather than silence. `@clerk/nextjs`'s
 * PRESENCE is still guarded: the unconditional import above already
 * throws Node's own named `ERR_MODULE_NOT_FOUND` if it is not installed
 * at all, deliberately accepted as sufficient (see `docs/DECISIONS.md`
 * entry 24); what remains uncovered is specifically an
 * INSTALLED-but-incompatible `@clerk/nextjs`.
 *
 * `REACT_DECLARED_RANGE` must match package.json's
 * `peerDependencies.react` exactly — `client.test.tsx` asserts that
 * directly.
 */
export const REACT_DECLARED_RANGE = ">=19 <20";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export const CLERK_APPEARANCE = Object.freeze({
  variables: {
    colorBackground: "var(--background, #ffffff)",
    colorForeground: "var(--foreground, #111111)",
    colorPrimary: "var(--primary, #111111)",
    colorInputBackground: "var(--background, #ffffff)",
    colorInputText: "var(--foreground, #111111)",
  },
  elements: { cardBox: "shadow-none", card: "shadow-none border border-solid" },
});

export interface AuthProviderProps extends Omit<ComponentProps<typeof ClerkProvider>, "children"> {
  children: ReactNode;
}

/** Mounts Clerk, or renders children in the explicit keyless development bypass. */
export function AuthProvider({ children, ...props }: AuthProviderProps) {
  if (devAuthBypassIsKeyless() && !props.publishableKey?.trim()) return <Fragment>{children}</Fragment>;
  return <ClerkProvider {...props}>{children}</ClerkProvider>;
}

export interface ClerkSignInProps {
  appearance?: Record<string, unknown>;
  redirect_url?: string;
  eyebrow?: string;
  heading?: string;
  subtitle?: string;
  signup_href?: string;
  signup_label?: string;
}

export function ClerkSignInBlock({ appearance, redirect_url, eyebrow, heading, subtitle, signup_href, signup_label = "Create an account" }: ClerkSignInProps) {
  return (
    <section aria-labelledby="clerk-sign-in-heading">
      {eyebrow ? <p>{eyebrow}</p> : null}
      <h1 id="clerk-sign-in-heading">{heading ?? "Sign in"}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      <SignIn appearance={appearance ?? CLERK_APPEARANCE} forceRedirectUrl={redirect_url} signUpUrl={signup_href} />
      {signup_href ? <a href={signup_href}>{signup_label}</a> : null}
    </section>
  );
}

type ErrorShape = { errors?: Array<{ longMessage?: unknown; message?: unknown; code?: unknown }>; message?: unknown };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function humaniseClerkError(error: unknown): string {
  if (!error || typeof error !== "object") return "Authentication failed.";
  const shaped = error as ErrorShape;
  const first = shaped.errors?.[0];
  const direct = nonEmptyString(first?.longMessage) ?? nonEmptyString(first?.message) ?? nonEmptyString(shaped.message);
  if (direct) return direct;
  const code = nonEmptyString(first?.code);
  if (!code) return "Authentication failed.";
  const words = code.replaceAll("_", " ").trim();
  return words ? `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}.` : "Authentication failed.";
}
