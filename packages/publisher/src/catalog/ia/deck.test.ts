/**
 * The slides starter (foundry-build-0027): one deck of six slides on Designer's frames.deck, each slide one
 * sections.slide-* section on the `slide` medium. Every frame and section resolves to a live Designer slot with a
 * package default; the page option holds Writer record refs only.
 */
import { describe, expect, it } from "vitest";
import { checkPageOption, type LayoutContract, type PageOptionContent } from "../../check/page-sections-instance.js";
import { DECK_FRAME, checkDeck } from "./deck.js";
import { loadDefaults, loadDesignerCatalog, loadStarter, slotContract, type LayoutSlot, type PageOption, type PageSlot } from "./tree.js";

const clone = <T>(value: T): T => structuredClone(value);
const designer = loadDesignerCatalog();
const defaults = loadDefaults();
const starter = loadStarter("slides");
const layout = slotContract("layout.deck") as LayoutSlot;
const deck = () => clone(defaults.get("page.deck/starter-v1.json")!.content as unknown as PageOption);
const ROLES = ["title", "agenda", "statement", "two-column", "quote", "closing"];

describe("slides starter: one deck of six slides", () => {
  it("assembles title, agenda, statement, two-column, quote and closing on frames.deck, no chrome", () => {
    expect(starter).toMatchObject({ id: "slides", node: "directory/decks/slides", root: "/slides", pages: ["page.deck"], layouts: ["layout.deck"], chrome: [], release: "release.slides", decks: ["starter"] });
    expect(layout).toMatchObject({ frame: DECK_FRAME, chrome: [] });
    expect(Object.keys(layout.roles!)).toEqual(ROLES);
    const page = deck();
    expect(page.sections.map(section => section.role)).toEqual(ROLES);
    expect(page.sections.map(section => section.use)).toEqual(ROLES.map(role => `designer/sections.slide-${role}`));
    expect(page.sections.map(section => section.copy)).toEqual(ROLES.map(role => `writer/sections.slide-${role}.copy#deck.${role}`));
    expect((slotContract("page.deck") as PageSlot).path).toBe("/slides/<deck>/<n>");
  });

  it("every starter slide resolves its frame and section to a Designer slot with a default", () => {
    for (const id of [DECK_FRAME, ...deck().sections.map(section => section.use)].map(ref => ref.replace(/^designer\//, ""))) {
      expect(designer.live.has(id), id).toBe(true);
      expect(designer.withDefault.has(id), id).toBe(true);
    }
    expect(checkDeck("page.deck", deck(), layout, designer)).toEqual([]);
  });

  it("the deck page passes every page option check", () => {
    expect(checkPageOption("page.deck", deck() as unknown as PageOptionContent, slotContract("page.deck") as PageSlot, layout as LayoutContract, designer)).toEqual([]);
  });

  it("release.slides is live: static HTML per slide plus print CSS, owner sign-off; Documents and Video stay parked", () => {
    expect(slotContract("release.slides")).toMatchObject({ kind: "release", publication: "slides", exports: [{ kind: "static-html", per: "slide" }, { kind: "print-css" }], signoff: { by: "owner" } });
    expect(slotContract("release.company-one-pager")).toMatchObject({ parked: true });
  });

  it("mutation: a slide naming a section with no default fails", () => {
    const without = { ...designer, withDefault: new Set([...designer.withDefault].filter(id => id !== "sections.slide-quote")) };
    expect(checkDeck("page.deck", deck(), layout, without)).toEqual(["page.deck: quote places designer/sections.slide-quote, which has no Designer package default"]);
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
