import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

import { createSiteProxy, NEXT_DECLARED_RANGE } from "./proxy.js";

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

describe("the next peer-version guard (#889)", () => {
  it("keeps NEXT_DECLARED_RANGE in sync with package.json's declared peer range", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(NEXT_DECLARED_RANGE).toBe(manifest.peerDependencies.next);
    expect(manifest.peerDependenciesMeta.next?.optional).toBe(true);
  });

  it("importing this module does not throw against this repository's own real installed next — proxy.ts's own assertPeerVersion(...) call, unmocked", () => {
    // Unlike @clerk/nextjs/server above, next/server (and next/package.json,
    // which NEXT_DECLARED_RANGE's guard reads) are never mocked in this
    // file — #889 named this file's total @clerk/nextjs/server mock as
    // exactly what let the missing guards ship unnoticed for that peer;
    // this assertion exercises the real, installed next the same way
    // server-routes.test.ts already does for its own two guards.
    expect(NEXT_DECLARED_RANGE).toBe(">=16 <17");
  });
});
