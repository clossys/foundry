import { describe, expect, it } from "vitest";
import type { ContentMap } from "../content-map/contract.js";
import type { BoundPage, BoundSlot } from "./index.js";
import { applySiteNavigation, planSite, siteLinkFindings, type SiteRoutePack } from "./site.js";

const page = (id: string, order: number, path: string, sectionIds: string[], nav = false) => ({
  id, order, title: `site.nav-${id}`, kind: "page" as const, path, source: { frameId: "frames.site-shell", sectionIds }, ...(nav ? { pin: { nav: true as const } } : {}),
});
const MAP: ContentMap = {
  version: 1, publicationId: "example-site", format: "web.page.responsive",
  entries: [page("home", 0, "/", ["sections.hero", "sections.pricing"], true), page("contact", 1, "/contact", ["sections.form"], true), page("terms", 2, "/terms", ["sections.legal-prose"])],
} as ContentMap;
const PACK: SiteRoutePack = {
  packId: "example-site", app: "apps/site",
  routes: [
    { instanceId: "home", path: "/", slots: [{ section: "sections.hero", state: "active" }, { section: "sections.pricing", state: "active" }] },
    { instanceId: "contact", path: "/contact", slots: [{ section: "sections.form", state: "active" }] },
    { instanceId: "terms", path: "/terms", slots: [{ section: "sections.legal-prose", state: "active" }] },
  ],
};

const slot = (name: string, props: Record<string, unknown>, role: BoundSlot["role"] = "part"): BoundSlot => ({ slot: name, role, id: `${name}/x`, version: 1, entry: { file: "x.tsx" }, props, copy: {}, text: {}, assets: {} });
const bound = (): BoundPage => ({
  schema: "clossys.bound-page/1", id: "home",
  frame: slot("frames.site-shell", { header: { $element: "frames.site-header" } }, "frame"),
  sections: [slot("sections.hero", { primaryHref: "/contact", secondaryHref: "#steps" }, "section")],
  parts: [slot("frames.site-header", { links: [{ label: "Old", href: "/" }] }), slot("frames.site-footer", { links: [{ label: "Old", href: "/legal" }], homeHref: "/" })],
});

describe("planSite", () => {
  it("routes every content-map page at its path, from its route-pack slots, in one frame", () => {
    const { plan, findings } = planSite(MAP, PACK, { origin: "https://example.test" });
    expect(findings).toEqual([]);
    expect(plan!.routes.map(route => route.path)).toEqual(MAP.entries.map(entry => "path" in entry ? entry.path : undefined));
    expect(plan!.routes.find(route => route.id === "home")!.sections).toEqual(["sections.hero", "sections.pricing"]);
    expect(plan!.frame).toBe("frames.site-shell");
    expect(plan!.navigation.primary.map(link => link.href)).toEqual(["/", "/contact"]);
    expect(plan!.navigation.secondary).toEqual([{ id: "terms", label: "site.nav-terms", href: "/terms" }]);
    expect(plan!.origin).toBe("https://example.test");
    expect(plan!.sitemap).toEqual(["https://example.test/", "https://example.test/contact", "https://example.test/terms"]);
  });

  it("takes the origin from target config over the route pack, writes no sitemap without one, and refuses a path origin", () => {
    expect(planSite(MAP, { ...PACK, origin: "https://pack.test" }, { origin: "http://localhost:4621" }).plan!.origin).toBe("http://localhost:4621");
    expect(planSite(MAP, { ...PACK, origin: "https://pack.test" }).plan!.origin).toBe("https://pack.test");
    const bare = planSite(MAP, PACK);
    expect(bare.plan!.sitemap).toBeUndefined();
    expect(bare.findings.map(row => [row.code, row.severity])).toEqual([["site-contract", "info"]]);
    expect(planSite(MAP, PACK, { origin: "https://example.test/base" }).plan).toBeUndefined();
  });

  it("stops on a page with no route, a path or slot disagreement, and an extra route", () => {
    const pack: SiteRoutePack = { packId: "x", routes: [
      { instanceId: "home", path: "/home", slots: [{ section: "sections.hero" }] },
      { instanceId: "contact", slots: [{ section: "sections.form" }, { section: "sections.faq", state: "draft" }] },
      { instanceId: "about", slots: [] },
    ] };
    const { plan, findings } = planSite(MAP, pack, { origin: "https://example.test" });
    expect(plan).toBeUndefined();
    expect(findings.map(row => row.code).sort()).toEqual(["site-inactive-slot", "site-path-mismatch", "site-route-extra", "site-route-missing", "site-sections-mismatch"]);
  });

  it("refuses two frames", () => {
    const map = { ...MAP, entries: MAP.entries.map(entry => entry.id === "terms" ? { ...entry, source: { frameId: "frames.legal", sectionIds: ["sections.legal-prose"] } } : entry) } as ContentMap;
    expect(planSite(map, PACK, { origin: "https://example.test" }).findings.map(row => row.code)).toEqual(["site-frame-mismatch"]);
  });
});

describe("applySiteNavigation and siteLinkFindings", () => {
  const { plan } = planSite(MAP, PACK);
  const copy = { "site.nav-home": "Home", "site.nav-contact": "Contact", "site.nav-terms": "Terms" };

  it("gives the header the pinned pages and the footer the rest, labelled from Writer", () => {
    const { page, findings } = applySiteNavigation(bound(), plan!, copy);
    expect(findings).toEqual([]);
    expect(page.parts[0]!.props.links).toEqual([{ label: "Home", href: "/" }, { label: "Contact", href: "/contact" }]);
    expect(page.parts[1]!.props.links).toEqual([{ label: "Terms", href: "/terms" }]);
    expect(page.parts[1]!.props.homeHref).toBe("/");
    expect(page.sections[0]).toEqual(bound().sections[0]);
    expect(siteLinkFindings(page, plan!)).toEqual([]);
  });

  it("rejects an unmapped internal link (blocking) and reports a missing title key", () => {
    expect(applySiteNavigation(bound(), plan!, {}).findings.map(row => row.code)).toContain("missing-copy-key");
    const findings = siteLinkFindings(bound(), plan!);
    expect(findings.map(row => row.detail)).toEqual(["home: frames.site-footer links to /legal, which is no site route"]);
    expect(findings.every(row => row.code === "site-dead-link" && row.severity === undefined)).toBe(true);
  });
});
