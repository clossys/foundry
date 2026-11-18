import { describe, expect, it } from "vitest";
import type { CandidateRecord, SlotRecord } from "../types.js";
import type { CertifyEnv } from "./env.js";
import { certifyPage } from "./page.js";
import { isDynamicRoute, routeInstanceOf } from "./route.js";

// foundry-build-0048 U20: the dynamic route page format in the page certifier. One page record serves
// /admin/<agent>/<slot>; the contract fixture's sample route is one instance of it.
describe("the dynamic route page format (certify)", () => {
  it("reads <param> segments and matches a concrete route against a pattern", () => {
    expect(isDynamicRoute("/admin/<agent>/<slot>")).toBe(true);
    expect(isDynamicRoute("/admin/requests")).toBe(false);
    expect(routeInstanceOf("/admin/<agent>/<slot>", "/admin/designer/sections.hero")).toBe(true);
    expect(routeInstanceOf("/admin/<agent>", "/admin/designer")).toBe(true);
    for (const url of ["/admin/designer", "/admin/Designer/x", "/console/designer/x", "/admin/designer/x/y", "admin/designer/x"]) expect(routeInstanceOf("/admin/<agent>/<slot>", url), url).toBe(false);
  });

  const env = { pins: new Map(), recordPins: new Map(), live: new Map(), copy: new Map(), writerKeys: new Map() } as unknown as CertifyEnv;
  const slot = { id: "page.admin-slot" } as SlotRecord;
  const page = (path: string) => ({ json: { schema: "clossys.page/1", path } }) as unknown as CandidateRecord;
  const contract = { route: "/admin/<agent>/<slot>", fixture: { route: { path: "/admin/designer/sections.hero" } } };
  const fixtures = (path: string) => certifyPage(slot, page(path), contract, env).filter(item => item.code === "fixture").map(item => item.message);

  it("passes a dynamic page whose path is the contract route and whose fixture is an instance of it", () => {
    expect(fixtures("/admin/<agent>/<slot>")).toEqual([]);
  });

  it("mutation: a dynamic path that is not the contract route, or a fixture that is no instance of it, fails", () => {
    expect(fixtures("/admin/<agent>/<id>")).toEqual(["routes /admin/<agent>/<id>, not the contract route /admin/<agent>/<slot>"]);
    const loose = { fixture: { route: { path: "/admin/designer" } } };
    expect(certifyPage(slot, page("/admin/<agent>/<slot>"), loose, env).map(item => item.message)).toEqual(["routes /admin/<agent>/<slot>, which the contract fixture's /admin/designer is no instance of"]);
  });

  it("keeps the static rule: a static page routes exactly the fixture's sample", () => {
    expect(certifyPage(slot, page("/admin/requests"), { fixture: { route: { path: "/admin/requests" } } }, env)).toEqual([]);
    expect(certifyPage(slot, page("/admin/questions"), { fixture: { route: { path: "/admin/requests" } } }, env).map(item => item.message)).toEqual(["routes /admin/questions, not the contract fixture's /admin/requests"]);
  });
});
