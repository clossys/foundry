import { planContentGrounds } from "../core/content-ground.js";
import "@testing-library/jest-dom/vitest";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingView } from "../web/views/LandingView.server.js";
import { SectionedView } from "../web/views/SectionedView.server.js";
import { previewSectionedDocument, previewCopyResolver } from "./fixture-documents.js";
import { renderPreviewGalleryEntries } from "./render-preview-gallery.js";
import { buttonLinkClassName } from "@clossys/designer/components/server";
import { describe, expect, it } from "vitest";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument } from "../core/sectioned-view.js";
import type { ResolvedSectionedViewContentSection, ResolvedSectionedViewSpecimenPanel, ResolvedSectionedViewSpecimenPart, SectionedViewContentSection } from "../core/sectioned-view.js";
import { CONTENT_CATALOG_CALL_TO_ACTION, CONTENT_CATALOG_CAPTIONS, contentCatalogCopyResolver, contentCatalogDocument } from "./fixture-content-catalog.js";
import { buildHistoricalContentCatalogHtml as buildContentCatalogHtml, renderContentCatalog, renderContentCatalogMarkup, splitLandingViewBands } from "./render-content-catalog.js";

const contentSections = contentCatalogDocument.sections.filter((section): section is SectionedViewContentSection => section.kind === "content-section");
const resolved = resolveSectionedViewDocument(contentCatalogDocument, contentCatalogCopyResolver);
const resolvedContent = resolved.sections.filter((section): section is ResolvedSectionedViewContentSection => section.kind === "content-section");

const words = (text: string | undefined): number => (text === undefined ? 0 : text.trim().split(/\s+/).length);

describe("content catalog fixture", () => {
  it("is a valid SectionedViewDocument whose copy all resolves", () => {
    expect(validateSectionedViewDocument(contentCatalogDocument)).toEqual([{ rule: "steps-count", severity: "warning", path: "sections.19.block.items", message: "A connected sequence reads more clearly with three or five items." }]);
    expect(resolved.sections).toHaveLength(contentCatalogDocument.sections.length);
  });

  it("shows balanced grouped fixtures with exact IDs, group layouts and catalog counts", () => {
    expect(contentCatalogDocument.sections).toHaveLength(26);
    expect(CONTENT_CATALOG_CAPTIONS).toHaveLength(27);
    const grouped = resolvedContent.filter((section) => section.block?.type === "items" && section.block.groups !== undefined);
    expect(grouped.map((section) => section.id)).toEqual(["catalog-topics-groups-4", "catalog-topics-groups-3"]);
    for (const section of grouped) {
      if (section.block?.type !== "items" || section.block.groups === undefined) throw new Error("Expected groups");
      expect(section.block.groups.map((group) => group.items.length)).toEqual(section.id.endsWith("4") ? [2, 2, 2, 2] : [2, 2, 2]);
      expect(new Set(section.block.groups.flatMap((group) => group.items)).size).toBe(section.id.endsWith("4") ? 8 : 6);
    }
    const dom = new JSDOM(renderContentCatalogMarkup()).window.document;
    expect(dom.querySelector("#catalog-topics-groups-4 [data-items]")?.getAttribute("data-columns")).toBe("2");
    expect(dom.querySelectorAll("#catalog-topics-groups-3 [role=group][aria-labelledby]")).toHaveLength(3);
    expect(dom.querySelectorAll("#catalog-topics-groups-4 h3")).toHaveLength(8);
    expect(dom.querySelector("#catalog-topics-groups-4 [data-content-section-footnote] a")?.getAttribute("href")).toBe("mailto:help@example.com");
  });

  it("shows canonical blocks, axes, specimens, spans and both Matrix forms", () => {
    const items = resolvedContent.flatMap(section => section.block?.type === "items" ? [section.block] : []);
    expect(new Set(items.map(block => block.arrangement))).toEqual(new Set(["columns", "rows", "bento", "stacked"]));
    expect(new Set(items.map(block => block.treatment))).toEqual(new Set(["plain", "rule", "plate"]));
    expect(new Set(items.filter(block => block.arrangement === "columns").map(block => block.columns))).toEqual(new Set([2,3]));
    expect(items.some(block => block.scale === "statement")).toBe(true);
    expect(items.some(block => block.items.some(item => item.icon !== undefined))).toBe(true);
    expect(items.some(block => block.items.some(item => item.eyebrow !== undefined))).toBe(true);
    expect(items.some(block => block.order === "connected")).toBe(true);
    expect(items.some(block => block.reveal === "disclose")).toBe(true);
    const media = contentSections.flatMap(section => section.media?.type === "specimen" ? [section.media] : []);
    expect(media).toHaveLength(6); expect(media.every(media => media.panel.parts.length >= 1 && media.panel.parts.length <= 3)).toBe(true);
    const splits = contentSections.filter(section => section.layout !== undefined && section.layout !== "stacked");
    expect(new Set(splits.filter(section => section.media !== undefined).map(section => section.layout))).toEqual(new Set(["split-end", "split-start"]));
    const cards = items.filter(block => block.arrangement === "bento"); expect(cards).toHaveLength(2);
    expect(new Set(cards.flatMap(block => block.items.map(item => item.span)))).toEqual(new Set(["third", "half", "two-thirds", "full"]));
    expect(cards.map(block => block.items.map(item => item.span).join(" ")).join(" | ")).toContain("two-thirds third");
    expect(cards.map(block => block.items.map(item => item.span).join(" ")).join(" | ")).toContain("third two-thirds");
    const matrices = contentSections.flatMap(section => section.block?.type === "matrix" ? [section.block] : []);expect(matrices).toHaveLength(2);
    expect(matrices.some(block => block.sides.every(side => side.visual !== undefined))).toBe(true);
    expect(matrices.some(block => block.sides.every(side => side.points?.length === 4 && side.visual === undefined))).toBe(true);
    const planned = planContentGrounds([resolved], { callToAction: true });
    expect(new Set(planned.bands.map(band => band.ground))).toEqual(new Set(["base", "sunken", "inverse"]));
    const rendered = new JSDOM(renderContentCatalogMarkup()).window.document;
    expect(new Set([...rendered.querySelectorAll("[data-landing-ground]")].map(band => band.getAttribute("data-landing-ground")))).toEqual(new Set(["base", "sunken", "inverse"]));
  });

  it("keeps actions where they belong: header-only bands and split text columns, never a stacked band with a block or media, and nothing after them", () => {
    for (const section of contentSections) {
      if (section.actions === undefined) continue;
      const split = section.layout === "split-start" || section.layout === "split-end";
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

  it("retains the highlighted after side on both matrices", () => {
    const matrices = resolvedContent.filter(section => section.block?.type === "matrix");
    expect(matrices).toHaveLength(2);
    const root = new JSDOM(renderContentCatalogMarkup()).window.document;
    for (const section of matrices) {
      expect(section.block?.type === "matrix" && section.block.featured).toBe("after");
      const sides = root.querySelectorAll(`#${section.id} [data-matrix-side]`);expect(sides).toHaveLength(2);expect(sides[1]!.querySelector("[data-featured]")?.getAttribute("data-featured")).toBe("true");
      expect(sides[0]!.querySelector("[data-featured]")).toBeNull();
    }
  });

  it("shows linked plates, a linked topic list and a linked bento, each item its own destination", () => {
    const hrefs = (id: string) => {
      const block = contentSections.find((section) => section.id === id)?.block;
      if (block?.type !== "items") throw new Error(`${id} has no linkable block`);
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
      const links = [...(band?.querySelectorAll("[data-item-heading] > a[href]") ?? [])];
      expect(links.length, id).toBe(hrefs(id).length);
      expect(band?.querySelectorAll("[data-section-intro-actions]"), id).toHaveLength(0);
      for (const link of links) {
        expect(link.querySelector('svg[aria-hidden="true"]'), id).not.toBeNull();
        expect(link.closest(".isolate"), id).not.toBeNull();
      }
    }
    expect(dom.querySelectorAll("[data-item-heading] > a[href]")).toHaveLength(10);
  });

  it("only breaks the page-variety rules a catalog must (two card bands, two comparisons, repeated block treatments, the linked topic list beside its unlinked sibling)", () => {
    const findings = checkSectionVariety(contentCatalogDocument);
    for (const finding of findings) {
      expect(["sectioned-view-variety-card-bands", "sectioned-view-variety-comparison-count", "sectioned-view-variety-treatment", "sectioned-view-variety-repeat"]).toContain(finding.rule);
    }
    // Adjacent variants deliberately repeat: linked/grouped topics and the visual/plain lane pair.
    const linkedAt = contentCatalogDocument.sections.findIndex((section) => section.id === "catalog-topics-linked");
    expect(findings.filter((finding) => finding.rule === "sectioned-view-variety-repeat").map((finding) => finding.path)).toEqual([`sections.${linkedAt}`, ...["catalog-topics-groups-4", "catalog-topics-groups-3", "catalog-steps-lanes-plain"].map((id) => `sections.${contentCatalogDocument.sections.findIndex((section) => section.id === id)}`)]);
  });

  it("shows the two lane tracks with exact actor joins and terminal semantics", () => {
    const dom = new JSDOM(renderContentCatalogMarkup()).window.document;
    const visual = dom.getElementById("catalog-steps-lanes-visual")!;
    const plain = dom.getElementById("catalog-steps-lanes-plain")!;
    expect([...visual.querySelectorAll("li[data-lane]")].map((li) => li.getAttribute("data-lane"))).toEqual(["a", "b", "a"]);
    const transitions = [...plain.querySelectorAll<HTMLElement>("[data-item-transition]")];
    expect(transitions).toHaveLength(4);
    expect(transitions.map((transition) => {
      const route = transition.querySelector<HTMLElement>("[data-item-route=stacked]")!;
      const from = route.style.getPropertyValue("--items-from");
      const to = route.style.getPropertyValue("--items-to");
      expect(["0px", "var(--spacing-xl, 24px)"]).toContain(from);
      expect(["0px", "var(--spacing-xl, 24px)"]).toContain(to);
      return to === from ? "same" : from === "0px" ? "down" : "up";
    })).toEqual(["down", "same", "up", "same"]);
    expect(visual.querySelectorAll("[data-item-visual]")).toHaveLength(3);
    expect(visual.querySelector("[data-item-end]")?.getAttribute("data-item-end")).toBe("ends");
    expect(visual.querySelector("[data-item-caption]")?.textContent).toBe("Sample data.");
    expect(plain.querySelector("[data-item-end]")?.getAttribute("data-item-end")).toBe("continues");
    expect(plain.querySelector("[data-item-end-label]")?.textContent).toBe("Repeats each quarter");
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
      const split = section.layout === "split-start" || section.layout === "split-end";
      expect(words(section.eyebrow), `${at} eyebrow`).toBeLessThanOrEqual(5);
      expect((section.eyebrow ?? "").length, `${at} eyebrow`).toBeLessThanOrEqual(32);
      expect(words(section.heading), `${at} heading`).toBeLessThanOrEqual(split ? 8 : 10);
      const intro = section.block === undefined && section.media === undefined;
      expect(words(section.description), `${at} description`).toBeLessThanOrEqual(intro ? 40 : 30);
      for (const action of section.actions ?? []) expect(words(action.label), `${at} action`).toBeLessThanOrEqual(3);

      if (section.media !== undefined) {
        expect(words(section.media.label), `${at} specimen label`).toBeGreaterThanOrEqual(12);
        expect(words(section.media.label), `${at} specimen label`).toBeLessThanOrEqual(25);
        if (section.media.type === "specimen") panelChecks(section.media.panel);
      }
      const block = section.block;
      if (block === undefined) continue;
      if (block.type === "matrix") {
        for (const side of block.sides) {
          expect(words(side.label), `${at} label`).toBeLessThanOrEqual(3); expect(words(side.description), `${at} description`).toBeLessThanOrEqual(25);
          for (const point of side.points ?? []) { expect(words(point), point).toBeGreaterThanOrEqual(4); expect(words(point), point).toBeLessThanOrEqual(9); }
          if (side.visual !== undefined) panelChecks(side.visual);
        }
        continue;
      }
      if (block.type !== "items") continue;
      for (const item of block.items) {
        expect((item.eyebrow ?? "").length, `${at} ${item.id} eyebrow`).toBeLessThanOrEqual(32);
        if (block.arrangement === "columns" && block.order === "none") expect(words(item.eyebrow), `${at} ${item.id} eyebrow`).toBeLessThanOrEqual(3);
        if (block.arrangement === "bento") expect(words(item.description), `${at} ${item.id}`).toBeGreaterThanOrEqual(8);
        if (block.reveal === "disclose") { expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(12); expect(words(item.description), `${at} ${item.id}`).toBeGreaterThanOrEqual(15); expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(45); }
        else if (block.order === "connected") { expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(2); expect(words(item.meta), `${at} ${item.id}`).toBeLessThanOrEqual(2); expect(words(item.description), `${at} ${item.id}`).toBeGreaterThanOrEqual(6); expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(14); }
        else if (block.arrangement === "rows") { expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(5); expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(12); }
        else { const statement=block.scale === "statement"; expect(words(item.heading), `${at} ${item.id}`).toBeLessThanOrEqual(statement ? 3 : 5); expect(words(item.description), `${at} ${item.id}`).toBeLessThanOrEqual(statement ? 12 : item.span === "two-thirds" || item.span === "full" || block.treatment === "plate" && block.columns === 2 ? 25 : 20); }
        if (item.visual !== undefined) partChecks(item.visual);
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
    const cta = CONTENT_CATALOG_CALL_TO_ACTION;
    expect(markup).toBe(renderToStaticMarkup(createElement(LandingView, {
      document: resolved,
      header: "reserved",
      peek: false,
      callToAction: { id: cta.id, eyebrow: cta.eyebrow, heading: cta.heading, description: cta.description,
        action: createElement("a", { href: cta.actionHref, className: buttonLinkClassName("primary", "lg") }, cta.actionLabel) },
    })));

    const { bands } = splitLandingViewBands(markup);
    for (const band of bands) expect(band).not.toContain("data-catalog-chrome");
  });

  it("keeps standalone gallery disclosures native and usable without hydration", () => {
    const entry = renderPreviewGalleryEntries().find(entry => entry.view === "SectionedView");
    expect(entry).toBeDefined();
    const annotations = /<span id="published-kind-[^"]+" data-published-kind="[^"]+" data-published-section="[^"]+" class="sr-only" aria-hidden="true"><\/span>/g;
    expect(entry!.markup.match(annotations)).toHaveLength(9);
    expect(entry!.markup.replace(annotations, "")).toBe(renderToStaticMarkup(createElement(SectionedView, {
      document: resolveSectionedViewDocument(previewSectionedDocument, previewCopyResolver),
    })));
    const dom = new JSDOM(entry!.markup).window.document;
    expect(dom.querySelectorAll("#faq [data-items] details summary")).toHaveLength(4);
    expect(dom.querySelectorAll("[data-rac]")).toHaveLength(0);
    const details = dom.querySelector("details");
    expect(details?.open).toBe(false);
    details?.querySelector("summary")?.click();
    expect(details?.open).toBe(true);
  });

  it("keeps static catalog disclosures usable without hydration", () => {
    const dom = new JSDOM(buildContentCatalogHtml()).window.document;
    const faq = dom.querySelector("#catalog-faq");
    expect(faq).not.toBeNull();
    expect(faq?.querySelectorAll("details")).toHaveLength(6);
    expect(faq?.querySelectorAll("button")).toHaveLength(0);
    const details = faq?.querySelector("details");
    const summary = details?.querySelector("summary");
    expect(details?.open).toBe(false);
    summary?.click();
    expect(details?.open).toBe(true);
    summary?.click();
    expect(details?.open).toBe(false);
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
    expect(withBrand).toContain('<html lang="en" dir="ltr" data-brand-bound>');

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
