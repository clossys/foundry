import type { NextFetchEvent, NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  middleware: vi.fn(),
  matcher: vi.fn(() => false),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: clerk.middleware,
  createRouteMatcher: vi.fn(() => clerk.matcher),
}));

import { createSiteProxy } from "./proxy.js";

describe("createSiteProxy development bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    clerk.middleware.mockImplementation((_handler, options) => {
      return async () => new Response(null, {
        headers: { "x-mounted-key": String(options?.publishableKey ?? "") },
      });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mounts middleware for a static option-supplied publishable key", () => {
    createSiteProxy({ clerkOptions: { publishableKey: "configured" } });

    expect(clerk.middleware).toHaveBeenCalledOnce();
    expect(clerk.middleware.mock.calls[0]?.[1]).toMatchObject({ publishableKey: "configured" });
  });

  it("mounts middleware for a per-request option-supplied publishable key", async () => {
    const proxy = createSiteProxy({
      clerkOptions: async () => ({ publishableKey: "configured-dynamically" }),
    });

    const response = await proxy(
      new Request("https://app.example.test/account") as NextRequest,
      {} as NextFetchEvent,
    );
    expect(response?.headers.get("x-mounted-key")).toBe("configured-dynamically");
    expect(clerk.middleware).toHaveBeenCalledOnce();
  });
});
