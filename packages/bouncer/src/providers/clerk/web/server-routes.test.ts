import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  cookies: vi.fn(),
  revokeSession: vi.fn(),
  deleteCookie: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: provider.auth,
  clerkClient: provider.clerkClient,
  verifyToken: provider.verifyToken,
}));

vi.mock("next/headers", () => ({ cookies: provider.cookies }));

import { createSign, generateKeyPairSync } from "node:crypto";
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
    "/.//other.example.test/path",
    "/%2e%2e//other.example.test/path",
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
    vi.stubEnv("CLERK_SECRET_KEY", "configured");
    provider.auth.mockResolvedValue({ userId: null });
    const page = createClerkSignInPage({ publishableKey: "configured" });

    await expect(page()).resolves.toBeTruthy();
    expect(provider.auth).toHaveBeenCalledOnce();
  });

  describe("missing provider settings", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "");
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
      vi.stubEnv("CLERK_SECRET_KEY", "");
      provider.auth.mockResolvedValue({ userId: null });
    });

    it("writes one server log line naming the missing settings, once for the page, with no values", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const page = createClerkSignInPage();
        await page();
        await page();
        const lines = log.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("[bouncer]"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
        expect(lines[0]).toContain("CLERK_SECRET_KEY");
      } finally {
        log.mockRestore();
      }
    });

    it("writes nothing when the settings are present", async () => {
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "configured-public");
      vi.stubEnv("CLERK_SECRET_KEY", "configured-secret");
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await createClerkSignInPage()();
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it("writes nothing in the explicit keyless development bypass", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await createClerkSignInPage()();
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });
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

describe("createSignOutRoute hardened (explicit opt-in only)", () => {
  const ORIGIN = "https://app.example.test";
  const ISSUER = "https://clerk.app.example.test";
  // A synthetic key pair made for this run only; it signs nothing outside these tests.
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwtKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
  function sign(claims: Record<string, unknown>, privateKey = keys.privateKey): string {
    const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "ins_synthetic" }));
    const body = base64url(JSON.stringify(claims));
    const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey);
    return `${head}.${body}.${base64url(signature)}`;
  }
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: ISSUER,
    azp: ORIGIN,
    sub: "user_synthetic",
    sid: "sess_expired1",
    iat: nowSeconds() - 120,
    exp: nowSeconds() - 60,
    ...overrides,
  });
  const fallback = { jwtKey, issuer: ISSUER, authorizedParties: [ORIGIN], maxExpiredAgeMs: 600_000 } as const;
  const hardened = (extra: Record<string, unknown> = {}) =>
    createSignOutRoute({
      hardened: true,
      origin: ORIGIN,
      path: "/sign-out",
      confirmationPath: "/signed-out/confirm",
      expiredSessionFallback: fallback,
      ...extra,
    } as Parameters<typeof createSignOutRoute>[0] & { hardened: true });
  const post = (headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/sign-out`, { method: "POST", headers: { Origin: ORIGIN, ...headers } });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "");
    const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
    provider.verifyToken.mockImplementation(actual.verifyToken);
    provider.auth.mockResolvedValue({ sessionId: null });
    provider.clerkClient.mockResolvedValue({ sessions: { revokeSession: provider.revokeSession } });
    provider.cookies.mockResolvedValue({ delete: provider.deleteCookie });
    provider.revokeSession.mockResolvedValue(undefined);
  });

  it("answers GET and HEAD with a confirmation redirect and no provider read or cookie change", async () => {
    const route = hardened();
    for (const method of ["GET", "HEAD"]) {
      const response = await route(new Request(`${ORIGIN}/sign-out`, { method, headers: { Cookie: `__session=${sign(claims())}` } }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/signed-out/confirm`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(provider.auth).not.toHaveBeenCalled();
    expect(provider.verifyToken).not.toHaveBeenCalled();
    expect(provider.clerkClient).not.toHaveBeenCalled();
    expect(provider.cookies).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin POST before any provider read", async () => {
    const response = await hardened()(post({ Origin: "https://outside.example.test" }));
    expect(response.status).toBe(403);
    expect(provider.auth).not.toHaveBeenCalled();
  });

  it("revokes the active session and expires the default Clerk cookies through response headers only", async () => {
    provider.auth.mockResolvedValue({ sessionId: "sess_active1" });
    const response = await hardened()(post({ Cookie: "__session_Ab1=x; __client_uat=0" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
    const cleared = response.headers.getSetCookie().map((value) => value.split("=")[0]);
    expect(cleared).toEqual(["__session", "__client_uat", "__session_Ab1"]);
    expect(provider.revokeSession).toHaveBeenCalledExactlyOnceWith("sess_active1");
    expect(provider.verifyToken).not.toHaveBeenCalled();
    expect(provider.cookies).not.toHaveBeenCalled();
  });

  it("adds explicit cookie rules after the defaults", async () => {
    const response = await hardened({ cookies: [{ name: "__refresh", scopes: [{ domain: "example.test" }] }] })(post());
    expect(response.headers.getSetCookie().at(-1)).toBe(
      "__refresh=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Domain=example.test; Secure",
    );
  });

  it("revokes a just-expired session named by a token Clerk verifies with a synthetic key", async () => {
    const response = await hardened()(post({ Cookie: `__session=${sign(claims())}` }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(provider.verifyToken).toHaveBeenCalledOnce();
    expect(provider.verifyToken.mock.calls[0]?.[1]).toMatchObject({ jwtKey, authorizedParties: [ORIGIN], clockSkewInMs: 600_000 });
    expect(provider.revokeSession).toHaveBeenCalledExactlyOnceWith("sess_expired1");
  });

  it.each([
    ["another signing key", () => sign(claims(), otherKeys.privateKey)],
    ["another issuer", () => sign(claims({ iss: "https://clerk.other.example.test" }))],
    ["another authorized party", () => sign(claims({ azp: "https://other.example.test" }))],
    ["no authorized party", () => sign(claims({ azp: undefined }))],
    ["expired beyond the configured age", () => sign(claims({ iat: nowSeconds() - 1300, exp: nowSeconds() - 601 }))],
    ["issued in the future beyond the skew", () => sign(claims({ iat: nowSeconds() + 60, exp: nowSeconds() + 120 }))],
    ["not valid before a future time beyond the skew", () => sign(claims({ nbf: nowSeconds() + 60, exp: nowSeconds() + 120 }))],
    ["no issued-at claim", () => sign(claims({ iat: undefined }))],
    ["a fractional expiry", () => sign(claims({ exp: nowSeconds() - 60.5 }))],
    ["an expiry that overflows exact milliseconds", () => sign(claims({ exp: Number.MAX_SAFE_INTEGER }))],
    ["issued after it expired", () => sign(claims({ iat: nowSeconds() - 30, exp: nowSeconds() - 60 }))],
    ["a malformed session id", () => sign(claims({ sid: "session-1" }))],
    ["no session id", () => sign(claims({ sid: undefined }))],
  ])("revokes nothing for a token with %s", async (_label, token) => {
    const response = await hardened()(post({ Cookie: `__session=${token()}` }));
    expect(response.status).toBe(303);
    expect(provider.revokeSession).not.toHaveBeenCalled();
  });

  it("checks the audience when configured and tries ordered sources within bounds", async () => {
    const route = hardened({
      expiredSessionFallback: { ...fallback, audience: "api", sources: ["__session_a", "__session_b", "__session_c", "__session_d"] },
    });
    const good = sign(claims({ aud: "api", sid: "sess_second" }));
    const response = await route(
      post({ Cookie: `__session_a=${sign(claims({ aud: "other" }))}; __session_b=${good}; __session_c=${good}; __session_d=${good}` }),
    );
    expect(response.status).toBe(303);
    expect(provider.verifyToken).toHaveBeenCalledTimes(3);
    expect(provider.revokeSession).toHaveBeenCalledExactlyOnceWith("sess_second");
  });

  it("skips the fallback when the request is over a cookie bound", async () => {
    const response = await hardened()(post({ Cookie: `__session=${sign(claims())}; pad=${"x".repeat(16384)}` }));
    expect(response.status).toBe(303);
    expect(provider.verifyToken).not.toHaveBeenCalled();
    expect(provider.revokeSession).not.toHaveBeenCalled();
  });

  it("sends a failed revocation to the fallback page with the same cleanup", async () => {
    provider.auth.mockResolvedValue({ sessionId: "sess_active1" });
    provider.revokeSession.mockRejectedValue(new Error("provider down"));
    const response = await hardened({ terminalPath: "/signed-out", fallbackPath: "/signed-out/retry" })(post());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/signed-out/retry`);
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("skips Clerk entirely in a keyless development bypass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_NO_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const response = await hardened()(post());
    expect(response.status).toBe(303);
    expect(provider.auth).not.toHaveBeenCalled();
  });

  it.each([
    ["redirectTo", { redirectTo: "/" }],
    ["getRedirectTarget", { getRedirectTarget: () => "/" }],
    ["extraCookiesToClear", { extraCookiesToClear: ["__session"] }],
    ["allowedRedirectOrigins", { allowedRedirectOrigins: [ORIGIN] }],
    ["signOut", { signOut: () => undefined }],
    ["both key sources", { expiredSessionFallback: { ...fallback, secretKey: "sk_synthetic" } }],
    ["no key source", { expiredSessionFallback: { issuer: ISSUER, authorizedParties: [ORIGIN], maxExpiredAgeMs: 1 } }],
    ["empty sources", { expiredSessionFallback: { ...fallback, sources: [] } }],
    ["no authorized parties", { expiredSessionFallback: { ...fallback, authorizedParties: [] } }],
    ["an unsafe age", { expiredSessionFallback: { ...fallback, maxExpiredAgeMs: Number.MAX_SAFE_INTEGER + 1 } }],
    ["an over-wide future skew", { expiredSessionFallback: { ...fallback, futureSkewMs: 60_001 } }],
    ["a self-looping confirmation", { confirmationPath: "/sign-out/confirm" }],
  ])("refuses hardened options with %s at construction", (_label, extra) => {
    expect(() => hardened(extra)).toThrow(TypeError);
  });

  it("keeps the legacy route legacy and refuses hardened-only keys without the flag", async () => {
    expect(() => createSignOutRoute({ confirmationPath: "/confirm" } as never)).toThrow(TypeError);
    expect(() => createSignOutRoute({ hardened: "true" } as never)).toThrow(TypeError);
    const legacy = createSignOutRoute({ hardened: false });
    const response = await legacy(new Request(`${ORIGIN}/sign-out`));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    const inherited = createSignOutRoute(Object.create({ hardened: true }) as never);
    expect((await inherited(new Request(`${ORIGIN}/sign-out`))).status).toBe(405);
  });
});
