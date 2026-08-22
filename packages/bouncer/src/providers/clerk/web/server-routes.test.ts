import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  cookies: vi.fn(),
  revokeSession: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: provider.auth,
  clerkClient: provider.clerkClient,
}));

vi.mock("next/headers", () => ({ cookies: provider.cookies }));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLERK_NEXTJS_DECLARED_RANGE,
  createClerkSignInPage,
  createRedirectRoute,
  createSignOutRoute,
  NEXT_DECLARED_RANGE,
  resolveRequestRedirect,
} from "./server-routes.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveRequestRedirect", () => {
  const request = "https://app.example.test/sign-out";

  it("accepts a same-origin relative path", () => {
    expect(resolveRequestRedirect(request, ["/account"]))
      .toBe("https://app.example.test/account");
  });

  it.each([
    "//other.example.test/path",
    "https://other.example.test/path",
    "javascript:alert(1)",
    "\\other.example.test/path",
    "https://user:password@app.example.test/path",
  ])("rejects unsafe target %s", (target) => {
    expect(resolveRequestRedirect(request, [target]))
      .toBeUndefined();
  });

  it("returns no dynamic redirect when candidates are missing or rejected", () => {
    expect(resolveRequestRedirect(request, [undefined, null, "//other.example.test/path"]))
      .toBeUndefined();
  });

  it("allows an explicitly trusted second origin", () => {
    expect(resolveRequestRedirect(
      request,
      ["https://accounts.example.test/complete"],
      ["https://accounts.example.test"],
    )).toBe("https://accounts.example.test/complete");
  });

  it("deduplicates the implicit request origin after normalization", () => {
    expect(resolveRequestRedirect(
      request,
      ["/account"],
      ["https://APP.EXAMPLE.TEST:443"],
    )).toBe("https://app.example.test/account");
  });
});

describe("fixed redirect targets", () => {
  it.each(["//other.example.test", "/%5Cother.example.test", "/account\nnext", " /account"])("rejects unsafe local redirect target %s", (target) => {
    expect(() => createRedirectRoute(target)).toThrow(TypeError);
    expect(() => createClerkSignInPage({ redirectUrl: target })).toThrow(TypeError);
  });
});

describe("createSignOutRoute", () => {
  const route = createSignOutRoute();

  beforeEach(() => {
    vi.clearAllMocks();
    provider.auth.mockResolvedValue({ sessionId: null });
    provider.clerkClient.mockResolvedValue({ sessions: { revokeSession: provider.revokeSession } });
    provider.cookies.mockResolvedValue({ delete: provider.deleteCookie });
  });

  it("rejects state-changing GET requests", async () => {
    const response = await route(new Request("https://app.example.test/sign-out"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects missing and cross-origin POST origins before session access", async () => {
    const missing = await route(new Request("https://app.example.test/sign-out", { method: "POST" }));
    expect(missing.status).toBe(403);

    const crossOrigin = await route(new Request("https://app.example.test/sign-out", {
      method: "POST",
      headers: { Origin: "https://outside.example.test" },
    }));
    expect(crossOrigin.status).toBe(403);
  });

  it("converts the successful sign-out POST into a GET navigation", async () => {
    const response = await route(new Request("https://app.example.test/sign-out", {
      method: "POST",
      headers: { Origin: "https://app.example.test" },
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/");
  });

  it("skips Clerk session access in a keyless development bypass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const response = await route(new Request("https://app.example.test/sign-out", {
      method: "POST",
      headers: { Origin: "https://app.example.test" },
    }));

    expect(response.status).toBe(303);
    expect(provider.auth).not.toHaveBeenCalled();
  });

  it("revokes Clerk sessions when a public key is supplied outside the environment", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    provider.auth.mockResolvedValue({ sessionId: "session_synthetic" });
    const configuredRoute = createSignOutRoute({ publishableKey: "configured" });
    const response = await configuredRoute(new Request("https://app.example.test/sign-out", {
      method: "POST",
      headers: { Origin: "https://app.example.test" },
    }));

    expect(response.status).toBe(303);
    expect(provider.revokeSession).toHaveBeenCalledWith("session_synthetic");
  });
});

describe("createClerkSignInPage", () => {
  it("renders without Clerk server auth in a keyless development bypass", async () => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const page = createClerkSignInPage();

    await expect(page()).resolves.toBeNull();
    expect(provider.auth).not.toHaveBeenCalled();
  });

  it("uses Clerk server auth when a public key is supplied outside the environment", async () => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    provider.auth.mockResolvedValue({ userId: null });
    const page = createClerkSignInPage({ publishableKey: "configured" });

    await expect(page()).resolves.toBeTruthy();
    expect(provider.auth).toHaveBeenCalledOnce();
  });
});

describe("the @clerk/nextjs and next peer-version guards (#182)", () => {
  it("keeps both declared-range constants in sync with package.json's declared peer ranges", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(CLERK_NEXTJS_DECLARED_RANGE).toBe(manifest.peerDependencies["@clerk/nextjs"]);
    expect(manifest.peerDependenciesMeta["@clerk/nextjs"]?.optional).toBe(true);
    expect(NEXT_DECLARED_RANGE).toBe(manifest.peerDependencies.next);
    expect(manifest.peerDependenciesMeta.next?.optional).toBe(true);
  });

  it("importing this module does not throw against this repository's own real installed peers", () => {
    // server-routes.tsx calls assertPeerVersion(...) twice at module load
    // time (see its own header comment); this file already imported from
    // it above, so reaching this test at all is itself the assertion that
    // neither call threw against the real @clerk/nextjs / next this
    // workspace has installed.
    expect(CLERK_NEXTJS_DECLARED_RANGE).toBe(">=7 <8");
    expect(NEXT_DECLARED_RANGE).toBe(">=16 <17");
  });
});
