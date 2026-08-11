import { Fragment } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, humaniseClerkError } from "./client.js";

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
