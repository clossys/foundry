import { describe, expect, it } from "vitest";
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  createGatedHostGate,
  isNavigationRequest,
  resolveReturnUrl,
  type GatePrincipalState,
} from "./index.js";

const ORIGIN = "https://admin.example.test";
const page = () => new Response("page", { status: 200 });

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

function gate(state: GatePrincipalState<{ role: string }> | Error, extra: Record<string, unknown> = {}) {
  return createGatedHostGate<{ role: string }>({
    signInPath: "/sign-in",
    notAuthorizedPath: "/not-authorized",
    siblingOrigins: ["https://app.example.test"],
    resolvePrincipal: () => {
      if (state instanceof Error) throw state;
      return state;
    },
    isPermitted: (p) => p.role === "admin",
    ...extra,
  });
}

describe("gated host gate", () => {
  it("1: signed-out navigation gets a 307 to same-host sign-in with a relative redirect_url", async () => {
    const res = await gate({ state: "signed-out" })(req("/reports/q3?tab=2", { "sec-fetch-mode": "navigate" }), page);
    expect(res.status).toBe(307);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBe(`/sign-in?redirect_url=${encodeURIComponent("/reports/q3?tab=2")}`);
    const html = await gate({ state: "signed-out" })(req("/", { accept: "text/html,*/*" }), page);
    expect(html.status).toBe(307);
    expect(html.headers.get("location")).toBe(`/sign-in?redirect_url=${encodeURIComponent("/")}`);
  });

  it("1: Next.js router requests (RSC header or _rsc parameter) are navigation", async () => {
    expect(isNavigationRequest(req("/x", { rsc: "1", accept: "text/x-component" }))).toBe(true);
    expect(isNavigationRequest(req("/x?_rsc=abc", { accept: "*/*", "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isNavigationRequest(req("/x", { accept: "application/json" }))).toBe(false);
    const res = await gate({ state: "signed-out" })(req("/x?_rsc=abc"), page);
    expect(res.status).toBe(307);
  });

  it("2: signed-out non-navigation and API routes get 401 with RFC 9728 WWW-Authenticate", async () => {
    const expected = `Bearer resource_metadata="${ORIGIN}${PROTECTED_RESOURCE_METADATA_PATH}"`;
    const fetchCall = await gate({ state: "signed-out" })(req("/data", { accept: "application/json" }), page);
    expect(fetchCall.status).toBe(401);
    expect(fetchCall.headers.get("www-authenticate")).toBe(expected);
    expect(await fetchCall.json()).toEqual({ error: "unauthorized" });
    // An API route is 401 even for a browser navigation.
    const api = await gate({ state: "signed-out" })(req("/api/mcp", { accept: "text/html" }), page);
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBe(expected);
  });

  it("2: serves the protected-resource metadata document when configured", async () => {
    const g = gate({ state: "signed-out" }, { protectedResourceMetadata: { authorization_servers: ["https://idp.example.test"] } });
    const res = await g(req(PROTECTED_RESOURCE_METADATA_PATH), page);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorization_servers: ["https://idp.example.test"], resource: ORIGIN });
  });

  it("3: return URLs are relative paths or allowlisted sibling origins, else /", () => {
    const siblings = ["https://app.example.test"];
    expect(resolveReturnUrl("/a/b?c=1", siblings)).toBe("/a/b?c=1");
    expect(resolveReturnUrl("https://app.example.test/x", siblings)).toBe("https://app.example.test/x");
    for (const bad of [
      "https://evil.example.test/x",
      "//evil.example.test",
      "/\\evil.example.test",
      "/%5cevil.example.test",
      "javascript:alert(1)",
      "https://user:pw@app.example.test/x",
      "relative",
      " /x",
      "",
      null,
      undefined,
    ]) {
      expect(resolveReturnUrl(bad, siblings)).toBe("/");
    }
    expect(resolveReturnUrl("https://app.example.test/x")).toBe("/");
  });

  it("3: a protocol-relative request path never becomes the return URL", async () => {
    const res = await gate({ state: "signed-out" })(req("//evil.example.test/x", { accept: "text/html" }), page);
    expect(res.headers.get("location")).toBe(`/sign-in?redirect_url=${encodeURIComponent("/")}`);
  });

  it("4: signed-in without permission is routed to a not-authorized route that answers 403", async () => {
    const g = gate({ state: "signed-in", principal: { role: "viewer" } });
    const nav = await g(req("/reports", { accept: "text/html" }), page);
    expect(nav.status).toBe(307);
    expect(nav.headers.get("location")).toBe("/not-authorized");
    const landing = await g(req("/not-authorized", { accept: "text/html" }), page);
    expect(landing.status).toBe(403);
    const api = await g(req("/api/x"), page);
    expect(api.status).toBe(403);
    const ok = await gate({ state: "signed-in", principal: { role: "admin" } })(req("/reports", { accept: "text/html" }), page);
    expect(ok.status).toBe(200);
  });

  it("4: a throwing permission check denies rather than erroring", async () => {
    const g = gate({ state: "signed-in", principal: { role: "admin" } }, { isPermitted: () => { throw new Error("x"); } });
    expect((await g(req("/api/x"), page)).status).toBe(403);
  });

  it("5: an unconfigured or unavailable provider never yields 500; gated routes fail closed to sign-in", async () => {
    for (const state of [{ state: "unavailable" } as const, new Error("missing publishable key")]) {
      const g = gate(state);
      const nav = await g(req("/reports", { accept: "text/html" }), page);
      expect(nav.status).toBe(307);
      expect(nav.headers.get("location")).toContain("/sign-in?redirect_url=");
      expect((await g(req("/api/x"), page)).status).toBe(401);
    }
  });

  it("5: sign-in passes through with the unavailable flag; production answers 503 with Retry-After", async () => {
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
    const healthy = await gate({ state: "signed-out" }, { production: true })(req("/sign-in"), next);
    expect(healthy.status).toBe(200);
    expect(healthy.headers.get("retry-after")).toBeNull();
  });

  it("6: every response carries X-Robots-Tag: noindex, nofollow", async () => {
    const signedOut = gate({ state: "signed-out" });
    const denied = gate({ state: "signed-in", principal: { role: "viewer" } });
    const ok = gate({ state: "signed-in", principal: { role: "admin" } });
    const responses = [
      await signedOut(req("/x", { accept: "text/html" }), page),
      await signedOut(req("/api/x"), page),
      await signedOut(req("/sign-in"), page),
      await denied(req("/x", { accept: "text/html" }), page),
      await denied(req("/api/x"), page),
      await denied(req("/not-authorized"), page),
      await ok(req("/x"), page),
      await gate({ state: "unavailable" }, { production: true })(req("/sign-in"), page),
      await gate({ state: "signed-out" }, { protectedResourceMetadata: { authorization_servers: [] } })(req(PROTECTED_RESOURCE_METADATA_PATH), page),
    ];
    for (const res of responses) expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("rejects malformed options at construction", () => {
    expect(() => createGatedHostGate({ signInPath: "sign-in", notAuthorizedPath: "/n", resolvePrincipal: () => ({ state: "signed-out" }) })).toThrow(TypeError);
  });
});
