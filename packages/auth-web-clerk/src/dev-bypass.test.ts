import { afterEach, describe, expect, it, vi } from "vitest";

import { devAuthBypassEnabled, devAuthBypassIsKeyless } from "./dev-bypass.js";

describe("development auth bypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled in production even when the flag is set", () => {
    expect(devAuthBypassEnabled({
      NODE_ENV: "production",
      NEXT_PUBLIC_DEV_NO_AUTH: "1",
    })).toBe(false);
  });

  it("requires the explicit flag outside production", () => {
    expect(devAuthBypassEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devAuthBypassEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_DEV_NO_AUTH: "1",
    })).toBe(true);
  });

  it("reports keyless state only while the bypass is active", () => {
    expect(devAuthBypassIsKeyless({
      NODE_ENV: "test",
      NEXT_PUBLIC_DEV_NO_AUTH: "1",
    })).toBe(true);
    expect(devAuthBypassIsKeyless({
      NODE_ENV: "test",
      NEXT_PUBLIC_DEV_NO_AUTH: "1",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "configured",
    })).toBe(false);
  });

  it("reads the statically named public variables when no environment is injected", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");

    expect(devAuthBypassEnabled()).toBe(true);
    expect(devAuthBypassIsKeyless()).toBe(true);
  });
});
