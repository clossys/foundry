/**
 * Gated-host response helpers: the robots tag, no-store on auth, redirect and
 * error responses, a deny-all `robots.txt`, a health route and a 503.
 */
import { describe, expect, it } from "vitest";
import {
  GATED_HOST_ROBOTS_TAG,
  GATED_HOST_ROBOTS_TXT,
  applyGatedHostHeaders,
  createHealthRoute,
  createRobotsTxtRoute,
  createServiceUnavailableResponse,
} from "./index.js";

describe("gated-host response helpers", () => {
  it("robots tag is one exact value", () => {
    const response = new Response("ok", { headers: { "X-Robots-Tag": "index" } });

    applyGatedHostHeaders(response);

    expect(GATED_HOST_ROBOTS_TAG).toBe("noindex, nofollow");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("no-store by status", () => {
    for (const status of [307, 401, 403, 503]) {
      const response = new Response(null, {
        status,
        headers: status === 503 ? { "Cache-Control": "public, max-age=60" } : {},
      });

      applyGatedHostHeaders(response);

      expect(response.headers.get("Cache-Control"), `status ${status}`).toBe("no-store");
    }

    const ok = new Response("ok", { status: 200 });
    applyGatedHostHeaders(ok);
    expect(ok.headers.get("Cache-Control")).toBeNull();

    const signIn = new Response("sign in", { status: 200 });
    applyGatedHostHeaders(signIn, { noStore: true });
    expect(signIn.headers.get("Cache-Control")).toBe("no-store");
  });

  it("robots.txt body", async () => {
    const route = createRobotsTxtRoute();

    const first = route();
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(first.headers.get("X-Robots-Tag")).toBe(GATED_HOST_ROBOTS_TAG);
    expect(GATED_HOST_ROBOTS_TXT).toBe("User-agent: *\nDisallow: /");
    expect(await first.text()).toBe("User-agent: *\nDisallow: /");

    const second = route();
    expect(await second.text()).toBe("User-agent: *\nDisallow: /");
  });

  it("health", async () => {
    expect(createHealthRoute.length).toBe(0);

    const response = createHealthRoute()();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok"}');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe(GATED_HOST_ROBOTS_TAG);
  });

  it("503 with Retry-After", async () => {
    const byDefault = createServiceUnavailableResponse();
    expect(byDefault.status).toBe(503);
    expect(byDefault.headers.get("Retry-After")).toBe("30");
    expect(byDefault.headers.get("Cache-Control")).toBe("no-store");
    expect(byDefault.headers.get("X-Robots-Tag")).toBe(GATED_HOST_ROBOTS_TAG);
    expect(await byDefault.text()).toBe('{"error":"unavailable"}');

    const custom = createServiceUnavailableResponse({ retryAfterSeconds: 120 });
    expect(custom.headers.get("Retry-After")).toBe("120");

    for (const retryAfterSeconds of [-1, 1.5, Number.NaN]) {
      expect(() => createServiceUnavailableResponse({ retryAfterSeconds })).toThrow(TypeError);
    }
  });
});
