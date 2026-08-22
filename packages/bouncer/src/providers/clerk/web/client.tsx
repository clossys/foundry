"use client";

import { ClerkProvider, SignIn } from "@clerk/nextjs";
import { Fragment, version as reactVersion, type ComponentProps, type ReactNode } from "react";
import { devAuthBypassIsKeyless } from "./dev-bypass.js";
import { assertPeerVersion } from "../../../internal/peer-version.js";

/**
 * `react` is one of this package's optional peers (see package.json's
 * `peerDependenciesMeta`). This is a `"use client"` module — reachable
 * from a browser bundle, not just a Node process — so the version check
 * reads `react`'s own exported `version` directly rather than
 * `resolve-installed-peer-version.ts`'s Node-only fs-based resolver
 * (`verify.ts` and `server-routes.tsx` are the Node-context files that
 * use that resolver — see their own comments). This file deliberately
 * imports only `assertPeerVersion` from `../../../internal/
 * peer-version.js`, never anything from `resolve-installed-peer-
 * version.js`: that file's `node:module`/`node:fs` imports cannot resolve
 * in a browser bundle at all, even for a named export never called from
 * here — see `peer-version.ts`'s own header. `@clerk/nextjs` has no
 * equivalent in-module version export to read this way, so it is guarded
 * instead from `server-routes.tsx` (the same installed copy on disk,
 * checked from a genuinely Node-context file). `REACT_DECLARED_RANGE`
 * must match package.json's `peerDependencies.react` exactly —
 * `client.test.tsx` asserts that directly.
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
