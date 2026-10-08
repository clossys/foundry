/**
 * The generic Fetch sign-out kernel: construction-time validation of every
 * target and cookie scope, the GET/HEAD confirmation hop, the POST origin
 * check, the fixed whole deadline, bounded local cleanup and the public
 * declaration of the gate subpath.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGN_OUT_CLEAR_SITE_DATA,
  SIGN_OUT_DEADLINE_MS,
  createSignOutHandler,
  type SignOutContext,
  type SignOutHandlerOptions,
} from "./index.js";

const ORIGIN = "https://app.example.test";
const ENDPOINT = `${ORIGIN}/sign-out`;
const EXPIRED = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0";

function options(extra: Partial<SignOutHandlerOptions> = {}): SignOutHandlerOptions {
  return {
    origin: ORIGIN,
    path: "/sign-out",
    confirmationPath: "/signed-out/confirm",
    cookies: [{ name: "__session", matchSuffixes: true }, { name: "__client_uat", matchSuffixes: true }],
    signOut: () => undefined,
    ...extra,
  };
}

function post(headers: Record<string, string> = { origin: ORIGIN }, body?: BodyInit): Request {
  return new Request(ENDPOINT, { method: "POST", headers, body });
}

const setCookies = (response: Response) => response.headers.getSetCookie();

afterEach(() => {
  vi.useRealTimers();
});

describe("construction", () => {
  it("validates confirmation, terminal and fallback targets against the endpoint itself at every representation", () => {
    expect(() => createSignOutHandler(options())).not.toThrow();
    for (const target of ["/sign-out", "/SIGN-OUT", "/sign%2Dout", "/sign-out/", "/sign-out/x", "/sign-out;x", "/a/../sign-out"]) {
      expect(() => createSignOutHandler(options({ confirmationPath: target })), target).toThrow(TypeError);
      expect(() => createSignOutHandler(options({ terminalPath: target })), target).toThrow(TypeError);
      expect(() => createSignOutHandler(options({ fallbackPath: target })), target).toThrow(TypeError);
    }
    for (const target of ["https://app.example.test/home", "//app.example.test/home", "home", "", "/a b"]) {
      expect(() => createSignOutHandler(options({ terminalPath: target })), target).toThrow(TypeError);
    }
    expect(() => createSignOutHandler(options({ excludedPaths: ["/home"], terminalPath: "/home" }))).toThrow(TypeError);
  });

  it("requires an explicit terminal path when / is excluded, and defaults the fallback to it", async () => {
    expect(() => createSignOutHandler(options({ excludedPaths: ["/"] }))).toThrow(TypeError);
    const handler = createSignOutHandler(options({ excludedPaths: ["/"], terminalPath: "/goodbye", signOut: () => Promise.reject(new Error("x")) }));
    expect((await handler(post())).headers.get("location")).toBe(`${ORIGIN}/goodbye`);
  });

  it("refuses a missing provider callback, an empty cookie policy and malformed endpoint identity", () => {
    expect(() => createSignOutHandler(options({ signOut: undefined as unknown as SignOutHandlerOptions["signOut"] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ cookies: [] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ origin: "https://app.example.test/x" }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ path: "/" }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ path: "sign-out" }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ confirmationPath: undefined as unknown as string }))).toThrow(TypeError);
  });

  it("reads only own data properties of plain objects and dense plain arrays", () => {
    const withGetter = options();
    Object.defineProperty(withGetter, "signOut", { get: () => () => undefined, enumerable: true });
    expect(() => createSignOutHandler(withGetter)).toThrow(TypeError);
    expect(() => createSignOutHandler(Object.assign(Object.create({ confirmationPath: "/c" }) as object, options()) as SignOutHandlerOptions)).toThrow(TypeError);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => createSignOutHandler(options({ cookies: [, { name: "__session" }] as unknown as SignOutHandlerOptions["cookies"] }))).toThrow(TypeError);
    const rule = { matchSuffixes: true } as { name?: string; matchSuffixes: boolean };
    Object.defineProperty(rule, "name", { get: () => "__session", enumerable: true });
    expect(() => createSignOutHandler(options({ cookies: [rule as { name: string }] }))).toThrow(TypeError);
  });

  it("bounds rules, scopes, names and cookie scopes, and accepts only trusted configured domains", () => {
    const rules = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `c${i}` }));
    expect(() => createSignOutHandler(options({ cookies: rules(16) }))).not.toThrow();
    expect(() => createSignOutHandler(options({ cookies: rules(17) }))).toThrow(TypeError);
    const scopes = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `/p${i}` }));
    expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: scopes(4) }] }))).not.toThrow();
    expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: scopes(5) }] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ cookies: [{ name: "a".repeat(256) }] }))).not.toThrow();
    for (const name of ["a".repeat(257), "", "a b", "a;b", "a=b", "café"]) {
      expect(() => createSignOutHandler(options({ cookies: [{ name }] })), name).toThrow(TypeError);
    }
    expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: [{ domain: "example.test" }] }] }))).not.toThrow();
    expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: [{ domain: "app.example.test" }] }] }))).not.toThrow();
    for (const domain of ["other.test", "test", ".example.test", "EXAMPLE.test", "xapp.example.test", "pp.example.test", "example.test.", ""]) {
      expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: [{ domain }] }] })), domain).toThrow(TypeError);
    }
    for (const path of ["", "x", "/a;b", "/a b", "//a", "/a/../b"]) {
      expect(() => createSignOutHandler(options({ cookies: [{ name: "a", scopes: [{ path }] }] })), path).toThrow(TypeError);
    }
    expect(() => createSignOutHandler(options({ cookies: [{ name: "__Host-id", scopes: [{ domain: "example.test" }] }] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ cookies: [{ name: "__Host-id", scopes: [{ path: "/a" }] }] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ origin: "http://localhost:3000", cookies: [{ name: "__Secure-id" }] }))).toThrow(TypeError);
    expect(() => createSignOutHandler(options({ origin: "http://127.0.0.1:3000", cookies: [{ name: "a", scopes: [{ domain: "0.0.1" }] }] }))).toThrow(TypeError);
  });

  it("refuses an unconditional cleanup that would not fit the Set-Cookie byte budget", () => {
    const longPath = `/${"p".repeat(500)}`;
    const big = Array.from({ length: 16 }, (_, i) => ({
      name: `${"n".repeat(250)}${i}`,
      scopes: [0, 1, 2, 3].map((j) => ({ domain: "example.test", path: `${longPath}${j}` })),
    }));
    expect(() => createSignOutHandler(options({ cookies: big }))).toThrow(TypeError);
  });
});

describe("GET and HEAD: a confirmation hop, never a sign-out", () => {
  it("answers an empty no-store 303 to the confirmation page without calling the provider or touching cookies", async () => {
    const signOut = vi.fn();
    const handler = createSignOutHandler(options({ signOut }));
    for (const method of ["GET", "HEAD"]) {
      const response = await handler(new Request(ENDPOINT, { method, headers: { cookie: "__session=abc; __session_x1=def" } }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/signed-out/confirm`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("clear-site-data")).toBeNull();
      expect(setCookies(response)).toEqual([]);
      expect(await response.text()).toBe("");
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses every other method with 405 and the allowed list", async () => {
    const signOut = vi.fn();
    const handler = createSignOutHandler(options({ signOut }));
    for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const response = await handler(new Request(ENDPOINT, { method, headers: { origin: ORIGIN } }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(setCookies(response)).toEqual([]);
    }
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("POST: origin before anything else", () => {
  it("accepts only an exact configured Origin, or a missing or null Origin with same-origin fetch metadata", async () => {
    const signOut = vi.fn();
    const handler = createSignOutHandler(options({ signOut }));
    const accepted = [{ origin: ORIGIN }, { "sec-fetch-site": "same-origin" }, { origin: "null", "sec-fetch-site": "same-origin" }];
    for (const headers of accepted) {
      expect((await handler(post(headers))).status, JSON.stringify(headers)).toBe(303);
    }
    expect(signOut).toHaveBeenCalledTimes(accepted.length);
    signOut.mockClear();
    const refused = [
      {},
      { origin: "https://outside.example.test" },
      { origin: `${ORIGIN}/` },
      { origin: "https://APP.example.test" },
      { origin: `${ORIGIN}:443` },
      { origin: "null" },
      { origin: "https://outside.example.test", "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "none" },
      { "sec-fetch-site": "Same-Origin" },
      { origin: "null", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of refused) {
      const request = post({ ...headers, cookie: "__session=abc" }, "a=1");
      const response = await handler(request);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(setCookies(response)).toEqual([]);
      expect(request.bodyUsed).toBe(false);
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not trust the request's own host or forwarded headers as the origin", async () => {
    const handler = createSignOutHandler(options());
    const request = new Request("https://outside.example.test/sign-out", {
      method: "POST",
      headers: { origin: "https://outside.example.test", "x-forwarded-host": "app.example.test" },
    });
    expect((await handler(request)).status).toBe(403);
  });
});

describe("POST: one safe 303 with reserved local cleanup", () => {
  it("expires every configured cookie scope, clears cache and storage but never cookies, and leaves the body unread", async () => {
    const handler = createSignOutHandler(
      options({
        cookies: [
          { name: "__session", matchSuffixes: true },
          { name: "__refresh", scopes: [{ path: "/" }, { domain: "example.test", path: "/" }] },
        ],
      }),
    );
    for (const request of [
      post({ origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, "confirm=1"),
      post({ origin: ORIGIN, "content-type": "application/json" }, "{}"),
    ]) {
      const response = await handler(request);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
      expect(SIGN_OUT_CLEAR_SITE_DATA).toBe('"cache", "storage"');
      expect(setCookies(response)).toEqual([
        `__session=; Path=/; ${EXPIRED}; Secure`,
        `__refresh=; Path=/; ${EXPIRED}; Secure`,
        `__refresh=; Path=/; ${EXPIRED}; Domain=example.test; Secure`,
      ]);
      expect(await response.text()).toBe("");
      expect(request.bodyUsed).toBe(false);
      const names = [...new Set(response.headers.keys())].sort();
      expect(names).toEqual(["cache-control", "clear-site-data", "location", "set-cookie", "x-robots-tag"]);
    }
  });

  it("expires recognised suffixed names the request carries, within bounds, using only configured scopes", async () => {
    let seen: SignOutContext["cookies"];
    const handler = createSignOutHandler(options({ signOut: (context) => void (seen = context.cookies) }));
    const response = await handler(
      post({
        origin: ORIGIN,
        host: "evil.example.test",
        "x-forwarded-host": "evil.example.test",
        cookie: `__session_Ab-1_z=t1; __client_uat_x=0; __session_${"s".repeat(65)}=t2; __session_a.b=t3; other_x=1; __session=t0`,
      }),
    );
    expect(setCookies(response)).toEqual([
      `__session=; Path=/; ${EXPIRED}; Secure`,
      `__client_uat=; Path=/; ${EXPIRED}; Secure`,
      `__session_Ab-1_z=; Path=/; ${EXPIRED}; Secure`,
      `__client_uat_x=; Path=/; ${EXPIRED}; Secure`,
    ]);
    expect(seen?.get("__session")).toBe("t0");
    expect(seen?.get("__session_Ab-1_z")).toBe("t1");
  });

  it("skips dynamic cleanup and verification for an oversized Cookie header, keeping the reserved cleanup", async () => {
    let seen: SignOutContext["cookies"] | "unset" = "unset";
    const handler = createSignOutHandler(options({ signOut: (context) => void (seen = context.cookies) }));
    const atLimit = `__session_a=${"v".repeat(16384 - "__session_a=".length)}`;
    const ok = await handler(post({ origin: ORIGIN, cookie: atLimit }));
    expect(setCookies(ok)).toContain(`__session_a=; Path=/; ${EXPIRED}; Secure`);
    expect(seen).toBeInstanceOf(Map);
    const over = await handler(post({ origin: ORIGIN, cookie: `${atLimit}v` }));
    expect(over.status).toBe(303);
    expect(setCookies(over)).toEqual([`__session=; Path=/; ${EXPIRED}; Secure`, `__client_uat=; Path=/; ${EXPIRED}; Secure`]);
    expect(seen).toBeUndefined();
  });

  it("expires at most 16 recognised names and then stops verification without claiming complete removal", async () => {
    let seen: SignOutContext["cookies"] | "unset" = "unset";
    const handler = createSignOutHandler(options({ signOut: (context) => void (seen = context.cookies) }));
    const cookie = Array.from({ length: 17 }, (_, i) => `__session_s${i}=v`).join("; ");
    const response = await handler(post({ origin: ORIGIN, cookie }));
    expect(response.status).toBe(303);
    const dynamic = setCookies(response).filter((value) => value.startsWith("__session_s"));
    expect(dynamic).toHaveLength(16);
    expect(dynamic).not.toContain(`__session_s16=; Path=/; ${EXPIRED}; Secure`);
    expect(seen).toBeUndefined();
  });

  it("stops at 128 expiry tuples, reserving the unconditional ones first", async () => {
    // Rules k and k_0..k_14, each with four distinct scopes: 64 unconditional tuples. A name such as
    // k_3_z matches both k and k_3, so it adds eight; the ninth such name no longer fits.
    const names = ["k", ...Array.from({ length: 15 }, (_, i) => `k_${i}`)];
    const cookies = names.map((name, i) => ({ name, matchSuffixes: true, scopes: ["a", "b", "c", "d"].map((s) => ({ path: `/r${i}${s}` })) }));
    let seen: SignOutContext["cookies"] | "unset" = "unset";
    const handler = createSignOutHandler(options({ cookies, signOut: (context) => void (seen = context.cookies) }));
    const fits = Array.from({ length: 8 }, (_, i) => `k_${i}_z=v`).join("; ");
    const values = setCookies(await handler(post({ origin: ORIGIN, cookie: fits })));
    expect(values).toHaveLength(128);
    expect(values.slice(0, 64).every((value) => !value.includes("_z="))).toBe(true);
    expect(seen).toBeInstanceOf(Map);
    const over = setCookies(await handler(post({ origin: ORIGIN, cookie: `${fits}; k_8_z=v` })));
    expect(over).toHaveLength(128);
    expect(over.some((value) => value.startsWith("k_8_z="))).toBe(false);
    expect(seen).toBeUndefined();
  });

  it("answers the fallback with the same cleanup when the provider throws or rejects, and never claims revocation", async () => {
    for (const signOut of [
      () => {
        throw new Error("sync");
      },
      () => Promise.reject(new Error("async")),
    ]) {
      const handler = createSignOutHandler(options({ terminalPath: "/goodbye", fallbackPath: "/signed-out/retry", signOut }));
      const response = await handler(post());
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/signed-out/retry`);
      expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
      expect(setCookies(response)).toHaveLength(2);
      expect(await response.text()).toBe("");
    }
  });
});

describe("POST: one fixed whole deadline", () => {
  it("is 5000 ms and answers the fallback when the provider has not finished", async () => {
    vi.useFakeTimers();
    expect(SIGN_OUT_DEADLINE_MS).toBe(5000);
    let context: SignOutContext | undefined;
    let lateStep = false;
    let release: () => void = () => undefined;
    const handler = createSignOutHandler(
      options({
        terminalPath: "/goodbye",
        fallbackPath: "/signed-out/retry",
        signOut: async (ctx) => {
          context = ctx;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (ctx.isActive()) lateStep = true;
        },
      }),
    );
    const pending = handler(post());
    await vi.advanceTimersByTimeAsync(0);
    expect(context?.isActive()).toBe(true);
    expect(context?.remainingMs()).toBe(5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(context?.remainingMs()).toBe(1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const response = await pending;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/signed-out/retry`);
    expect(setCookies(response)).toHaveLength(2);
    expect(context?.isActive()).toBe(false);
    expect(context?.remainingMs()).toBe(0);
    expect(context?.signal.aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(lateStep).toBe(false);
  });

  it("answers the terminal path when the provider finishes in time", async () => {
    vi.useFakeTimers();
    const handler = createSignOutHandler(
      options({
        terminalPath: "/goodbye",
        signOut: () => new Promise<void>((resolve) => setTimeout(resolve, 4999)),
      }),
    );
    const pending = handler(post());
    await vi.advanceTimersByTimeAsync(4999);
    expect((await pending).headers.get("location")).toBe(`${ORIGIN}/goodbye`);
  });
});

describe("public declaration and import of the gate subpath", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("ships the kernel and the hardened types in the built gate entry", async () => {
    const entry = join(packageRoot, "dist", "gate", "index.js");
    expect(existsSync(entry)).toBe(true);
    const built = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
    expect(typeof built.createSignOutHandler).toBe("function");
    expect(built.SIGN_OUT_DEADLINE_MS).toBe(5000);
    expect(built.SIGN_OUT_CLEAR_SITE_DATA).toBe('"cache", "storage"');
    const declarations = readFileSync(join(packageRoot, "dist", "gate", "index.d.ts"), "utf8");
    for (const name of [
      "createSignOutHandler",
      "SignOutHandlerOptions",
      "SignOutContext",
      "SignOutCookieRule",
      "SignOutCookieScope",
      "HardenedGatedHostGateOptions",
      "HardenedReturnUrlResolverOptions",
      "GatePermissionAnswer",
    ]) {
      expect(declarations, name).toContain(name);
    }
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, { types: string }> };
    expect(manifest.exports["./gate"]?.types).toBe("./dist/gate/index.d.ts");
  });
});
