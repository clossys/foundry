import { describe, expect, it } from "vitest";

import { devAuthBypassEnabled, devAuthBypassIsKeyless } from "./dev-bypass.js";

describe("development auth bypass", () => {
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
});
