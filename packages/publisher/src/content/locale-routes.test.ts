import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as content from "./index.js";
import { checkContentApproval, computeContentDigest, loadContentStore, validateContentRevisionIntegrity, writeContentStore } from "./node.js";
import type { ContentStoreOptions } from "./node.js";
import { readConsumerLibrarySnapshot } from "./store/library.js";
import { libraryFixture } from "./__fixtures__/review.js";
import { localeRoutesFixture, localeRouteOrigin } from "./__fixtures__/locale-routes.js";

// Designer registration is the external seam; all Publisher records and disk I/O are real.
vi.mock("./store/library.js", () => ({ readConsumerLibrarySnapshot: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("consumer locale route contract", () => {
  it("joins native Writer copy, locale output paths, canonical tags and reciprocal alternates", () => {
    const { registry, options } = localeRoutesFixture();
    const slot = registry.slots[0]!, candidate = registry.candidates[0]!;
    const before = structuredClone({ registry, options });
    expect(content.validateContentRegistry(registry)).toEqual([]);
    expect(validateContentRevisionIntegrity(candidate)).toEqual([]);
    expect(checkContentApproval(candidate, "publish")).toEqual([]);
    expect(content.checkPageMetadata(slot, candidate, undefined, options)).toEqual([]);
    expect(content.resolveCopy(candidate, "en-US").copy.$pageMeta).toEqual({ title: "About our team", description: "Meet our team and learn what we do." });
    expect(content.resolveCopy(candidate, "fr-CA").copy.$pageMeta).toEqual({ title: "À propos de notre équipe", description: "Rencontrez notre équipe et découvrez nos activités." });
    expect(content.outputPathFor({ ...slot, locale: "en-US", defaultLocale: "en-US" })).toBe("public/app/about/page.tsx");
    expect(content.outputPathFor({ ...slot, locale: "fr-CA", defaultLocale: "en-US" })).toBe("public/app/fr-ca/about/page.tsx");
    expect(content.outputPathFor(slot)).toBe("public/app/about/page.tsx");
    const plan = content.buildLocaleRoutePlan(slot, options);
    const alternates = [
      { hreflang: "en-US", href: `${localeRouteOrigin}/about` },
      { hreflang: "fr-CA", href: `${localeRouteOrigin}/fr-ca/about` },
      { hreflang: "x-default", href: `${localeRouteOrigin}/about` },
    ];
    expect(plan).toEqual({ ready: true, findings: [], pages: [
      { locale: "en-US", path: "/about", url: `${localeRouteOrigin}/about`, canonical: `${localeRouteOrigin}/about`, outputPath: "public/app/about/page.tsx", hreflangEligible: true, alternates },
      { locale: "fr-CA", path: "/fr-ca/about", url: `${localeRouteOrigin}/fr-ca/about`, canonical: `${localeRouteOrigin}/fr-ca/about`, outputPath: "public/app/fr-ca/about/page.tsx", hreflangEligible: true, alternates },
    ] });
    expect(content.buildSitemapAlternates(plan)).toEqual(plan.pages.map(page => ({ url: page.url, alternates: page.alternates })));
    expect({ registry, options }).toEqual(before);
  });

  it("names an absent emitted target and omits it from every advertised set", () => {
    const { registry, options } = localeRoutesFixture();
    const slot = registry.slots[0]!, candidate = registry.candidates[0]!;
    const missing = { ...options, existingUrls: [`${localeRouteOrigin}/about`] };
    const plan = content.buildLocaleRoutePlan(slot, missing);
    expect(plan.ready).toBe(false);
    expect(content.checkPageMetadata(slot, candidate, undefined, missing)).toContainEqual(expect.objectContaining({ rule: "hreflang-target-missing", severity: "error" }));
    expect(plan.pages.find(page => page.locale === "fr-CA")?.hreflangEligible).toBe(false);
    expect(plan.pages.flatMap(page => page.alternates).every(alternate => alternate.href !== `${localeRouteOrigin}/fr-ca/about`)).toBe(true);
    expect(plan.ready).toBe(false);
    expect(content.buildSitemapAlternates(plan)).toEqual([]);
  });

  it("keeps a fallback page and its canonical while withholding translated-page claims", () => {
    const { registry, options } = localeRoutesFixture();
    const slot = registry.slots[0]!, candidate = registry.candidates[0]!;
    const fallback = { ...options, bodyServedLocales: { "en-US": ["en-US"], "fr-CA": ["en-US"] } };
    const plan = content.buildLocaleRoutePlan(slot, fallback);
    expect(plan.findings).toContainEqual(expect.objectContaining({ rule: "body-locale-fallback", severity: "warning" }));
    expect(plan.ready).toBe(true);
    expect(plan.pages.find(page => page.locale === "fr-CA")).toMatchObject({ path: "/fr-ca/about", canonical: `${localeRouteOrigin}/fr-ca/about`, outputPath: "public/app/fr-ca/about/page.tsx", hreflangEligible: false });
    expect(plan.pages.flatMap(page => page.alternates).every(alternate => alternate.hreflang !== "fr-CA")).toBe(true);
    expect(content.buildSitemapAlternates(plan).map(entry => entry.url)).toEqual([`${localeRouteOrigin}/about`]);
    expect(content.checkPageMetadata(slot, candidate, undefined, fallback)).toContainEqual(expect.objectContaining({ rule: "body-locale-fallback", severity: "warning" }));
  });

  it("requires native metadata even when an English fallback body is permitted", () => {
    const { registry, options } = localeRoutesFixture();
    const slot = registry.slots[0]!, candidate = registry.candidates[0]!;
    const missingTitle = { ...candidate, pageMeta: candidate.pageMeta!.filter(field => field.locale !== "fr-CA" || field.key !== "title") };
    const fallback = { ...options, bodyServedLocales: { "en-US": ["en-US"], "fr-CA": ["en-US"] } };
    expect(content.checkPageMetadata(slot, missingTitle, undefined, fallback)).toContainEqual(expect.objectContaining({ path: "content.pageMeta.fr-CA.title", rule: "required-page-metadata" }));
    expect(content.resolveCopy(missingTitle, "fr-CA").copy.$pageMeta).not.toHaveProperty("title");
  });

  it("preserves scalar canonical metadata and validates locale maps at the stored boundary", () => {
    const { registry } = localeRoutesFixture();
    const slot = registry.slots[0]!;
    expect(content.validateContentSlot({ ...slot, meta: { canonical: `${localeRouteOrigin}/about` } })).toEqual([]);
    expect(content.validateContentSlot(slot)).toEqual([]);
    for (const canonical of [
      { "en-us": `${localeRouteOrigin}/about` },
      { "fr-CA": "/fr-ca/about" },
      {},
    ]) {
      expect(content.validateContentSlot({ ...slot, meta: { canonical } }).length).toBeGreaterThan(0);
    }
  });

  it("round-trips locale canonical maps and origin through PB4 without changing revision bytes", async () => {
    const { registry, options } = localeRoutesFixture();
    const candidate = registry.candidates[0]!, slot = registry.slots[0]!;
    const digest = computeContentDigest(candidate);
    const parent = await fs.mkdtemp(join(tmpdir(), "publisher-locale-routes-")); roots.push(parent);
    const root = join(parent, "content", "publisher");
    const storeOptions = { designer: { root: "sample-library", catalog: {} } } as ContentStoreOptions;
    vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue(libraryFixture()[0]!);
    await writeContentStore(root, registry);
    const revisionPath = join(root, "_registry", "candidates", slot.id, candidate.id, "r1.json");
    const revisionBytes = await fs.readFile(revisionPath);
    const loaded = await loadContentStore(root, storeOptions);
    expect(loaded.registry).toEqual(registry);
    expect(loaded.registry.workspace.deployTargets[0]?.origin).toBe(localeRouteOrigin);
    expect(loaded.registry.slots[0]?.meta?.canonical).toEqual(slot.meta?.canonical);
    expect(loaded.registry.candidates[0]?.history).toEqual(candidate.history);
    expect(computeContentDigest(loaded.registry.candidates[0]!)).toBe(digest);
    expect(validateContentRevisionIntegrity(loaded.registry.candidates[0]!)).toEqual([]);
    expect(readConsumerLibrarySnapshot).toHaveBeenCalledWith(storeOptions.designer.root, storeOptions.designer.catalog);
    const changed = { ...loaded.registry, slots: [{ ...loaded.registry.slots[0]!, meta: { canonical: `${localeRouteOrigin}/about` } }] };
    await writeContentStore(root, changed);
    expect(await fs.readFile(revisionPath)).toEqual(revisionBytes);
    expect(computeContentDigest(changed.candidates[0]!)).toBe(digest);
    expect(content.buildLocaleRoutePlan(loaded.registry.slots[0]!, { ...options, workspace: loaded.registry.workspace }).ready).toBe(true);
    expect(content).not.toHaveProperty("writeContentStore");
    const report = content.computeStageReport(loaded.registry.candidates[0]!);
    expect(report).toMatchObject({ revision: "r1", digest, stages: { define: { status: "Done" }, assemble: { status: "Waiting" }, publish: { status: "Waiting" } } });
  });
});
