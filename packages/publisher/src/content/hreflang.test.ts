import { describe, expect, it } from "vitest";
import { buildLocaleRoutePlan, buildSitemapAlternates, localePathFor } from "./hreflang.js";
import type { LocaleRouteOptions } from "./hreflang.js";
import type { ContentSlot } from "./model.js";

const slot = (patch: Partial<ContentSlot> = {}): ContentSlot => ({
  id: "sl_aaaaaaaaaa", aliases: [], locales: ["en-US", "fr-CA"], l1: "websites", l2: "site",
  position: { order: 0, name: "about" }, name: "About", kind: "content", route: "/about",
  deployTarget: "site", devOnly: false, tags: [], releases: [], createdAt: "2026-01-01T00:00:00Z", ...patch,
});
const options = (patch: Partial<LocaleRouteOptions> = {}): LocaleRouteOptions => ({
  workspace: { consumerId: "sample", defaultLocale: "en-US", locales: ["en-US", "fr-CA"], destinations: [],
    deployTargets: [{ id: "site", repo: "sample", app: "site", origin: "https://example.com/" }] },
  manifest: { defaultLocale: "en-US", locales: [{ tag: "en-US", dir: "ltr", state: "active" }, { tag: "fr-CA", dir: "ltr", state: "active" }], fallback: {} },
  bodyServedLocales: { "en-US": ["en-US"], "fr-CA": ["fr-CA"] },
  existingUrls: ["https://example.com/about", "https://example.com/fr-ca/about"], ...patch,
});
const rules = (value: ReturnType<typeof buildLocaleRoutePlan>) => value.findings.map(finding => finding.rule);

describe("locale paths", () => {
  it("uses Writer normalization and leaves the default unprefixed", () => {
    expect(localePathFor("/about", "EN-us", "en-US")).toBe("/about");
    expect(localePathFor("/about", "fr-CA", "en-US")).toBe("/fr-ca/about");
    expect(localePathFor("/", "fr-CA", "en-US")).toBe("/fr-ca");
    expect(localePathFor("/about", "iw-IL", "en-US")).toBe("/he-il/about");
  });
  it.each(["relative", "//about", "/a//b", "/a/", "/a?x=1", "/a#part", "/../a", "/a/./b", "/%2e%2e/a", "/a\\b", "/bad%escape"])("rejects noncanonical route %s", route => {
    expect(() => localePathFor(route, "fr-CA", "en-US")).toThrow(TypeError);
  });
  it("refuses malformed locale tags", () => {
    expect(() => localePathFor("/", "fr_CA", "en-US")).toThrow();
    expect(() => localePathFor("/", "fr-CA", "en_US")).toThrow();
  });
});

describe("locale route plans", () => {
  it("derives static paths, self canonicals and one reciprocal head/sitemap set", () => {
    const plan = buildLocaleRoutePlan(slot(), options());
    const alternates = [{ hreflang: "en-US", href: "https://example.com/about" }, { hreflang: "fr-CA", href: "https://example.com/fr-ca/about" }, { hreflang: "x-default", href: "https://example.com/about" }];
    expect(plan.ready).toBe(true);
    expect(plan.findings).toEqual([]);
    expect(plan.pages.map(page => [page.locale, page.path, page.outputPath, page.canonical, page.hreflangEligible])).toEqual([
      ["en-US", "/about", "site/app/about/page.tsx", "https://example.com/about", true],
      ["fr-CA", "/fr-ca/about", "site/app/fr-ca/about/page.tsx", "https://example.com/fr-ca/about", true],
    ]);
    for (const page of plan.pages) expect(page.alternates).toEqual(alternates);
    expect(buildSitemapAlternates(plan)).toEqual(plan.pages.map(page => ({ url: page.url, alternates })));
  });
  it("accepts explicit copy-free bodies", () => {
    expect(buildLocaleRoutePlan(slot(), options({ bodyServedLocales: { "en-US": [], "fr-CA": [] } })).ready).toBe(true);
  });
  it("publishes fallback pages while excluding them from alternates and sitemap", () => {
    const plan = buildLocaleRoutePlan(slot(), options({ bodyServedLocales: { "en-US": ["en-US"], "fr-CA": ["fr-CA", "en-US"] } }));
    expect(plan.ready).toBe(true);
    expect(plan.pages).toHaveLength(2);
    expect(plan.findings).toContainEqual(expect.objectContaining({ rule: "body-locale-fallback", severity: "warning" }));
    expect(plan.pages[1]?.hreflangEligible).toBe(false);
    expect(plan.pages[0]?.alternates.map(alternate => alternate.hreflang)).toEqual(["en-US", "x-default"]);
    expect(buildSitemapAlternates(plan).map(entry => entry.url)).toEqual(["https://example.com/about"]);
  });
  it("requires own explicit body evidence and rejects unknown or unauthorized served locales", () => {
    for (const bodyServedLocales of [{ "en-US": [] }, { "en-US": [], "fr-CA": ["de"] }, { "en-US": [], "fr-CA": ["fr-ca"] }]) {
      const plan = buildLocaleRoutePlan(slot(), options({ bodyServedLocales }));
      expect(plan.ready).toBe(false);
      expect(plan.pages[1]?.hreflangEligible).toBe(false);
    }
    const inherited = Object.create({ "fr-CA": [] }) as Record<string, string[]>;
    inherited["en-US"] = [];
    expect(rules(buildLocaleRoutePlan(slot(), options({ bodyServedLocales: inherited })))).toContain("body-locale-coverage");
    const value = options();
    const manifest = { ...value.manifest, locales: [...value.manifest.locales, { tag: "de", dir: "ltr" as const, state: "active" as const }] };
    expect(rules(buildLocaleRoutePlan(slot(), options({ manifest, bodyServedLocales: { "en-US": [], "fr-CA": ["de"] } })))).toContain("body-locale-invalid");
  });
  it.each(["pseudo", "planned"] as const)("refuses %s body sources even in the Writer fallback chain", state => {
    const value = options();
    const manifest = { ...value.manifest,
      locales: [...value.manifest.locales, { tag: "en-XA", dir: "ltr" as const, state }],
      fallback: { "fr-CA": ["en-XA"] },
    };
    const plan = buildLocaleRoutePlan(slot(), options({ manifest, bodyServedLocales: { "en-US": [], "fr-CA": ["en-XA"] } }));
    expect(plan.ready).toBe(false);
    expect(plan.pages[1]?.hreflangEligible).toBe(false);
    expect(plan.findings).toContainEqual(expect.objectContaining({ rule: "body-locale-invalid", severity: "error" }));
    expect(rules(plan)).not.toContain("body-locale-fallback");
    expect(buildSitemapAlternates(plan)).toEqual([]);
  });
  it("excludes absent inventory targets and never invents an x-default", () => {
    const plan = buildLocaleRoutePlan(slot(), options({ existingUrls: ["https://example.com/fr-ca/about"] }));
    expect(plan.ready).toBe(false);
    expect(rules(plan)).toContain("hreflang-target-missing");
    expect(rules(plan)).toContain("hreflang-default-missing");
    expect(buildSitemapAlternates(plan)).toEqual([]);
    expect(plan.pages[1]?.alternates).toEqual([{ hreflang: "fr-CA", href: "https://example.com/fr-ca/about" }]);
    const noDefault = buildLocaleRoutePlan(slot({ locales: ["fr-CA"] }), options());
    expect(rules(noDefault)).toContain("default-locale-membership");
    expect(noDefault.pages.flatMap(page => page.alternates).some(alternate => alternate.hreflang === "x-default")).toBe(false);
  });
  it("rejects a default body served in another locale", () => {
    const value = options();
    const manifest = { ...value.manifest, fallback: { "en-US": ["fr-CA"] } };
    const plan = buildLocaleRoutePlan(slot(), options({ manifest, bodyServedLocales: { "en-US": ["fr-CA"], "fr-CA": [] } }));
    expect(rules(plan)).toContain("hreflang-default-missing");
    expect(plan.ready).toBe(false);
    expect(plan.pages[1]?.alternates.some(alternate => alternate.hreflang === "x-default")).toBe(false);
  });
  it("accepts legacy default canonicals and locale self canonical maps", () => {
    for (const canonical of ["https://EXAMPLE.com:443/about", { "en-US": "https://example.com/about", "fr-CA": "https://example.com/fr-ca/about" }]) {
      expect(buildLocaleRoutePlan(slot({ meta: { canonical } }), options()).ready).toBe(true);
    }
  });
  it("reports invalid explicit canonicals without disguising them as ready", () => {
    for (const canonical of ["https://example.com/other", {}, { "fr-CA": "https://example.com/about" }, { "fr-ca": "https://example.com/fr-ca/about" }, { de: "https://example.com/de/about" }, { "fr-CA": "/fr-ca/about" }]) {
      const plan = buildLocaleRoutePlan(slot({ meta: { canonical } }), options());
      expect(plan.ready).toBe(false);
      expect(plan.findings.some(finding => finding.rule.startsWith("canonical-"))).toBe(true);
      expect(plan.pages[1]?.canonical).toBe("https://example.com/fr-ca/about");
      expect(buildSitemapAlternates(plan)).toEqual([]);
    }
  });
  it.each([undefined, "https://user:pass@example.com", "https://example.com/path", "https://example.com/a/..", "https://example.com?x=1", "https://example.com/#part", "ftp://example.com", "https://example.com\\path", " https://example.com"])("rejects unsafe or missing selected origins: %s", origin => {
    const value = options();
    const workspace = { ...value.workspace, deployTargets: [{ id: "site", repo: "sample", app: "site", origin }] };
    const plan = buildLocaleRoutePlan(slot(), options({ workspace }));
    expect(plan.ready).toBe(false);
    expect(rules(plan)).toContain("deploy-origin");
    expect(plan.pages).toEqual([]);
  });
  it("uses only a unique selected deploy target", () => {
    const value = options();
    for (const deployTargets of [[], [...value.workspace.deployTargets, ...value.workspace.deployTargets]]) {
      expect(rules(buildLocaleRoutePlan(slot(), options({ workspace: { ...value.workspace, deployTargets } })))).toContain("deploy-target");
    }
    const workspace = { ...value.workspace, deployTargets: [{ id: "other", repo: "sample", app: "other", origin: "https://other.example" }, ...value.workspace.deployTargets] };
    expect(buildLocaleRoutePlan(slot(), options({ workspace })).pages[0]?.url).toBe("https://example.com/about");
  });
  it("reports canonical, unique, declared active locale and default constraints", () => {
    for (const locales of [["en-US", "fr-ca"], ["en-US", "fr-CA", "fr-CA"], ["en-US", "de"]]) {
      expect(buildLocaleRoutePlan(slot({ locales }), options()).ready).toBe(false);
    }
    const value = options();
    for (const state of ["pseudo", "planned"] as const) {
      const manifest = { ...value.manifest, locales: value.manifest.locales.map(locale => locale.tag === "fr-CA" ? { ...locale, state } : locale) };
      const plan = buildLocaleRoutePlan(slot(), options({ manifest }));
      expect(rules(plan)).toContain("unpublished-locale");
      expect(plan.pages.map(page => page.locale)).toEqual(["en-US"]);
    }
    expect(rules(buildLocaleRoutePlan(slot(), options({ workspace: { ...value.workspace, defaultLocale: "fr-CA" } })))).toContain("default-locale-mismatch");
  });
});
