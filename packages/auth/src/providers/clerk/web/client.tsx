"use client";

import { ClerkProvider, SignIn } from "@clerk/nextjs";
import { Fragment, type ComponentProps, type ReactNode } from "react";
import { devAuthBypassIsKeyless } from "./dev-bypass.js";

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
  if (devAuthBypassIsKeyless() && !props.publishableKey) return <Fragment>{children}</Fragment>;
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
      <SignIn appearance={appearance ?? CLERK_APPEARANCE} fallbackRedirectUrl={redirect_url} signUpUrl={signup_href} />
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
