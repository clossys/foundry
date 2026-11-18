/**
 * The slides starter (foundry-build-0027): one deck of six slides on Designer's frames.deck, each slide one live twin
 * section on the `slide` medium (foundry-build-0036: the six sections.slide-* are retired into slide configs of hero,
 * table-of-contents, content, testimonials and call-to-action). Every frame and section resolves to a live Designer slot with a
 * package default; the page option holds Writer record refs only.
 */
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPageOption, type LayoutContract, type PageOptionContent } from "../../check/page-sections-instance.js";
import { DECK_FRAME, checkDeck } from "./deck.js";
import { designerPackageDir, loadDefaults, loadDesignerCatalog, loadStarter, slotContract, type LayoutSlot, type PageOption, type PageSlot } from "./tree.js";

const clone = <T>(value: T): T => structuredClone(value);
const designer = loadDesignerCatalog();
const defaults = loadDefaults();
const starter = loadStarter("slides");
const layout = slotContract("layout.deck") as LayoutSlot;
const deck = () => clone(defaults.get("page.deck/starter-v1.json")!.content as unknown as PageOption);
const ROLES = ["title", "agenda", "statement", "two-column", "quote", "closing"];
const TWINS = ["hero", "table-of-contents", "content", "content", "testimonials", "call-to-action"];
const RETIRED_SLIDES = ROLES.map(role => `sections.slide-${role}`);

describe("slides starter: one deck of six slides", () => {
  it("assembles title, agenda, statement, two-column, quote and closing on frames.deck, no chrome", () => {
    expect(starter).toMatchObject({ id: "slides", node: "directory/decks/slides", root: "/slides", pages: ["page.deck"], layouts: ["layout.deck"], chrome: [], release: "release.slides", decks: ["starter"] });
    expect(layout).toMatchObject({ frame: DECK_FRAME, chrome: [] });
    expect(Object.keys(layout.roles!)).toEqual(ROLES);
    const page = deck();
    expect(page.sections.map(section => section.role)).toEqual(ROLES);
    expect(page.sections.map(section => section.use)).toEqual(TWINS.map(twin => `designer/sections.${twin}`));
    expect(page.sections.map(section => section.copy)).toEqual(ROLES.map((role, index) => `writer/sections.${TWINS[index]}.copy#deck.${role}`));
    expect(page.sections.map(section => section.variant)).toEqual([
      { medium: "slide" }, { medium: "slide" }, { medium: "slide", layout: "stacked" }, { medium: "slide", layout: "split-start" },
      { medium: "slide", layout: "single" }, { medium: "slide" },
    ]);
    expect(Object.values(layout.roles!).map(role => role.kinds)).toEqual(TWINS.map(twin => [`designer/sections.${twin}`]));
    expect((slotContract("page.deck") as PageSlot).path).toBe("/slides/<deck>/<n>");
  });

  it("every starter slide resolves its frame and section to a Designer slot with a default", () => {
    for (const id of [DECK_FRAME, ...deck().sections.map(section => section.use)].map(ref => ref.replace(/^designer\//, ""))) {
      expect(designer.live.has(id), id).toBe(true);
      expect(designer.withDefault.has(id), id).toBe(true);
    }
    expect(checkDeck("page.deck", deck(), layout, designer)).toEqual([]);
  });

  it("the six sections.slide-* are retired in the Designer catalog; their twins declare the slide medium", () => {
    for (const id of RETIRED_SLIDES) {
      expect(designer.retired.has(id), id).toBe(true);
      expect(designer.live.has(id), id).toBe(false);
    }
    for (const twin of new Set(TWINS)) expect(designer.slideMedium?.has(`sections.${twin}`), twin).toBe(true);
    const placed = [...JSON.stringify(layout).matchAll(/sections\.slide-[a-z-]+/g), ...JSON.stringify(deck()).matchAll(/sections\.slide-[a-z-]+/g)];
    expect(placed).toEqual([]);
  });

  it("reads Designer package defaults from src/catalog/defaults, the folder the package ships, never a top-level defaults/", () => {
    const real = designerPackageDir();
    const dir = mkdtempSync(join(tmpdir(), "publisher-designer-pkg-"));
    mkdirSync(join(dir, "src", "catalog", "defaults", "frames.deck"), { recursive: true });
    symlinkSync(join(real, "src", "catalog", "ia"), join(dir, "src", "catalog", "ia"));
    copyFileSync(join(real, "src", "catalog", "retired.json"), join(dir, "src", "catalog", "retired.json"));
    writeFileSync(join(dir, "src", "catalog", "defaults", "frames.deck", "canvas-v1.json"), "{}");
    mkdirSync(join(dir, "defaults", "sections.testimonials"), { recursive: true });
    writeFileSync(join(dir, "defaults", "sections.testimonials", "standard-v1.json"), "{}");
    const shipped = loadDesignerCatalog(dir);
    expect(shipped.withDefault.has("frames.deck")).toBe(true);
    expect(shipped.withDefault.has("sections.testimonials")).toBe(false);
  });

  it("the deck page passes every page option check", () => {
    expect(checkPageOption("page.deck", deck() as unknown as PageOptionContent, slotContract("page.deck") as PageSlot, layout as LayoutContract, designer)).toEqual([]);
  });

  it("release.slides is live: static HTML per slide plus print CSS, owner sign-off; Documents and Video stay parked", () => {
    expect(slotContract("release.slides")).toMatchObject({ kind: "release", publication: "slides", exports: [{ kind: "static-html", per: "slide" }, { kind: "print-css" }], signoff: { by: "owner" } });
    expect(slotContract("release.company-one-pager")).toMatchObject({ parked: true });
  });

  it("mutation: a slide naming a section with no default fails", () => {
    const without = { ...designer, withDefault: new Set([...designer.withDefault].filter(id => id !== "sections.testimonials")) };
    expect(checkDeck("page.deck", deck(), layout, without)).toEqual(["page.deck: quote places designer/sections.testimonials, which has no Designer package default"]);
  });

  it("mutation: a slide naming a retired sections.slide-* fails", () => {
    const page = deck();
    const retiredQuote = RETIRED_SLIDES[ROLES.indexOf("quote")]!;
    expect(designer.retired.has(retiredQuote)).toBe(true);
    page.sections[4]!.use = `designer/${retiredQuote}`;
    expect(checkDeck("page.deck", page, layout, designer)).toEqual([`page.deck: quote places designer/${retiredQuote}, which the Designer catalog does not have`]);
    expect(checkPageOption("page.deck", page as unknown as PageOptionContent, slotContract("page.deck") as PageSlot, layout as LayoutContract, designer).map(finding => finding.message))
      .toContain(`page.deck: quote places retired designer/${retiredQuote}`);
  });

  it("mutation: a twin whose Designer contract lacks the slide medium fails", () => {
    const without = { ...designer, slideMedium: new Set([...designer.slideMedium!].filter(id => id !== "sections.hero")) };
    expect(checkDeck("page.deck", deck(), layout, without)).toEqual(["page.deck: title places designer/sections.hero, whose Designer contract does not declare the slide medium"]);
  });

  it("mutation: a slide naming a section the Designer catalog does not have fails", () => {
    const page = deck();
    page.sections[4]!.use = "designer/sections.slide-poll";
    expect(checkDeck("page.deck", page, layout, designer)).toEqual(["page.deck: quote places designer/sections.slide-poll, which the Designer catalog does not have"]);
  });

  it("mutation: a deck frame with no default fails", () => {
    const without = { ...designer, withDefault: new Set([...designer.withDefault].filter(id => id !== "frames.deck")) };
    expect(checkDeck("page.deck", deck(), layout, without)).toEqual(["page.deck: frame designer/frames.deck has no Designer package default"]);
  });

  it("mutation: a slide on the web medium fails", () => {
    const page = deck();
    page.sections[0]!.variant = { medium: "web" };
    expect(checkDeck("page.deck", page, layout, designer)).toEqual(["page.deck: title must render on the slide medium (variant.medium slide)"]);
  });

  it("mutation: literal copy in a slide record fails", () => {
    const page = deck() as unknown as { sections: Record<string, unknown>[] };
    page.sections[2]!.copy = "Our one big idea";
    page.sections[0]!.heading = "Welcome";
    const findings = checkPageOption("page.deck", page as PageOptionContent, slotContract("page.deck") as PageSlot, layout as LayoutContract, designer);
    expect(findings.filter(finding => finding.check === "page.no-inline-copy").map(finding => finding.message)).toEqual([
      "page.deck: sections[0].heading: not a section field; words come from the Writer record",
      "page.deck: sections[2].copy: must be a Writer record ref writer/<slot>#<record>, never text",
    ]);
  });
});
