// foundry-build-0048 U17: every interior page type resolves a page header, and a hero-only home passes.
// The page header resolves when its Designer slot contract names at least one pinned trusted-registry
// reference, so the Designer loop has a seed to adopt and a candidate can be pinned. The fixtures in
// __fixtures__/u17-pages.json hold one page per interior page type and one hero-only home.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { designerPackageDir, loadDesignerCatalog, slotContract, type LayoutSlot, type PageSlot } from "../catalog/ia/tree.js";
import { checkPageOption, type LayoutContract, type PageOptionContent } from "./page-sections-instance.js";
import { checkPageRecords } from "../archetypes/conformance.js";
import type { PageRecord } from "../archetypes/record.js";

type Fixtures = { interior: Record<string, PageOptionContent>; home: Record<string, PageOptionContent> };
const fixtures = JSON.parse(readFileSync(new URL("./__fixtures__/u17-pages.json", import.meta.url), "utf8")) as Fixtures;
const designerDir = designerPackageDir();
const designer = loadDesignerCatalog(designerDir);
type Reference = { registry: string; item: string; version: string; hash?: string };
type Contract = { slot: string; references: Reference[] };
const contracts = JSON.parse(readFileSync(join(designerDir, "src/catalog/slot-contracts/sections.json"), "utf8")) as Contract[];
const manifest = JSON.parse(readFileSync(join(designerDir, "references/manifest.json"), "utf8")) as { items: { dir: string; hash: string }[] };

const check = (pageId: string, content: PageOptionContent) => {
  const page = slotContract(pageId) as PageSlot;
  const layout = slotContract(String(content.layout)) as LayoutSlot | undefined;
  return checkPageOption(pageId, content, page, layout as LayoutContract | undefined, designer);
};

/** The pinned references a placed Designer section resolves to; empty when its contract names none. */
function resolvedReferences(use: string): string[] {
  const contract = contracts.find(row => row.slot === use.replace(/^designer\//, ""));
  if (!contract) return [];
  return contract.references.flatMap(reference => {
    const dir = `${reference.registry}/${reference.item}@${reference.version}`;
    const row = manifest.items.find(item => item.dir === dir);
    const folder = join(designerDir, "references", dir);
    return row && row.hash === reference.hash && existsSync(folder) && statSync(folder).isDirectory() ? [dir] : [];
  });
}

const INTERIOR = ["page.about", "page.pricing", "page.contact", "page.terms", "page.privacy", "page.docs-index", "page.guide", "page.app-home"];

describe("interior pages resolve a page header (U17)", () => {
  it("has one fixture page per interior page type", () => {
    expect(Object.keys(fixtures.interior).sort()).toEqual([...INTERIOR].sort());
  });

  it.each(INTERIOR)("%s passes its layout and its page header resolves to a pinned reference", pageId => {
    const page = fixtures.interior[pageId]!;
    expect(check(pageId, page)).toEqual([]);
    const header = (page.sections as { role: string; use: string }[]).find(section => section.role === "header");
    expect(header?.use).toBe("designer/sections.page-header");
    expect(resolvedReferences(header!.use).length, `${pageId} page header`).toBeGreaterThan(0);
  });

  it("the page-header contract composes the section header and the breadcrumb", () => {
    expect(resolvedReferences("designer/sections.page-header")).toEqual(["tailark-oss/mist-features-1@8139698", "shadcn/breadcrumb@4.23.0"]);
  });
});

describe("a hero-only home passes (U17)", () => {
  const home = () => structuredClone(fixtures.home["page.home"]!);
  const record = (sections: string[]): PageRecord => ({
    id: "home", path: "/", archetype: "marketing-home", format: "vertical-page", frame: { id: "frames.site-shell" },
    meta: { title: "home.meta-title", description: "home.meta-description" }, nav: { pinned: false },
    sections: sections.map(section => ({ section, copy: { keys: { heading: `home.${section}.heading` } } })),
  });
  const errors = (sections: string[]) => checkPageRecords({ records: [record(sections)] }).findings.filter(row => row.severity === "error").map(row => row.code);

  it("passes layout.marketing-home with the hero alone", () => {
    expect(home().sections).toHaveLength(1);
    expect(check("page.home", home())).toEqual([]);
  });

  it("passes the marketing-home archetype with the hero alone", () => {
    expect(errors(["sections.hero"])).toEqual([]);
  });

  it("keeps every other home rule", () => {
    const noHero = { ...home(), sections: [{ role: "closing", use: "designer/sections.call-to-action", copy: "writer/sections.call-to-action.copy#home.closing" }] };
    expect(check("page.home", noHero).map(row => row.check)).toContain("page.required-roles");
    expect(errors(["sections.call-to-action"])).toContain("archetype-role-missing");
    expect(errors(["sections.features", "sections.hero"])).toContain("archetype-order");
    expect(errors(["sections.hero", "sections.data-table"])).toContain("archetype-extra-section");
    expect(errors(["sections.hero", "sections.features", "sections.features", "sections.features", "sections.features"])).toContain("archetype-role-count");
    const wrongKind = { ...home(), sections: [...home().sections, { role: "value", use: "designer/sections.steps", copy: "writer/sections.steps.copy#home.value" }] };
    expect(check("page.home", wrongKind).map(row => row.check)).toContain("page.role-allowed");
  });
});
