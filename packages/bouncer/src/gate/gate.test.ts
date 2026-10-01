/**
 * The gated-host gate: one test group per numbered rule of the contract, then
 * the fail-closed behaviours the contract implies (nothing is answered before
 * the decision, nothing echoes the request's host or headers, malformed input
 * is refused).
 */
import { describe, expect, it } from "vitest";
import { GATED_HOST_ROBOTS_TAG, createServiceUnavailableResponse } from "../host-responses.js";
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  createGatedHostGate,
  createReturnUrlResolver,
  isNavigationRequest,
  type GatePrincipalState,
  type GatedHostGateOptions,
} from "./index.js";

const ORIGIN = "https://admin.example.test";
const SIBLING = "https://app.example.test";
const IDP = "https://idp.example.test";
const page = () => new Response("page", { status: 200 });

type Principal = { readonly role: string };

function req(path: string, headers: Record<string, string> = {}, origin = ORIGIN): Request {
  return new Request(`${origin}${path}`, { headers });
}

function options(
  state: GatePrincipalState<Principal> | Error,
  extra: Partial<GatedHostGateOptions<Principal>> = {},
): GatedHostGateOptions<Principal> {
  return {
    origin: ORIGIN,
    signInPath: "/sign-in",
    notAuthorizedPath: "/not-authorized",
    siblingOrigins: [SIBLING],
    protectedResourceMetadata: { authorization_servers: [IDP] },
    resolvePrincipal: () => {
      if (state instanceof Error) throw state;
      return state;
    },
    isPermitted: (principal) => principal.role === "admin",
    ...extra,
  };
}

function gate(state: GatePrincipalState<Principal> | Error, extra: Partial<GatedHostGateOptions<Principal>> = {}) {
  return createGatedHostGate<Principal>(options(state, extra));
}

const signedOut = { state: "signed-out" } as const;
const viewer = { state: "signed-in", principal: { role: "viewer" } } as const;
const admin = { state: "signed-in", principal: { role: "admin" } } as const;
const navigate = { "sec-fetch-mode": "navigate" };
const html = { accept: "text/html" };
const signInTarget = (returnUrl: string) => `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`;
const challenge = `Bearer resource_metadata="${ORIGIN}${PROTECTED_RESOURCE_METADATA_PATH}"`;

describe("rule 1: signed-out navigation", () => {
  it("gets a 307 to the same host's sign-in route with a relative redirect_url and no-store", async () => {
    const res = await gate(signedOut)(req("/reports/q3?tab=2", navigate), page);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(signInTarget("/reports/q3?tab=2"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const root = await gate(signedOut)(req("/", { accept: "text/html,*/*" }), page);
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe(signInTarget("/"));
  });

  it("treats Next.js router requests (RSC header or _rsc parameter) as navigation", async () => {
    expect(isNavigationRequest(req("/x", { rsc: "1", accept: "text/x-component" }))).toBe(true);
    expect(isNavigationRequest(req("/x?_rsc=abc", { accept: "*/*", "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isNavigationRequest(req("/x", { accept: "application/json" }))).toBe(false);
    expect((await gate(signedOut)(req("/x?_rsc=abc"), page)).status).toBe(307);
  });

  it("does not count an Accept entry with q=0 as navigation", () => {
    expect(isNavigationRequest(req("/x", { accept: "text/html;q=0" }))).toBe(false);
    expect(isNavigationRequest(req("/x", { accept: "application/json, text/html; q=0.0" }))).toBe(false);
    expect(isNavigationRequest(req("/x", { accept: "text/html;q=0.5" }))).toBe(true);
    expect(isNavigationRequest(req("/x", { accept: "application/json, text/html" }))).toBe(true);
  });
});

describe("rule 2: signed-out non-navigation and API routes", () => {
  it("get a 401 JSON body with an RFC 9728 WWW-Authenticate", async () => {
    const res = await gate(signedOut)(req("/data", { accept: "application/json" }), page);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(challenge);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("answers an API route with 401 even for a browser navigation", async () => {
    for (const path of ["/api/mcp", "/api"]) {
      const res = await gate(signedOut)(req(path, { ...html, ...navigate }), page);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(challenge);
    }
  });

  it("serves the protected-resource metadata document itself, without asking the provider", async () => {
    let asked = 0;
    const g = gate(signedOut, {
      protectedResourceMetadata: { authorization_servers: [IDP], scopes_supported: ["read"], bearer_methods_supported: ["header"] },
      resolvePrincipal: () => {
        asked += 1;
        return signedOut;
      },
    });
    const res = await g(req(PROTECTED_RESOURCE_METADATA_PATH), page);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      resource: ORIGIN,
      authorization_servers: [IDP],
      scopes_supported: ["read"],
      bearer_methods_supported: ["header"],
    });
    expect(asked).toBe(0);
    expect((await g(req(PROTECTED_RESOURCE_METADATA_PATH, {}), page)).status).toBe(200);
    const head = await g(new Request(`${ORIGIN}${PROTECTED_RESOURCE_METADATA_PATH}`, { method: "HEAD" }), page);
    expect(head.status).toBe(200);
  });

  it("refuses other methods on the metadata path with 405 and never reaches next", async () => {
    let reached = 0;
    const res = await gate(admin)(
      new Request(`${ORIGIN}${PROTECTED_RESOURCE_METADATA_PATH}`, { method: "POST" }),
      () => {
        reached += 1;
        return page();
      },
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(reached).toBe(0);
  });

  it("copies only the documented metadata fields and takes resource from configuration", async () => {
    const hostile = { authorization_servers: [IDP], resource: `${ORIGIN}/mcp`, extra: "x" } as never;
    const res = await gate(signedOut, { protectedResourceMetadata: hostile })(req(PROTECTED_RESOURCE_METADATA_PATH), page);
    expect(await res.json()).toEqual({ resource: `${ORIGIN}/mcp`, authorization_servers: [IDP] });
  });
});

describe("rule 3: return URLs", () => {
  const resolve = createReturnUrlResolver({ origin: ORIGIN, siblingOrigins: [SIBLING] });

  it("accepts relative paths and explicit sibling origins, and falls back to / for everything else", () => {
    expect(resolve("/a/b?c=1")).toBe("/a/b?c=1");
    expect(resolve("/a#frag")).toBe("/a#frag");
    expect(resolve(`${ORIGIN}/same?x=1`)).toBe("/same?x=1");
    expect(resolve(`${SIBLING}/x`)).toBe(`${SIBLING}/x`);
    for (const bad of [
      "https://evil.example.test/x",
      "//evil.example.test",
      "/\\evil.example.test",
      "/%5cevil.example.test",
      "/%2e%2e//evil.example.test",
      "javascript:alert(1)",
      "data:text/html,x",
      `https://user:pw@app.example.test/x`,
      "http://app.example.test/x",
      "relative",
      " /x",
      "/x\n",
      "",
      null,
      undefined,
      42 as never,
    ]) {
      expect(resolve(bad), String(bad)).toBe("/");
    }
  });

  it("does not trust a sibling that was not configured", () => {
    const strict = createReturnUrlResolver({ origin: ORIGIN });
    expect(strict(`${SIBLING}/x`)).toBe("/");
    expect(strict("/x")).toBe("/x");
  });

  it("never turns a protocol-relative request path into the return URL", async () => {
    const res = await gate(signedOut)(req("//evil.example.test/x", html), page);
    expect(res.headers.get("location")).toBe(signInTarget("/"));
  });

  it("rejects an origin or sibling that is not a plain http(s) origin", () => {
    for (const bad of ["admin.example.test", `${ORIGIN}/path`, "ftp://admin.example.test", "https://u:p@admin.example.test", ""]) {
      expect(() => createReturnUrlResolver({ origin: bad })).toThrow(TypeError);
      expect(() => createReturnUrlResolver({ origin: ORIGIN, siblingOrigins: [bad] })).toThrow(TypeError);
    }
  });
});

describe("rule 4: authentication versus authorization", () => {
  it("routes a signed-in principal without permission to a not-authorized route that answers 403", async () => {
    const g = gate(viewer);
    const nav = await g(req("/reports", html), page);
    expect(nav.status).toBe(307);
    expect(nav.headers.get("location")).toBe("/not-authorized");
    expect(nav.headers.get("cache-control")).toBe("no-store");
    const landing = await g(req("/not-authorized", html), () => new Response("denied page", { status: 200 }));
    expect(landing.status).toBe(403);
    expect(landing.headers.get("cache-control")).toBe("private, no-store");
    expect(await landing.text()).toBe("denied page");
  });

  it("answers an API or non-navigation caller without permission with a 403 JSON body, never a 404 or 200", async () => {
    const res = await gate(viewer)(req("/api/x"), page);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await gate(viewer)(req("/data", { accept: "application/json" }), page)).status).toBe(403);
  });

  it("passes a permitted principal through", async () => {
    const res = await gate(admin)(req("/reports", html), page);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("page");
  });

  it("sends a signed-out visitor of the not-authorized route to sign-in, not to the 403 page", async () => {
    const res = await gate(signedOut)(req("/not-authorized", html), page);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sign-in?redirect_url=");
  });

  it("denies when the permission check throws, rejects, or answers anything but true", async () => {
    for (const isPermitted of [
      () => {
        throw new Error("x");
      },
      () => Promise.reject(new Error("x")),
      () => "yes" as never,
      () => 1 as never,
      () => undefined as never,
    ]) {
      expect((await gate(admin, { isPermitted })(req("/api/x"), page)).status).toBe(403);
    }
  });

  it("does not construct without a permission check, so there is no permit-everyone default", () => {
    const { isPermitted: _omit, ...rest } = options(admin);
    expect(() => createGatedHostGate(rest as never)).toThrow(TypeError);
  });
});

describe("rule 5: provider unavailable or unconfigured", () => {
  it("never answers 500, and fails gated routes closed to sign-in", async () => {
    for (const state of [{ state: "unavailable" } as const, new Error("missing publishable key")]) {
      const g = gate(state);
      const nav = await g(req("/reports", html), page);
      expect(nav.status).toBe(307);
      expect(nav.headers.get("location")).toContain("/sign-in?redirect_url=");
      const api = await g(req("/api/x"), page);
      expect(api.status).toBe(401);
      expect(api.headers.get("www-authenticate")).toBe(challenge);
    }
  });

  it("treats a null, non-object or unknown provider answer as unavailable", async () => {
    for (const bad of [null, undefined, "signed-in", 42, {}, { state: "other" }, { state: "signed-in" }]) {
      const g = createGatedHostGate<Principal>({ ...options(signedOut), resolvePrincipal: () => bad as never });
      expect((await g(req("/reports", html), page)).status).toBe(307);
      expect((await g(req("/api/x"), page)).status).toBe(401);
      let flag: boolean | undefined;
      await g(req("/sign-in"), ({ providerUnavailable }) => {
        flag = providerUnavailable;
        return page();
      });
      expect(flag, JSON.stringify(bad)).toBe(true);
    }
  });

  it("passes sign-in through with the unavailable flag; production answers 503 with Retry-After from the shared helper", async () => {
    let seen: boolean | undefined;
    const next = ({ providerUnavailable }: { providerUnavailable: boolean }) => {
      seen = providerUnavailable;
      return new Response("sign-in page");
    };
    const dev = await gate(new Error("no key"))(req("/sign-in"), next);
    expect(seen).toBe(true);
    expect(dev.status).toBe(200);

    const prod = await gate({ state: "unavailable" }, { production: true, retryAfterSeconds: 60 })(req("/sign-in"), next);
    expect(prod.status).toBe(503);
    expect(prod.headers.get("retry-after")).toBe("60");
    expect(prod.headers.get("cache-control")).toBe("private, no-store");
    expect(await prod.text()).toBe("sign-in page");
    const shared = createServiceUnavailableResponse({ retryAfterSeconds: 60 });
    expect(prod.headers.get("retry-after")).toBe(shared.headers.get("retry-after"));
    expect((await gate({ state: "unavailable" }, { production: true })(req("/sign-in"), next)).headers.get("retry-after")).toBe("30");

    const healthy = await gate(signedOut, { production: true })(req("/sign-in"), next);
    expect(healthy.status).toBe(200);
    expect(healthy.headers.get("retry-after")).toBeNull();
  });

  it("gives sign-in sub-routes the same flag and 503, and keeps a lookalike path gated", async () => {
    const seen: boolean[] = [];
    const next = ({ providerUnavailable }: { providerUnavailable: boolean }) => {
      seen.push(providerUnavailable);
      return new Response("sign-in page");
    };
    for (const path of ["/sign-in/", "/sign-in/factor-one", "/sign-in/sso-callback?x=1"]) {
      expect((await gate(signedOut)(req(path, html), next)).status).toBe(200);
    }
    expect(seen).toEqual([false, false, false]);
    expect((await gate(signedOut)(req("/sign-input", html), next)).status).toBe(307);
    expect(seen).toHaveLength(3);
    seen.length = 0;
    const prod = await gate({ state: "unavailable" }, { production: true })(req("/sign-in/sso-callback"), next);
    expect(seen).toEqual([true]);
    expect(prod.status).toBe(503);
  });

  it("answers 503 rather than propagating when next throws or returns a non-Response", async () => {
    for (const next of [
      () => {
        throw new Error("render failed");
      },
      () => Promise.reject(new Error("render failed")),
      () => "not a response" as never,
    ]) {
      const res = await gate(admin)(req("/reports", html), next);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(await res.text()).toBe('{"error":"unavailable"}');
    }
  });
});

describe("rule 6: robots tag", () => {
  it("is on every response the gate produces or wraps", async () => {
    const signedOutGate = gate(signedOut);
    const denied = gate(viewer);
    const ok = gate(admin);
    const immutable = () => Response.redirect(`${ORIGIN}/elsewhere`, 302);
    const responses = [
      await signedOutGate(req("/x", html), page),
      await signedOutGate(req("/api/x"), page),
      await signedOutGate(req("/sign-in"), page),
      await signedOutGate(req("/sign-in/factor-one"), page),
      await denied(req("/x", html), page),
      await denied(req("/api/x"), page),
      await denied(req("/not-authorized"), page),
      await ok(req("/x"), page),
      await ok(req("/x"), immutable),
      await gate(signedOut)(req(PROTECTED_RESOURCE_METADATA_PATH), page),
      await gate(signedOut)(new Request(`${ORIGIN}${PROTECTED_RESOURCE_METADATA_PATH}`, { method: "DELETE" }), page),
      await gate({ state: "unavailable" }, { production: true })(req("/sign-in"), page),
      await gate(signedOut, { isPublicPath: (p) => p === "/health" })(req("/health"), page),
      await ok(req("/x"), () => {
        throw new Error("x");
      }),
      await ok({ url: "not a url", headers: new Headers(), method: "GET" } as unknown as Request, page),
    ];
    for (const res of responses) expect(res.headers.get("x-robots-tag")).toBe(GATED_HOST_ROBOTS_TAG);
  });

  it("replaces a pass-through response's own robots tag rather than appending", async () => {
    const res = await gate(admin)(req("/x"), () => new Response("p", { headers: { "x-robots-tag": "index" } }));
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("nothing is answered before the gate decision", () => {
  it("does not call next for a signed-out, unavailable or denied request", async () => {
    let reached = 0;
    const next = () => {
      reached += 1;
      return page();
    };
    for (const g of [gate(signedOut), gate({ state: "unavailable" }), gate(new Error("x")), gate(viewer)]) {
      await g(req("/reports", html), next);
      await g(req("/api/x"), next);
    }
    expect(reached).toBe(0);
  });

  it("asks the provider before it renders anything on a gated or sign-in path, and never renders on a public path first", async () => {
    const order: string[] = [];
    const g = createGatedHostGate<Principal>({
      ...options(admin),
      isPublicPath: (p) => p === "/health",
      resolvePrincipal: () => {
        order.push("provider");
        return admin;
      },
      isPermitted: () => {
        order.push("permission");
        return true;
      },
    });
    const next = () => {
      order.push("next");
      return page();
    };
    await g(req("/reports"), next);
    expect(order).toEqual(["provider", "permission", "next"]);
    order.length = 0;
    await g(req("/sign-in"), next);
    expect(order).toEqual(["provider", "next"]);
    order.length = 0;
    await g(req("/health"), next);
    expect(order).toEqual(["next"]);
  });

  it("does not run the permission check for a signed-out request", async () => {
    let checked = 0;
    await gate(signedOut, { isPermitted: () => (checked += 1) > 0 })(req("/x", html), page);
    expect(checked).toBe(0);
  });
});

describe("no echo of the request's host or header values", () => {
  it("takes every absolute URL from configuration, never from the request's host", async () => {
    const attacker = "https://attacker.example.invalid";
    const headers = { "x-forwarded-host": "attacker.example.invalid", host: "attacker.example.invalid", origin: attacker };
    const res = await gate(signedOut)(req("/data", headers, attacker), page);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(challenge);
    const doc = await gate(signedOut)(req(PROTECTED_RESOURCE_METADATA_PATH, headers, attacker), page);
    expect(await doc.json()).toEqual({ resource: ORIGIN, authorization_servers: [IDP] });
    const redirect = await gate(signedOut)(req("/x", { ...headers, ...navigate }, attacker), page);
    expect(redirect.headers.get("location")).toBe(signInTarget("/x"));
  });

  it("puts no request header value or host into any response header or body it generates", async () => {
    const secret = "needle-7f3a";
    const headers = { authorization: `Bearer ${secret}`, cookie: `s=${secret}`, "user-agent": secret, accept: `application/json, ${secret}/x` };
    const responses = [
      await gate(signedOut)(req("/data", headers, `https://${secret}.example.test`), page),
      await gate(viewer)(req("/api/x", headers, `https://${secret}.example.test`), page),
      await gate({ state: "unavailable" }, { production: true })(req("/sign-in", headers, `https://${secret}.example.test`), page),
      await gate(admin)(req("/x", headers), () => {
        throw new Error(secret);
      }),
    ];
    for (const res of responses) {
      const text = [...res.headers.entries()].flat().join("\n") + (await res.clone().text());
      expect(text).not.toContain(secret);
    }
  });

  it("states no configured value in a construction error", () => {
    const secret = "needle-9c1d";
    for (const bad of [
      { origin: `${secret}` },
      { signInPath: `${secret}` },
      { notAuthorizedPath: `${secret}` },
      { siblingOrigins: [secret] },
      { protectedResourceMetadata: { authorization_servers: [secret] } },
    ]) {
      let message = "";
      try {
        createGatedHostGate<Principal>({ ...options(admin), ...bad } as never);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(secret);
    }
  });
});

describe("unknown or malformed input is refused", () => {
  it("answers 400 for a request whose URL is not an http(s) URL, without calling the provider or next", async () => {
    let calls = 0;
    const g = createGatedHostGate<Principal>({
      ...options(admin),
      resolvePrincipal: () => {
        calls += 1;
        return admin;
      },
    });
    for (const url of ["not a url", "ftp://admin.example.test/x", "javascript:alert(1)", ""]) {
      const res = await g({ url, headers: new Headers(), method: "GET" } as unknown as Request, () => {
        calls += 1;
        return page();
      });
      expect(res.status, url).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(calls).toBe(0);
  });

  it("keeps an ambiguous path out of the sign-in and public pass-throughs", async () => {
    let reached = 0;
    const next = () => {
      reached += 1;
      return page();
    };
    const g = gate(signedOut, { isPublicPath: (p) => p.startsWith("/public") });
    for (const path of [
      "/sign-in/..%2fadmin",
      "/sign-in/%2e%2e/admin",
      "/sign-in/%252e%252e/admin",
      "/sign-in/a%5cb",
      "/sign-in//admin",
      "/sign-in/a%2Fb",
      "/public/..%2fadmin",
      "/public//admin",
    ]) {
      const res = await g(req(path, html), next);
      expect(res.status, path).toBe(307);
    }
    expect(reached).toBe(0);
  });

  it("treats a throwing isPublicPath as not public, and a non-true answer as not public", async () => {
    for (const isPublicPath of [
      () => {
        throw new Error("x");
      },
      () => "true" as never,
      () => 1 as never,
    ]) {
      expect((await gate(signedOut, { isPublicPath })(req("/reports", html), page)).status).toBe(307);
    }
  });

  it("never asks the provider for a public path, and asks once for any other", async () => {
    let calls = 0;
    const g = gate(signedOut, {
      isPublicPath: (p) => p === "/health",
      resolvePrincipal: () => {
        calls += 1;
        return signedOut;
      },
    });
    expect((await g(req("/health"), page)).status).toBe(200);
    expect(calls).toBe(0);
    await g(req("/other", html), page);
    expect(calls).toBe(1);
  });

  it("rejects malformed options at construction", () => {
    const base = options(admin);
    const bad: Array<Partial<GatedHostGateOptions<Principal>>> = [
      { signInPath: "sign-in" },
      { signInPath: "//sign-in" },
      { signInPath: "/" },
      { signInPath: "/sign-in/" },
      { signInPath: "/sign-in?x=1" },
      { signInPath: "/a/../b" },
      { signInPath: "/sign\\in" },
      { notAuthorizedPath: "denied" },
      { notAuthorizedPath: "/sign-in" },
      { notAuthorizedPath: "/sign-in/denied" },
      { notAuthorizedPath: PROTECTED_RESOURCE_METADATA_PATH },
      { signInPath: PROTECTED_RESOURCE_METADATA_PATH },
      { origin: "" },
      { origin: undefined as never },
      { siblingOrigins: "https://app.example.test" as never },
      { siblingOrigins: [42 as never] },
      { apiPathPrefixes: ["api"] },
      { apiPathPrefixes: "/api/" as never },
      { resolvePrincipal: undefined as never },
      { isPermitted: "yes" as never },
      { isPublicPath: "yes" as never },
      { protectedResourceMetadata: undefined as never },
      { protectedResourceMetadata: { authorization_servers: [] } },
      { protectedResourceMetadata: { authorization_servers: ["not a url"] } },
      { protectedResourceMetadata: { authorization_servers: ["https://u:p@idp.example.test"] } },
      { protectedResourceMetadata: { authorization_servers: [IDP], resource: "ftp://x" } },
      { protectedResourceMetadata: { authorization_servers: [IDP], scopes_supported: [1 as never] } },
      { retryAfterSeconds: -1 },
      { retryAfterSeconds: 1.5 },
      { retryAfterSeconds: Number.NaN },
      { retryAfterSeconds: Number.POSITIVE_INFINITY },
      { retryAfterSeconds: "30" as never },
    ];
    for (const patch of bad) expect(() => createGatedHostGate({ ...base, ...patch }), JSON.stringify(patch)).toThrow(TypeError);
    expect(() => createGatedHostGate({ ...base, retryAfterSeconds: 0 })).not.toThrow();
  });
});

describe("review fixes: shared caches never keep a gated pass-through", () => {
  const cacheable = (vary?: string) => () =>
    new Response("page", {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=31536000", ...(vary === undefined ? {} : { Vary: vary }) },
    });
  const expectPrivate = (res: Response, vary: string) => {
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe(vary);
  };

  it("sets private, no-store and Vary on a permitted pass-through", async () => {
    expectPrivate(await gate(admin)(req("/reports", html), cacheable()), "Cookie, Authorization");
    expectPrivate(await gate(admin)(req("/reports", html), cacheable("Accept-Encoding")), "Accept-Encoding, Cookie, Authorization");
  });

  it("sets private, no-store and Vary on a sign-in pass-through, signed out and signed in", async () => {
    for (const state of [signedOut, admin, viewer]) {
      expectPrivate(await gate(state)(req("/sign-in", html), cacheable()), "Cookie, Authorization");
      expectPrivate(await gate(state)(req("/sign-in/callback", html), cacheable("Accept-Encoding")), "Accept-Encoding, Cookie, Authorization");
    }
  });

  it("sets private, no-store and Vary on the not-authorized page, which stays a 403", async () => {
    const res = await gate(viewer)(req("/not-authorized", html), cacheable());
    expect(res.status).toBe(403);
    expectPrivate(res, "Cookie, Authorization");
  });

  const cdnHeaders = () =>
    new Response("page", {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=31536000",
        "CDN-Cache-Control": "public, max-age=31536000",
        "Vercel-CDN-Cache-Control": "public, max-age=31536000",
        "Surrogate-Control": "max-age=31536000",
      },
    });
  const expectNoCdnHeaders = (res: Response) => {
    expect(res.headers.get("cdn-cache-control")).toBeNull();
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull();
    expect(res.headers.get("surrogate-control")).toBeNull();
    expectPrivate(res, "Cookie, Authorization");
  };

  it("removes CDN-specific cache headers from a permitted pass-through", async () => {
    expectNoCdnHeaders(await gate(admin)(req("/reports", html), cdnHeaders));
  });

  it("removes CDN-specific cache headers from a sign-in pass-through", async () => {
    for (const state of [signedOut, admin, viewer]) expectNoCdnHeaders(await gate(state)(req("/sign-in", html), cdnHeaders));
  });

  it("removes CDN-specific cache headers from the not-authorized page", async () => {
    const res = await gate(viewer)(req("/not-authorized", html), cdnHeaders);
    expect(res.status).toBe(403);
    expectNoCdnHeaders(res);
  });

  it("leaves CDN-specific cache headers on a public path", async () => {
    const res = await gate(signedOut, { isPublicPath: (p) => p === "/health" })(req("/health"), cdnHeaders);
    expect(res.headers.get("cdn-cache-control")).toBe("public, max-age=31536000");
    expect(res.headers.get("vercel-cdn-cache-control")).toBe("public, max-age=31536000");
    expect(res.headers.get("surrogate-control")).toBe("max-age=31536000");
  });

  it("does not repeat a Vary value next already set, in any case, and keeps Vary: *", async () => {
    expectPrivate(await gate(admin)(req("/r", html), cacheable("cookie, Accept-Language")), "cookie, Accept-Language, Authorization");
    expectPrivate(await gate(admin)(req("/r", html), cacheable("*")), "*");
  });

  it("leaves a public path as next rendered it", async () => {
    const res = await gate(signedOut, { isPublicPath: (p) => p === "/health" })(req("/health"), cacheable());
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=31536000");
    expect(res.headers.get("vary")).toBeNull();
  });
});

describe("review fixes: construction refuses routes next could expose", () => {
  it("rejects a signInPath or notAuthorizedPath that is or sits under /api or /_next", () => {
    const base = options(admin);
    for (const path of ["/api", "/api/sign-in", "/_next", "/_next/static"]) {
      expect(() => createGatedHostGate({ ...base, signInPath: path }), `signInPath ${path}`).toThrow(TypeError);
      expect(() => createGatedHostGate({ ...base, notAuthorizedPath: path }), `notAuthorizedPath ${path}`).toThrow(TypeError);
    }
    for (const path of ["/apix", "/_nextish", "/my-api/in"]) {
      expect(() => createGatedHostGate({ ...base, signInPath: path }), path).not.toThrow();
    }
  });

  it("rejects a route that sits under a configured apiPathPrefixes entry", () => {
    const base = options(admin, { apiPathPrefixes: ["/internal/"] });
    expect(() => createGatedHostGate({ ...base, signInPath: "/internal/login" })).toThrow(TypeError);
    expect(() => createGatedHostGate({ ...base, notAuthorizedPath: "/internal" })).toThrow(TypeError);
  });
});

describe("review fixes: the not-authorized route is an exact match", () => {
  it("redirects or 403s a signed-in viewer on a lookalike path and never calls next", async () => {
    let reached = 0;
    const next = () => {
      reached += 1;
      return page();
    };
    for (const path of ["/not-authorized/x", "/not-authorizedX"]) {
      const nav = await gate(viewer)(req(path, html), next);
      expect(nav.status, path).toBe(307);
      expect(nav.headers.get("location"), path).toBe("/not-authorized");
      expect((await gate(viewer)(req(path, { accept: "application/json" }), next)).status, path).toBe(403);
    }
    expect(reached).toBe(0);
  });
});

describe("review fixes: ambiguous paths that reach the guard", () => {
  it("keeps semicolon, encoded semicolon, null, encoded-dot and non-ASCII paths out of the pass-throughs", async () => {
    let reached = 0;
    const next = () => {
      reached += 1;
      return page();
    };
    const g = gate(signedOut, { isPublicPath: (p) => p.startsWith("/public") });
    for (const path of [
      "/sign-in/x%2e%2e",
      "/sign-in/a%00b",
      "/sign-in/..;/admin",
      "/sign-in/%3b/admin",
      "/sign-in/%3B/admin",
      "/sign-in/a;b",
      "/sign-in/%EF%BC%8Fadmin",
      "/sign-in/\u00e9",
      "/public/..;/admin",
      "/public/%3b/admin",
      "/public/%EF%BC%8Fadmin",
    ]) {
      const res = await g(req(path, html), next);
      expect(res.status, path).toBe(307);
    }
    expect(reached).toBe(0);
  });
});

describe("review fixes: an oversized return URL", () => {
  it("falls back to / when the Location header would pass 2048 characters, and keeps one at the limit", async () => {
    const fits = `/${"a".repeat(2023)}`;
    const tooLong = `/${"a".repeat(2024)}`;
    const keep = await gate(signedOut)(req(fits, navigate), page);
    expect(keep.headers.get("location")).toBe(signInTarget(fits));
    expect(keep.headers.get("location")?.length).toBe(2048);
    const res = await gate(signedOut)(req(tooLong, navigate), page);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(signInTarget("/"));
    const query = await gate(signedOut)(req(`/x?q=${"b".repeat(3000)}`, navigate), page);
    expect(query.headers.get("location")).toBe(signInTarget("/"));
  });
});
