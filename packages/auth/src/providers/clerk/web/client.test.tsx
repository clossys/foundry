import { Children, Fragment, isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, ClerkSignInBlock, humaniseClerkError } from "./client.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AuthProvider", () => {
  it("honors a caller-supplied publishable key during development bypass", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");

    const element = AuthProvider({ children: "content", publishableKey: "configured" });
    expect(element.type).not.toBe(Fragment);
    expect(element.props).toMatchObject({ publishableKey: "configured" });
  });

  it("treats a whitespace-only publishable key as keyless during development bypass", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");

    const element = AuthProvider({ children: "content", publishableKey: "  " });
    expect(element.type).toBe(Fragment);
  });
});

describe("ClerkSignInBlock", () => {
  it("passes the sanitized redirect as forceRedirectUrl, not fallbackRedirectUrl, so it wins over Clerk's own redirect_url query param", () => {
    const element = ClerkSignInBlock({ redirect_url: "https://app.example.test/account" });
    const signIn = Children.toArray(element.props.children).find(
      (child): child is ReactElement<{ forceRedirectUrl?: string; fallbackRedirectUrl?: string }> =>
        isValidElement(child) && "forceRedirectUrl" in (child.props as Record<string, unknown>),
    );

    expect(signIn).toBeDefined();
    // forceRedirectUrl has precedence over other redirect props, environment
    // variables, or search params (including Clerk's own `redirect_url`
    // query param read at render time); fallbackRedirectUrl only applies
    // when nothing else supplies a value, so a raw query param could win
    // over it. The sanitized value must be wired to the prop that wins.
    expect(signIn?.props.forceRedirectUrl).toBe("https://app.example.test/account");
    expect(signIn?.props.fallbackRedirectUrl).toBeUndefined();
  });
});

describe("humaniseClerkError", () => {
  it("prefers provider detail without leaking the whole object", () => {
    expect(humaniseClerkError({
      errors: [{ longMessage: "The supplied code has expired." }],
      privateValue: "must not appear",
    })).toBe("The supplied code has expired.");
  });

  it("turns a provider code into readable fallback text", () => {
    expect(humaniseClerkError({ errors: [{ code: "form_code_incorrect" }] }))
      .toBe("Form code incorrect.");
  });

  it("uses a stable generic message for unknown values", () => {
    expect(humaniseClerkError(null)).toBe("Authentication failed.");
  });
});
