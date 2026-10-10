import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument } from "../core/sectioned-view.js";
import type { ResolvedSectionedViewContentSection, ResolvedSectionedViewSpecimenPanel, ResolvedSectionedViewSpecimenPart, SectionedViewContentSection } from "../core/sectioned-view.js";
import { CONTENT_CATALOG_CALL_TO_ACTION, CONTENT_CATALOG_CAPTIONS, contentCatalogCopyResolver, contentCatalogDocument } from "./fixture-content-catalog.js";
import { buildContentCatalogHtml, renderContentCatalog, renderContentCatalogMarkup, splitLandingViewBands } from "./render-content-catalog.js";

const contentSections = contentCatalogDocument.sections.filter((section): section is SectionedViewContentSection => section.kind === "content-section");
const resolved = resolveSectionedViewDocument(contentCatalogDocument, contentCatalogCopyResolver);
const resolvedContent = resolved.sections.filter((section): section is ResolvedSectionedViewContentSection => section.kind === "content-section");

const words = (text: string | undefined): number => (text === undefined ? 0 : text.trim().split(/\s+/).length);

describe("content catalog fixture", () => {
  it("is a valid SectionedViewDocument whose copy all resolves", () => {
    expect(validateSectionedViewDocument(contentCatalogDocument)).toEqual([]);
    expect(resolved.sections).toHaveLength(contentCatalogDocument.sections.length);
  });

  it("shows every block, treatment, column count, arrangement, layout and ground", () => {
    const blocks = new Set(contentSections.map((section) => section.block?.type ?? (section.media === undefined ? "intro" : "specimen")));
    expect([...blocks].sort()).toEqual(["card-grid", "comparison", "faq", "feature-grid", "intro", "ordered-step-sequence", "specimen", "topic-list"]);

    const features = contentSections.flatMap((section) => (section.block?.type === "feature-grid" ? [section.block] : []));
    expect(new Set(features.map((block) => block.treatment ?? "plain"))).toEqual(new Set(["plain", "rule", "plate"]));
    expect(new Set(features.map((block) => block.columns ?? 3))).toEqual(new Set([2, 3, 4]));
    expect(features.some((block) => block.emphasis === "statement")).toBe(true);
    expect(features.some((block) => block.items.some((item) => item.icon !== undefined))).toBe(true);

    const topics = contentSections.flatMap((section) => (section.block?.type === "topic-list" ? [section.block] : []));
    expect(new Set(topics.map((block) => block.columns ?? 2))).toEqual(new Set([1, 2]));

    const stacked = contentSections.filter((section) => (section.layout ?? "stacked") === "stacked" && section.block === undefined && section.media !== undefined);
    expect(new Set(stacked.map((section) => section.media?.arrangement ?? "single"))).toEqual(new Set(["single", "row", "stack", "flow"]));
    expect(stacked.find((section) => section.media?.arrangement === "row")?.media?.panels).toHaveLength(3);

    const splits = contentSections.filter((section) => section.layout === "split");
    expect(new Set(splits.filter((section) => section.media !== undefined).map((section) => section.mediaSide ?? "end"))).toEqual(new Set(["end", "start"]));
    expect(splits.some((section) => section.block?.type === "faq" && section.media === undefined)).toBe(true);
    expect(splits.some((section) => (section.block?.type === "feature-grid" || section.block?.type === "topic-list") && section.media === undefined)).toBe(true);
    expect(features.some((block) => block.items.some((item) => item.eyebrow !== undefined))).toBe(true);

    const cardRows = contentSections.flatMap((section) => (section.block?.type === "card-grid" ? [section.block.items.map((card) => card.span)] : []));
    const spans = cardRows.flat();
    expect(new Set(spans)).toEqual(new Set(["third", "half", "two-thirds", "full"]));
    const joined = cardRows.map((row) => row.join(" ")).join(" | ");
    expect(joined).toContain("two-thirds third");
    expect(joined).toContain("third two-thirds");
    expect(contentSections.some((section) => section.block?.type === "card-grid" && section.block.items.some((card) => card.visual !== undefined))).toBe(true);

    const comparisons = contentSections.flatMap((section) => (section.block?.type === "comparison" ? [section.block] : []));
    expect(comparisons.some((block) => block.before.visual !== undefined && block.after.visual !== undefined)).toBe(true);
    expect(comparisons.some((block) => block.before.points !== undefined && block.before.visual === undefined)).toBe(true);

    const steps = contentSections.flatMap((section) => (section.block?.type === "ordered-step-sequence" ? [section.block] : []));
    expect(steps.some((block) => block.items.every((step) => step.visual !== undefined && step.label !== undefined))).toBe(true);

    const grounds = new Set(contentCatalogDocument.sections.map((section) => section.ground));
    expect(grounds).toEqual(new Set(["base", "sunken", "inverse"]));
  });

  it("keeps actions where they belong: header-only bands and split text columns, never a stacked band with a block or media, and nothing after them", () => {
    for (const section of contentSections) {
      if (section.actions === undefined) continue;
      const split = section.layout === "split";
      const headerOnly = section.block === undefined && section.media === undefined;
      expect(split || headerOnly, section.id).toBe(true);
      if (!split) expect(section.footnote, section.id).toBeUndefined();
    }
    const byId = (id: string) => contentSections.find((section) => section.id === id);
    expect(byId("catalog-intro")?.actions).toHaveLength(2);
    expect(byId("catalog-intro")?.footnote).toBeUndefined();
    expect(byId("catalog-features-statement")?.actions).toBeUndefined();
    expect(byId("catalog-features-statement")?.footnote?.link).toBeDefined();
  });

  it("shows linked plates, a linked topic list and a linked bento, each item its own destination", () => {
    const hrefs = (id: string) => {
      const block = contentSections.find((section) => section.id === id)?.block;
      if (block === undefined || block.type === "comparison" || block.type === "faq") throw new Error(`${id} has no linkable block`);
      return block.items.map((item) => ("href" in item ? item.href : undefined));
    };
    for (const id of ["catalog-features-plate", "catalog-topics-linked", "catalog-cards-visual"]) {
      const links = hrefs(id);
      expect(links.every((href) => typeof href === "string" && href.startsWith("/")), id).toBe(true);
      expect(new Set(links).size, id).toBe(links.length);
    }
    expect(hrefs("catalog-topics-linked")).toHaveLength(4);
    // The other bento and every other block stay unlinked.
    expect(hrefs("catalog-cards-text").every((href) => href === undefined)).toBe(true);
    expect(hrefs("catalog-topics-two").every((href) => href === undefined)).toBe(true);

    const dom = new JSDOM(buildContentCatalogHtml()).window.document;
    for (const id of ["catalog-features-plate", "catalog-topics-linked", "catalog-cards-visual"]) {
      const band = dom.getElementById(id);
      const links = [...(band?.querySelectorAll("a[data-card-link]") ?? [])];
      expect(links.length, id).toBe(hrefs(id).length);
      expect(band?.querySelectorAll("[data-section-intro-actions]"), id).toHaveLength(0);
      for (const link of links) {
        expect(link.querySelector('svg[aria-hidden="true"]'), id).not.toBeNull();
        expect(link.closest(".isolate"), id).not.toBeNull();
      }
    }
    expect(dom.querySelectorAll("a[data-card-link]")).toHaveLength(10);
  });

  it("only breaks the page-variety rules a catalog must (two card bands, two comparisons, repeated block treatments, the linked topic list beside its unlinked sibling)", () => {
    const findings = checkSectionVariety(contentCatalogDocument);
    for (const finding of findings) {
      expect(["sectioned-view-variety-card-bands", "sectioned-view-variety-comparison-count", "sectioned-view-variety-treatment", "sectioned-view-variety-repeat"]).toContain(finding.rule);
    }
    // The one repeat is the linked variant (13b) shown right after the unlinked topic list it varies.
    const linkedAt = contentCatalogDocument.sections.findIndex((section) => section.id === "catalog-topics-linked");
    expect(findings.filter((finding) => finding.rule === "sectioned-view-variety-repeat").map((finding) => finding.path)).toEqual([`sections.${linkedAt}`]);
  });

  it("keeps every band's copy within the content cookbook's budgets", () => {
    const hero = resolved.sections[0];
    if (hero?.kind !== "hero") throw new Error("catalog must open with a hero");
    expect(words(hero.heading)).toBeLessThanOrEqual(10);
    expect(words(hero.description)).toBeLessThanOrEqual(35);
    for (const action of hero.actions ?? []) expect(words(action.label)).toBeLessThanOrEqual(3);

    const panelChecks = (panel: ResolvedSectionedViewSpecimenPanel) => {
      expect(panel.title.length, panel.title).toBeLessThanOrEqual(40);
      expect((panel.meta ?? "").length, panel.meta).toBeLessThanOrEqual(50);
      panel.parts.forEach(partChecks);
    };
    const partChecks = (part: ResolvedSectionedViewSpecimenPart) => {
      if (part.type === "fields") {
        for (const field of part.items) {
          expect(words(field.label), field.label).toBeLessThanOrEqual(3);
          expect(field.value.length, field.value).toBeLessThanOrEqual(16);
        }
      }
    };

    for (const section of resolvedContent) {
      const at = section.id;
      const split = section.layout === "split";
      expect(words(section.eyebrow), `${at} eyebrow`).toBeLessThanOrEqual(5);
      expect((section.eyebrow ?? "").length, `${at} eyebrow`).toBeLessThanOrEqual(32);
      expect(words(section.heading), `${at} heading`).toBeLessThanOrEqual(split ? 8 : 10);
      const intro = section.block === undefined && section.media === undefined;
      expect(words(section.description), `${at} description`).toBeLessThanOrEqual(intro ? 40 : 30);
      for (const action of section.actions ?? []) expect(words(action.label), `${at} action`).toBeLessThanOrEqual(3);

      if (section.media !== undefined) {
        expect(words(section.media.label), `${at} specimen label`).toBeGreaterThanOrEqual(12);
        expect(words(section.media.label), `${at} specimen label`).toBeLessThanOrEqual(25);
        section.media.panels.forEach(panelChecks);
      }
      const block = section.block;
      if (block === undefined) continue;
      switch (block.type) {
        case "feature-grid": {
          const statement = block.emphasis === "statement";
          const limit = statement ? 12 : block.treatment === "plate" && block.columns === 2 ? 25 : 20;
          for (const item of block.items) {
            expect(words(item.eyebrow), `${at} ${item.id} eyebrow`).toBeLessThanOrEqual(3);
            expect((item.eyebrow ?? "").length, `${at} ${item.id} eyebrow`).toBeLessThanOrEqual(32);
            expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(statement ? 3 : 5);
            expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(limit);
          }
          break;
        }
        case "card-grid":
          for (const card of block.items) {
            expect(words(card.heading), `${at} ${card.id}`).toBeLessThanOrEqual(5);
            expect(words(card.description), `${at} ${card.id}`).toBeGreaterThanOrEqual(8);
            expect(words(card.description), `${at} ${card.id}`).toBeLessThanOrEqual(card.span === "two-thirds" || card.span === "full" ? 25 : 20);
            if (card.visual !== undefined) partChecks(card.visual);
          }
          break;
        case "comparison":
          for (const side of [block.before, block.after]) {
            expect(words(side.label), `${at} label`).toBeLessThanOrEqual(3);
            expect(words(side.description), `${at} description`).toBeLessThanOrEqual(25);
            for (const point of side.points ?? []) {
              expect(words(point), point).toBeGreaterThanOrEqual(4);
              expect(words(point), point).toBeLessThanOrEqual(9);
            }
            if (side.visual !== undefined) panelChecks(side.visual);
          }
          break;
        case "topic-list":
          for (const item of block.items) {
            expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(5);
            expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(12);
          }
          break;
        case "ordered-step-sequence":
          for (const step of block.items) {
            expect(words(step.heading), `${at} ${step.id}`).toBeLessThanOrEqual(2);
            expect(words(step.label), `${at} ${step.id}`).toBeLessThanOrEqual(2);
            expect(words(step.description), `${at} ${step.id}`).toBeGreaterThanOrEqual(6);
            expect(words(step.description), `${at} ${step.id}`).toBeLessThanOrEqual(14);
            if (step.visual !== undefined) panelChecks(step.visual);
          }
          break;
        case "faq":
          for (const item of block.items) {
            expect(words(item.question), `${at} ${item.id}`).toBeLessThanOrEqual(12);
            expect(words(item.answer), `${at} ${item.id}`).toBeGreaterThanOrEqual(15);
            expect(words(item.answer), `${at} ${item.id}`).toBeLessThanOrEqual(45);
          }
          break;
      }
    }

    const cta = CONTENT_CATALOG_CALL_TO_ACTION;
    expect(words(cta.heading)).toBeLessThanOrEqual(8);
    expect(words(cta.description)).toBeLessThanOrEqual(15);
    expect(words(cta.actionLabel)).toBeLessThanOrEqual(3);
  });
});

describe("content catalog page", () => {
  it("renders one LandingView band per caption, in caption order", () => {
    const render = renderContentCatalog();
    expect(render.bands.map((band) => band.caption.sectionId)).toEqual(CONTENT_CATALOG_CAPTIONS.map((caption) => caption.sectionId));
    expect(CONTENT_CATALOG_CAPTIONS).toHaveLength(contentCatalogDocument.sections.length + 1);
    expect(render.bands.at(-1)?.markup).toContain('data-landing-call-to-action=""');
  });

  it("is LandingView's markup unchanged, with chrome captions only between its bands", () => {
    const html = buildContentCatalogHtml();
    const markup = renderContentCatalogMarkup();
    const start = html.indexOf("<main");
    const end = html.lastIndexOf("</main>") + "</main>".length;
    const page = html.slice(start, end).replace(/<div class="catalog-caption"[^]*?<\/div>\n/g, "").replaceAll("\n", "");
    expect(page).toBe(markup);

    const { bands } = splitLandingViewBands(markup);
    for (const band of bands) expect(band).not.toContain("data-catalog-chrome");
  });

  it("captions every band in the chrome, outside the product markup", () => {
    const dom = new JSDOM(buildContentCatalogHtml()).window.document;
    const main = dom.querySelector("main[data-landing-view]");
    expect(main).not.toBeNull();
    const children = [...(main?.children ?? [])];
    const captions = children.filter((child) => child.hasAttribute("data-catalog-chrome"));
    const bands = children.filter((child) => child.tagName === "SECTION");
    expect(captions).toHaveLength(CONTENT_CATALOG_CAPTIONS.length);
    expect(bands).toHaveLength(CONTENT_CATALOG_CAPTIONS.length);
    children.forEach((child, index) => expect(child.hasAttribute("data-catalog-chrome")).toBe(index % 2 === 0));
    expect(captions.map((caption) => caption.getAttribute("data-catalog-budget"))).toEqual(CONTENT_CATALOG_CAPTIONS.map((caption) => caption.budget));
    expect(new Set(captions.map((caption) => caption.getAttribute("data-catalog-budget")))).toEqual(new Set(["typical", "max"]));
    expect(dom.querySelectorAll("h1")).toHaveLength(2);
    expect(main?.querySelectorAll("h1")).toHaveLength(1);
    expect(dom.querySelectorAll("figure[data-specimen] a, figure[data-specimen] button")).toHaveLength(0);
  });

  it("links Designer's tokens, the preview utility stylesheet, then the brand stylesheet when given", () => {
    const defaults = [...buildContentCatalogHtml().matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
    expect(defaults).toEqual(["designer-tokens.css", "publisher-preview.css", "brand.css"]);

    const withBrand = buildContentCatalogHtml({ designerTokens: "t.css", utilities: "c.css", brand: "../brand/brand.css" });
    const hrefs = [...withBrand.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["t.css", "c.css", "../brand/brand.css"]);
    expect(withBrand).toContain('<html lang="en" data-brand-bound>');

    const withoutBrand = buildContentCatalogHtml({ designerTokens: "t.css", utilities: "c.css", brand: null });
    expect([...withoutBrand.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1])).toEqual(["t.css", "c.css"]);
  });

  it("is byte-identical across renders", () => {
    expect(buildContentCatalogHtml()).toBe(buildContentCatalogHtml());
  });
});

describe("splitLandingViewBands", () => {
  it("splits nested sections at the root only", () => {
    const split = splitLandingViewBands('<main data-x=""><section a><section b>x</section></section><section c>y</section></main>');
    expect(split.bands).toEqual(["<section a><section b>x</section></section>", "<section c>y</section>"]);
    expect(split.rootOpen).toBe('<main data-x="">');
  });

  it("refuses content outside the bands and unbalanced markup", () => {
    expect(() => splitLandingViewBands("<main><div>x</div><section>y</section></main>")).toThrow(/outside its bands/);
    expect(() => splitLandingViewBands("<main><section>y</main>")).toThrow(/ends inside a band/);
    expect(() => splitLandingViewBands("<div><section>y</section></div>")).toThrow(/one <main> root/);
  });
});
