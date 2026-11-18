import { describe, expect, it } from "vitest";
import { matchRoute, parseRoute, publicationRootFindings, reservedParams, routeFormatFindings, routeInstanceOf } from "./route-format.js";
import { checkTree, FIXED_PUBLICATIONS, loadStarter, PUBLISHER_TREES, slotContract, STARTER_IDS, type L0Tree, type PageSlot } from "./tree.js";

// foundry-build-0048 U20: the dynamic route page format. One page record serves a parameterised route; a static
// segment wins over a parameter at the same position; the admin publication roots at /admin.
const pagePaths = (): { id: string; path: string }[] => PUBLISHER_TREES.flatMap(tree => Object.entries(tree.slots)
  .filter(([, contract]) => contract.kind === "page" && typeof (contract as PageSlot).path === "string" && !contract.parked)
  .map(([id, contract]) => ({ id, path: (contract as PageSlot).path! })));
const withPage = (id: string, change: Partial<PageSlot>): readonly L0Tree[] => PUBLISHER_TREES.map(tree => tree.l0 !== "directory" ? tree : {
  ...tree, slots: Object.fromEntries(Object.entries(tree.slots).map(([key, contract]) => [key, key === id ? { ...contract, ...change } : contract])),
}) as readonly L0Tree[];

describe("the dynamic route page format", () => {
  it("parses static and parameter segments, and refuses anything else", () => {
    expect(parseRoute("/admin/<agent>/<slot>")).toEqual({ ok: true, pattern: { path: "/admin/<agent>/<slot>", segments: [{ kind: "static", value: "admin" }, { kind: "param", name: "agent" }, { kind: "param", name: "slot" }], params: ["agent", "slot"] } });
    expect(parseRoute("/")).toMatchObject({ ok: true, pattern: { segments: [], params: [] } });
    for (const bad of ["admin", "/admin/", "/Admin", "/admin/:agent", "/admin/<Agent>", "/admin/<agent>/<agent>", "/a//b"]) expect(parseRoute(bad).ok, bad).toBe(false);
  });

  it("holds every live Publisher page route to the format (checkTree is clean)", () => {
    expect(routeFormatFindings(PUBLISHER_TREES.flatMap(tree => Object.entries(tree.slots).filter(([, contract]) => contract.kind === "page" && !contract.parked && typeof (contract as PageSlot).path === "string")
      .map(([id, contract]) => ({ id, path: (contract as PageSlot).path!, ...((contract as PageSlot).collection ? { collection: (contract as PageSlot).collection } : {}) }))))).toEqual([]);
    expect(checkTree()).toEqual([]);
  });

  it("resolves a static segment before a parameter: /admin/requests is the requests page, /admin/designer the gallery", () => {
    const pages = pagePaths();
    expect(matchRoute(pages, "/admin/requests")).toEqual({ id: "page.admin-requests", path: "/admin/requests", params: {} });
    expect(matchRoute(pages, "/admin/questions")?.id).toBe("page.admin-questions");
    expect(matchRoute(pages, "/admin/designer")).toEqual({ id: "page.admin-gallery", path: "/admin/<agent>", params: { agent: "designer" } });
    expect(matchRoute(pages, "/admin/designer/sections.hero")).toEqual({ id: "page.admin-slot", path: "/admin/<agent>/<slot>", params: { agent: "designer", slot: "sections.hero" } });
    expect(matchRoute(pages, "/admin")?.id).toBe("page.admin-home");
    expect(matchRoute(pages, "/about")?.id).toBe("page.about");
    expect(matchRoute(pages, "/launch")).toEqual({ id: "page.site-page", path: "/<slug>", params: { slug: "launch" } });
    expect(matchRoute(pages, "/admin/Designer")).toBeUndefined();
    expect(routeInstanceOf("/admin/<agent>", "/admin/designer")).toBe(true);
    expect(routeInstanceOf("/admin/<agent>", "/admin/designer/x")).toBe(false);
  });

  it("reserves, for each parameter, the static segments that win over it", () => {
    const others = pagePaths().map(page => page.path);
    expect(reservedParams("/admin/<agent>", others)).toEqual({ agent: ["questions", "requests"] });
    expect(reservedParams("/admin/<agent>/<slot>", others)).toEqual({ agent: [], slot: [] });
    expect(reservedParams("/<slug>", others).slug).toEqual(expect.arrayContaining(["about", "admin", "pricing"]));
  });

  it("mutation: a page whose parameter ranges over no collection, or a collection with no parameter, is a finding", () => {
    expect(checkTree(withPage("page.admin-gallery", { collection: undefined }))).toEqual(["page.admin-gallery: route /admin/<agent> has a parameter but the page names no collection for it to range over"]);
    expect(checkTree(withPage("page.admin-requests", { collection: "agents" }))).toEqual(["page.admin-requests: names collection agents but route /admin/requests has no parameter"]);
  });

  it("mutation: two routes with the same static segments at the same positions are ambiguous", () => {
    expect(checkTree(withPage("page.admin-requests", { path: "/admin/<request>", collection: "requests" }))).toEqual([
      "page.admin-gallery, page.admin-requests: routes /admin/<agent> and /admin/<request> are ambiguous: the same static segments at the same positions, so neither wins",
    ]);
  });

  it("mutation: a route that does not parse is a finding", () => {
    expect(checkTree(withPage("page.admin-slot", { path: "/admin/:agent/:slot" }))).toEqual(['page.admin-slot: route /admin/:agent/:slot: segment ":agent" is neither a lower-case kebab segment nor a <parameter>']);
  });
});

describe("publication roots", () => {
  it("every starter's pages sit under its root, and the fixed admin publication roots at /admin", () => {
    expect(loadStarter("admin").root).toBe("/admin");
    for (const id of STARTER_IDS) {
      const starter = loadStarter(id);
      const paths = starter.pages.map(page => (slotContract(page) as PageSlot | undefined)?.path).filter((path): path is string => typeof path === "string");
      expect(publicationRootFindings(id, starter.root, paths, FIXED_PUBLICATIONS.includes(id)), id).toEqual([]);
    }
  });

  it("mutation: a fixed publication rooted at / (claiming the consumer's site root) or a page outside the root is a finding", () => {
    const paths = loadStarter("admin").pages.map(page => (slotContract(page) as PageSlot).path!);
    expect(publicationRootFindings("admin", "/", paths, true)).toEqual(["admin: a fixed publication roots under its own static prefix, never /"]);
    expect(publicationRootFindings("admin", "/admin", [...paths, "/console"], true)).toEqual(["admin: page route /console is outside the publication root /admin"]);
    expect(publicationRootFindings("admin", "/admin/<agent>", paths, true)).toEqual(['admin: root "/admin/<agent>" is not a static route']);
  });
});
