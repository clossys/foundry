/**
 * Front-door conformance kit, HTTP half: a conforming host passes, each
 * invariant fails on its own rule, and the kit takes every expected value from
 * the merged helpers.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertFrontDoorHttp,
  checkFrontDoorHttp,
  createHealthRoute,
  createRobotsTxtRoute,
  createServiceUnavailableResponse,
  createSiteSecurityHeaders,
  applyGatedHostHeaders,
} from "./index.js";
import type { FrontDoorHttpConfig, FrontDoorRule } from "./index.js";

const ORIGIN = "https://front-door.example";

const config: FrontDoorHttpConfig = {
  origin: ORIGIN,
  signInPaths: ["/sign-in"],
  boundaryPaths: ["/app"],
  serviceUnavailable: () => createServiceUnavailableResponse(),
};

function productionHeaders(): Record<string, string> {
  const production = createSiteSecurityHeaders({ script: { mode: "nonce", nonce: "n" } }).production;
  if (!production.ok) throw new Error("fixture: production headers refused");
  return { ...production.headers };
}

type Routes = Record<string, () => Response>;

function conformingRoutes(): Routes {
  return {
    "/robots.txt": createRobotsTxtRoute(),
    "/health": createHealthRoute(),
    "/sign-in": () =>
      applyGatedHostHeaders(new Response("sign in", { status: 200, headers: productionHeaders() }), {
        noStore: true,
      }),
    "/app": () => applyGatedHostHeaders(new Response(null, { status: 401 })),
  };
}

function hostOf(routes: Routes): (request: Request) => Response {
  return (request) => {
    const route = routes[new URL(request.url).pathname];
    return route ? route() : applyGatedHostHeaders(new Response(null, { status: 404 }));
  };
}

async function rulesOf(routes: Routes, overrides: Partial<FrontDoorHttpConfig> = {}) {
  return checkFrontDoorHttp({ ...config, ...overrides }, hostOf(routes));
}

function onlyRule(violations: readonly { route: string; rule: FrontDoorRule }[], route: string, rule: FrontDoorRule) {
  expect(violations.map((violation) => `${violation.route} ${violation.rule}`)).toEqual([`${route} ${rule}`]);
}

describe("conforming host", () => {
  it("yields no violations and assertFrontDoorHttp resolves", async () => {
    const handle = hostOf(conformingRoutes());

    expect(await checkFrontDoorHttp(config, handle)).toEqual([]);
    await expect(assertFrontDoorHttp(config, handle)).resolves.toBeUndefined();
  });

  it("accepts an async handler and a 3xx boundary", async () => {
    const routes = conformingRoutes();
    routes["/app"] = () =>
      applyGatedHostHeaders(new Response(null, { status: 302, headers: { Location: "/sign-in" } }));
    const handle = async (request: Request) => hostOf(routes)(request);

    expect(await checkFrontDoorHttp(config, handle)).toEqual([]);
  });

  it("sends a GET with no cookie to the configured paths", async () => {
    const seen: Request[] = [];
    const routes = conformingRoutes();
    await checkFrontDoorHttp(
      { ...config, robotsPath: "/r", healthPath: "/h" },
      (request) => {
        seen.push(request);
        return hostOf({ ...routes, "/r": routes["/robots.txt"]!, "/h": routes["/health"]! })(request);
      },
    );

    expect(seen.map((request) => new URL(request.url).pathname)).toEqual(["/sign-in", "/app", "/r", "/h"]);
    expect(seen.every((request) => request.method === "GET" && request.headers.get("cookie") === null)).toBe(true);
  });
});

describe("each invariant", () => {
  it("sign-in without no-store yields no-store with its route", async () => {
    const routes = conformingRoutes();
    routes["/sign-in"] = () => applyGatedHostHeaders(new Response("sign in", { headers: productionHeaders() }));

    onlyRule(await rulesOf(routes), "/sign-in", "no-store");
  });

  it("a boundary without no-store yields no-store", async () => {
    const routes = conformingRoutes();
    routes["/app"] = () => {
      const response = applyGatedHostHeaders(new Response(null, { status: 401 }));
      response.headers.delete("Cache-Control");
      return response;
    };

    onlyRule(await rulesOf(routes), "/app", "no-store");
  });

  it("a missing robots tag yields robots-tag", async () => {
    const routes = conformingRoutes();
    routes["/app"] = () => new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });

    onlyRule(await rulesOf(routes), "/app", "robots-tag");
  });

  it("a boundary that serves the page yields boundary-status", async () => {
    const routes = conformingRoutes();
    routes["/app"] = () => applyGatedHostHeaders(new Response("page", { status: 200 }), { noStore: true });

    onlyRule(await rulesOf(routes), "/app", "boundary-status");
  });

  it("an allowing robots body yields robots-txt", async () => {
    const routes = conformingRoutes();
    routes["/robots.txt"] = () => applyGatedHostHeaders(new Response("User-agent: *\nAllow: /"));

    onlyRule(await rulesOf(routes), "/robots.txt", "robots-txt");
  });

  it("a health redirect yields health", async () => {
    const routes = conformingRoutes();
    routes["/health"] = () =>
      applyGatedHostHeaders(new Response(null, { status: 302, headers: { Location: "/sign-in" } }));

    onlyRule(await rulesOf(routes), "/health", "health");
  });

  it("a health body that differs yields health", async () => {
    const routes = conformingRoutes();
    routes["/health"] = () =>
      applyGatedHostHeaders(new Response('{"status":"degraded"}', { status: 200 }), { noStore: true });

    onlyRule(await rulesOf(routes), "/health", "health");
  });

  it("a 503 without Retry-After yields service-unavailable", async () => {
    const violations = await rulesOf(conformingRoutes(), {
      serviceUnavailable: () => {
        const response = createServiceUnavailableResponse();
        response.headers.delete("Retry-After");
        return response;
      },
    });

    onlyRule(violations, "serviceUnavailable", "service-unavailable");
  });

  it("a 503 with a non-integer Retry-After, a wrong status or a wrong body yields service-unavailable", async () => {
    const badRetry = await rulesOf(conformingRoutes(), {
      serviceUnavailable: () => {
        const response = createServiceUnavailableResponse();
        response.headers.set("Retry-After", "soon");
        return response;
      },
    });
    onlyRule(badRetry, "serviceUnavailable", "service-unavailable");

    const badStatus = await rulesOf(conformingRoutes(), {
      serviceUnavailable: () => applyGatedHostHeaders(new Response("{}", { status: 500 })),
    });
    expect(badStatus.map((violation) => violation.rule)).toContain("service-unavailable");

    const badBody = await rulesOf(conformingRoutes(), {
      serviceUnavailable: () =>
        applyGatedHostHeaders(new Response("down", { status: 503, headers: { "Retry-After": "5" } })),
    });
    onlyRule(badBody, "serviceUnavailable", "service-unavailable");
  });

  it("a 503 without no-store or the robots tag yields those rules", async () => {
    const violations = await rulesOf(conformingRoutes(), {
      serviceUnavailable: () =>
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "Retry-After": "30" },
        }),
    });

    expect(violations.map((violation) => violation.rule).sort()).toEqual(["no-store", "robots-tag"]);
  });

  it("a sign-in without Strict-Transport-Security yields security-headers", async () => {
    const routes = conformingRoutes();
    routes["/sign-in"] = () => {
      const headers = productionHeaders();
      delete headers["Strict-Transport-Security"];
      return applyGatedHostHeaders(new Response("sign in", { headers }), { noStore: true });
    };

    onlyRule(await rulesOf(routes), "/sign-in", "security-headers");
  });

  it("a sign-in with a wrong Referrer-Policy, Permissions-Policy or no Content-Security-Policy yields security-headers", async () => {
    for (const header of ["Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"]) {
      const routes = conformingRoutes();
      routes["/sign-in"] = () => {
        const headers = productionHeaders();
        headers[header] = header === "Content-Security-Policy" ? "" : "unsafe-url";
        return applyGatedHostHeaders(new Response("sign in", { headers }), { noStore: true });
      };

      onlyRule(await rulesOf(routes), "/sign-in", "security-headers");
    }
  });

  it("a throwing handler yields handler-threw and never throws", async () => {
    const violations = await checkFrontDoorHttp(config, () => {
      throw new Error("boom");
    });

    expect(violations.map((violation) => violation.rule)).toEqual(Array(4).fill("handler-threw"));
    expect(violations.map((violation) => violation.route)).toEqual(["/sign-in", "/app", "/robots.txt", "/health"]);
  });

  it("a throwing or rejecting serviceUnavailable yields one handler-threw", async () => {
    for (const serviceUnavailable of [
      () => {
        throw new Error("boom");
      },
      () => Promise.reject(new Error("boom")),
    ]) {
      onlyRule(await rulesOf(conformingRoutes(), { serviceUnavailable }), "serviceUnavailable", "handler-threw");
    }
  });

  it("assertFrontDoorHttp rejects naming every route", async () => {
    const routes = conformingRoutes();
    routes["/sign-in"] = () => applyGatedHostHeaders(new Response("sign in", { headers: productionHeaders() }));
    routes["/health"] = () => applyGatedHostHeaders(new Response(null, { status: 302 }));
    routes["/robots.txt"] = () => new Response("User-agent: *\nAllow: /");

    const failure = assertFrontDoorHttp(config, hostOf(routes));

    await expect(failure).rejects.toThrow(Error);
    const message = await failure.then(
      () => "",
      (error: Error) => error.message,
    );
    for (const route of ["/sign-in", "/health", "/robots.txt"]) {
      expect(message).toContain(route);
    }
    expect(message).toContain("no-store");
    expect(message).toContain("health");
    expect(message).toContain("robots-txt");
  });

  it("rejects a non-absolute origin", async () => {
    await expect(checkFrontDoorHttp({ origin: "/relative" }, hostOf(conformingRoutes()))).rejects.toThrow(TypeError);
  });
});

describe("single source", () => {
  it("takes expected values from the merged helpers", () => {
    const source = readFileSync(new URL("./front-door-conformance.ts", import.meta.url), "utf8");

    expect(source).toMatch(/from "\.\/host-responses\.js"/);
    expect(source).not.toContain("noindex");
    expect(source).not.toContain("Disallow");
  });
});
