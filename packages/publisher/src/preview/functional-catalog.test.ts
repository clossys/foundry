import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { TOKENS } from "@clossys/designer/tokens";
import { describe, expect, it } from "vitest";
import { SECTIONED_VIEW_CONTENT_CONTRACT as C, SECTIONED_VIEW_ITEM_RECIPES, desugarRecipe, resolveSectionedViewDocument, validateSectionedViewDocument } from "../core/index.js";
import { CATALOG_FIXTURES, CATALOG_COPY_REGISTRY, CATALOG_COMPOSITIONS, OTHER_KIND_LINKS, OTHER_KIND_SOURCE, catalogCopyResolver } from "./catalog/index.js";
import { CATALOG_RECIPE_LINKS, renderCatalogFixture, resolveCatalogFixtureDocument, resolveCatalogPresentationDocument } from "./catalog/contract-reference.js";
import { previewSectionedDocument, previewCopyResolver } from "./fixture-documents.js";
import { buildContentCatalogHtml, buildCatalogFunctionPages } from "./render-content-catalog.js";
import { buildMinimalBrandCssFromTokens, buildPreviewGalleryHtml, renderPreviewGalleryEntries, writePreviewGallery } from "./render-preview-gallery.js";

const functions = ["overview", "introduce", "show", "explain", "index-function", "sequence", "compare", "frame", "parts"];
function filesAt(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesAt(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
}

describe("functional content catalog", () => {
  it("links the reader jobs and shared references with purposes and axis chips", () => {
    const document = new JSDOM(buildContentCatalogHtml()).window.document;
    const entries = [...document.querySelectorAll("[data-catalog-function]")];
    expect(entries.map(entry => entry.getAttribute("data-catalog-function"))).toEqual(functions);
    for (const entry of entries) {
      expect(entry.querySelector("a")?.getAttribute("href")).toBe(`catalog/${entry.getAttribute("data-catalog-function")}.html`);
      expect(entry.querySelector("p")?.textContent?.trim()).toBeTruthy();
      if (!["overview", "parts"].includes(entry.getAttribute("data-catalog-function")!)) expect(entry.querySelectorAll("[data-catalog-axis]").length).toBeGreaterThan(0);
    }
  });

  it("writes, reports and links every nested page with real relative stylesheets", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-functions-"));
    try {
      const brand = join(dir, "input.css");
      writeFileSync(brand, buildMinimalBrandCssFromTokens({ TOKENS }));
      const out = join(dir, "out");
      const result = writePreviewGallery({ brandCssPath: brand, outputDir: out });
      const actual = filesAt(out).filter(file => file.endsWith(".html") || file.endsWith(".svg"));
      expect(new Set(actual)).toEqual(new Set(result.writtenFiles));
      expect(new Set(result.writtenFiles).size).toBe(result.writtenFiles.length);
      expect(result.writtenFiles[0]).toBe("gallery.html");
      expect(result.writtenFiles.at(-1)).toBe("index.html");
      const launch = new JSDOM(readFileSync(result.indexPath, "utf8")).window.document;
      for (const fn of functions) {
        const file = `catalog/${fn}.html`;
        expect(result.writtenFiles).toContain(file);
        expect(launch.querySelector(`a[href="${file}"]`)).not.toBeNull();
        const document = new JSDOM(readFileSync(join(out, file), "utf8")).window.document;
        expect(document.querySelector('a[href="../content-catalog.html"]')).not.toBeNull();
        const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute("href"));
        expect(sheets).toEqual(["../designer-tokens.css", "../publisher-preview.css", "../brand.css"]);
        for (const href of sheets) expect(readFileSync(resolve(out, "catalog", href!), "utf8").length).toBeGreaterThan(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("renders a real six-band composition and links all nine existing published kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-composition-"));
    try {
      const brand = join(dir, "input.css");
      writeFileSync(brand, buildMinimalBrandCssFromTokens({ TOKENS }));
      writePreviewGallery({ brandCssPath: brand, outputDir: join(dir, "out") });
      const recipes = new JSDOM(readFileSync(join(dir, "out/catalog/overview.html"), "utf8")).window.document;
      const composition = recipes.querySelector("[data-catalog-composition] > div");
      expect(composition).not.toBeNull();
      expect(composition?.querySelectorAll(":scope > section")).toHaveLength(6);
      expect(composition?.querySelector('[data-template="approval-chain"]')).not.toBeNull();
      const aliases = functions.flatMap(fn => [...new JSDOM(readFileSync(join(dir, `out/catalog/${fn}.html`), "utf8")).window.document.querySelectorAll("[data-published-kind]")]);
      expect(new Set(aliases.map(entry => entry.getAttribute("data-published-kind")))).toEqual(new Set(["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list", "stat-grid", "pricing", "testimonial", "stat"]));
      const gallery = new JSDOM(readFileSync(join(dir, "out/gallery.html"), "utf8")).window.document;
      for (const entry of aliases) {
        const link = entry.querySelector("a")!;
        const kind = link.parentElement!.getAttribute("data-published-kind")!;
        const descriptor = OTHER_KIND_LINKS.find(entry => entry.kind === kind)!;
        const target = gallery.getElementById(link.getAttribute("href")!.split("#")[1]!);
        expect(target?.getAttribute("data-published-kind")).toBe(kind);
        expect(target?.getAttribute("data-published-section")).toBe(descriptor.sectionId);
        expect(target?.parentElement?.id).toBe(descriptor.sectionId);
        expect(gallery.querySelectorAll(`[id="${target?.id}"]`).length).toBe(1);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


describe("retained contract configuration reference data", () => {
  const documents = CATALOG_FIXTURES.map(fixture => ({ id: `test-${fixture.id}`, sections: [fixture.section] }));
  const resolved = CATALOG_FIXTURES.map(fixture => resolveCatalogFixtureDocument(fixture));
  const content = resolved.flatMap(document => document.sections.filter(section => section.kind === "content-section"));
  const items = content.flatMap(section => section.block?.type === "items" ? [section.block] : []);
  it("uses exactly public fixture descriptors and validates and resolves all sample copy", () => {
    expect(CATALOG_FIXTURES).toHaveLength(44);
    expect(new Set(CATALOG_FIXTURES.map(fixture => fixture.id)).size).toBe(44);
    expect(Object.fromEntries(["Say", "Frame", "Items", "Matrix", "Media", "Recipes"].map(fn => [fn, CATALOG_FIXTURES.filter(fixture => fixture.fn === fn).length]))).toEqual({ Say: 6, Frame: 8, Items: 18, Matrix: 3, Media: 7, Recipes: 2 });
    const before = JSON.stringify(CATALOG_FIXTURES);
    for (const [index, fixture] of CATALOG_FIXTURES.entries()) {
      expect(Object.keys(fixture).sort(), fixture.id).toEqual(["axis", "caption", "fn", "id", "section", "value"]);
      expect(validateSectionedViewDocument(documents[index]!), fixture.id).toEqual([]);
      expect(resolved[index]!.resolutions.length, fixture.id).toBeGreaterThan(0);
      expect(renderCatalogFixture(fixture), fixture.id).toContain(`id="${fixture.id}"`);
    }
    expect(JSON.stringify(CATALOG_FIXTURES)).toBe(before);
    for (const document of Object.values(CATALOG_COMPOSITIONS)) expect(validateSectionedViewDocument(document)).toEqual([]);
    expect(OTHER_KIND_SOURCE.document).toBe(previewSectionedDocument);
    expect(OTHER_KIND_SOURCE.copyResolver).toBe(previewCopyResolver);
    expect(OTHER_KIND_LINKS.map(link => link.sectionId)).toEqual(previewSectionedDocument.sections.map(section => section.id));
    expect(CATALOG_COPY_REGISTRY.entries.every(entry => entry.status === "approved")).toBe(true);
  });
  it("covers imported contract enums using effective section and item data", () => {
    expect(new Set(resolved.flatMap(document => document.sections.map(section => section.ground)))).toEqual(new Set(["base", "sunken", "inverse"]));
    expect(new Set(content.map(section => section.size))).toEqual(new Set(C.sizes));
    expect(new Set(content.map(section => section.layout))).toEqual(new Set(C.layouts));
    for (const [axis, values] of [["arrangement", C.arrangements], ["order", C.orders], ["reveal", C.reveals], ["treatment", C.treatments], ["scale", C.scales]] as const) expect(new Set(items.map(block => block[axis])), axis).toEqual(new Set(values));
    expect(new Set(items.flatMap(block => block.items.flatMap(item => item.span ? [item.span] : [])))).toEqual(new Set(Object.keys(C.spans)));
    expect(new Set(items.flatMap(block => block.items.flatMap(item => item.badge ? [item.badge.tone ?? "neutral"] : [])))).toEqual(new Set(C.tones));
    for (const slot of ["eyebrow", "icon", "visual", "href", "meta", "badge"]) expect(items.some(block => block.items.some(item => Object.hasOwn(item, slot))), slot).toBe(true);
    const scenes = content.flatMap(section => section.media?.type === "scene" ? [section.media.input] : []);
    const composition = resolveSectionedViewDocument(Object.values(CATALOG_COMPOSITIONS)[0]!, catalogCopyResolver);
    const allScenes = [...scenes, ...composition.sections.flatMap(section => section.kind === "content-section" && section.media?.type === "scene" ? [section.media.input] : [])];
    expect(new Set(allScenes.map(scene => scene.template))).toEqual(new Set(["converge", "evidence-trail", "approval-chain"]));
    expect(new Set(scenes.flatMap(scene => scene.template === "converge" ? scene.sources.items.map(source => source.format) : []))).toEqual(new Set(["pdf", "email", "sheet", "doc", "note", "scan", "calendar"]));
  });
  it("demonstrates omitted recipe defaults and binds every recipe to a compatible existing fixture", () => {
    for (const [recipe, axis, expected] of [["features", "columns", 3], ["topics", "columns", 1], ["cards", "treatment", "rule"], ["link-index", "treatment", "plate"]] as const) {
      const block = CATALOG_FIXTURES.flatMap(fixture => fixture.section.kind === "content-section" && fixture.section.block?.type === "items" ? [fixture.section.block] : []).find(block => block.recipe === recipe && !Object.hasOwn(block, axis));
      expect(block, `${recipe} omits ${axis}`).toBeDefined();
      expect(desugarRecipe(block!)[axis]).toBe(expected);
    }
    expect(Object.keys(CATALOG_RECIPE_LINKS)).toEqual([...C.recipes]);
    for (const recipe of C.recipes) {
      const fixture = CATALOG_FIXTURES.find(fixture => fixture.id === CATALOG_RECIPE_LINKS[recipe]);
      expect(fixture?.section.kind).toBe("content-section");
      if (fixture?.section.kind !== "content-section" || fixture.section.block?.type !== "items") throw new Error("Recipe example must be Items");
      expect(fixture.section.block.recipe).toBe(recipe);
      expect(desugarRecipe(fixture.section.block)).toMatchObject(SECTIONED_VIEW_ITEM_RECIPES[recipe].fixed);
    }
  });
  it("resolves emitted reader links and retains recipe defaults, slots and real composition", () => {
    const sheets = { designerTokens: "designer-tokens.css", utilities: "publisher-preview.css", brand: null };
    const pages = [{ file: "content-catalog.html", content: buildContentCatalogHtml(sheets) }, ...buildCatalogFunctionPages(sheets)];
    const byFile = new Map(pages.map(page => [page.file, new JSDOM(page.content).window.document]));
    byFile.set("gallery.html", new JSDOM(buildPreviewGalleryHtml(renderPreviewGalleryEntries())).window.document);
    let exampleCount = 0;
    for (const page of pages) {
      const document = byFile.get(page.file)!;
      expect(document.querySelectorAll("main")).toHaveLength(1);
      expect(document.querySelector('link[href$="brand.css"]')).toBeNull();
      for (const link of document.querySelectorAll("a[href]")) {
        const url = new URL(link.getAttribute("href")!, `https://example.test/${page.file}`);
        const target = byFile.get(url.pathname.slice(1));
        expect(target, `${page.file}: ${link.getAttribute("href")}`).toBeDefined();
        if (url.hash) expect(target?.getElementById(url.hash.slice(1))).not.toBeNull();
      }
      exampleCount += document.querySelectorAll("[data-catalog-fixture]").length;
    }
    expect(exampleCount).toBe(32);
    const overview = byFile.get("catalog/overview.html")!;
    expect([...overview.querySelectorAll("[data-catalog-recipe]")].map(row => row.getAttribute("data-catalog-recipe"))).toEqual([...C.recipes, "comparison", "prose"]);
    for (const recipe of C.recipes) {
      const row = overview.querySelector(`[data-catalog-recipe="${recipe}"]`)!;
      expect(row.querySelector("a")?.getAttribute("href")).toContain(`#example-${CATALOG_RECIPE_LINKS[recipe]}`);
      for (const slot of SECTIONED_VIEW_ITEM_RECIPES[recipe].slots) expect(row.querySelector("[data-recipe-slots]")?.textContent).toContain(slot);
      if (SECTIONED_VIEW_ITEM_RECIPES[recipe].requiredSlot !== undefined) expect(row.querySelector("[data-recipe-slots]")?.textContent).toContain(`required: ${SECTIONED_VIEW_ITEM_RECIPES[recipe].requiredSlot}`);
      for (const [axis, value] of Object.entries(SECTIONED_VIEW_ITEM_RECIPES[recipe].fixed)) expect(row.querySelector("[data-recipe-fixed]")?.textContent).toContain(`${axis}=${value}`);
      for (const [axis, value] of Object.entries(SECTIONED_VIEW_ITEM_RECIPES[recipe].defaults ?? {})) expect(row.querySelector("[data-recipe-defaults]")?.textContent).toContain(`${axis}=${value}`);
    }
    const composition = overview.querySelector("[data-catalog-composition] > div")!;
    const authored = Object.values(CATALOG_COMPOSITIONS)[0]!;
    const bands = [...composition.querySelectorAll(":scope > section")];
    expect(bands).toHaveLength(6);
    bands.forEach((band, index) => expect(band.id.endsWith(`:${authored.sections[index]!.id}`) || band.querySelector(`[id$=":${authored.sections[index]!.id}"]`) !== null).toBe(true));
    expect(authored.sections[0]?.kind).toBe("hero");
    expect(authored.sections.slice(1, 4).every(section => section.kind === "content-section" && section.block?.type === "items" && section.block.recipe === "topics")).toBe(true);
    expect(authored.sections[4]?.kind === "content-section" && authored.sections[4].block?.type === "items" && authored.sections[4].block.recipe).toBe("faq");
    expect(authored.sections.slice(1, -1).filter(section => section.ground === "inverse").length).toBeLessThanOrEqual(1);
    expect(composition.querySelectorAll("details")).toHaveLength(4);
  });
});


describe("catalog copy and rendered additions", () => {
  const words = (text: string | undefined) => text?.trim().split(/\s+/).length ?? 0;
  const documents = [...CATALOG_FIXTURES.map(fixture => ({ id: `budget-${fixture.id}`, sections: [fixture.section] })), ...Object.values(CATALOG_COMPOSITIONS)];
  it("keeps actual resolved copy within role and collection budgets", () => {
    for (const authored of documents) for (const section of resolveSectionedViewDocument(authored, catalogCopyResolver).sections) {
      if (section.kind === "hero") { expect(words(section.heading)).toBeLessThanOrEqual(10); expect(words(section.description)).toBeLessThanOrEqual(35); continue; }
      if (section.kind !== "content-section") throw new Error("Expected canonical sample");
      const split = section.layout !== "stacked";
      expect(words(section.heading), section.id).toBeLessThanOrEqual(split ? 8 : 10);
      expect(words(section.eyebrow), section.id).toBeLessThanOrEqual(5);
      expect(words(section.description), section.id).toBeLessThanOrEqual(section.block === undefined && section.media === undefined ? 40 : 30);
      for (const action of section.actions ?? []) expect(words(action.label)).toBeLessThanOrEqual(3);
      const block = section.block;
      if (block?.type === "items") for (const item of block.items) {
        expect(words(item.eyebrow), `${section.id}.${item.id}`).toBeLessThanOrEqual(3);
        expect(words(item.heading), `${section.id}.${item.id}`).toBeLessThanOrEqual(block.reveal === "disclose" ? 12 : block.order === "connected" ? 2 : block.scale === "statement" ? 3 : 5);
        expect(words(item.meta), `${section.id}.${item.id}`).toBeLessThanOrEqual(block.order === "connected" ? 2 : 5);
        expect(words(item.description), `${section.id}.${item.id}`).toBeLessThanOrEqual(block.reveal === "disclose" ? 45 : block.order === "connected" ? 14 : block.scale === "statement" || block.arrangement === "rows" ? 12 : item.span === "full" || item.span === "two-thirds" ? 25 : 20);
        if (block.reveal === "disclose") expect(words(item.description)).toBeGreaterThanOrEqual(15);
      }
      if (block?.type === "matrix") for (const side of block.sides) { expect(words(side.label)).toBeLessThanOrEqual(3); expect(words(side.heading)).toBeLessThanOrEqual(8); expect(words(side.description)).toBeLessThanOrEqual(25); for (const point of side.points ?? []) expect(words(point)).toBeLessThanOrEqual(9); }
      if (section.media?.type === "scene") expect(words(section.media.label)).toBeGreaterThanOrEqual(12);
      // Resolution enforces the closed nested media character budgets and copy provenance.
      if (section.media?.type === "specimen") { expect(section.media.panel.title.length).toBeLessThanOrEqual(40); expect(section.media.panel.meta?.length ?? 0).toBeLessThanOrEqual(50); }
    }
  });
  it("matches displayed descriptors to actual effective axes", () => {
    for (const fixture of CATALOG_FIXTURES) {
      const section = resolveCatalogFixtureDocument(fixture).sections[0]!;
      if (["ground", "size", "layout"].includes(fixture.axis)) expect(section[fixture.axis as "ground" | "size" | "layout"], fixture.id).toBe(fixture.value);
      if (section.kind !== "content-section") continue;
      const block = section.block;
      if (block?.type === "items") {
        if (["arrangement", "order", "reveal", "treatment"].includes(fixture.axis)) expect(block[fixture.axis as "arrangement" | "order" | "reveal" | "treatment"], fixture.id).toBe(fixture.value);
        if (fixture.axis === "slot") expect(block.items.some(item => Object.hasOwn(item, String(fixture.value))), fixture.id).toBe(true);
        if (fixture.axis === "badgeTone") expect(new Set(block.items.flatMap(item => item.badge ? [item.badge.tone ?? "neutral"] : []))).toEqual(new Set(fixture.value));
      }
      if (block?.type === "matrix" && fixture.axis === "form") {
        expect(["points", "visual"]).toContain(fixture.value);
        expect(block.sides.every(side => fixture.value === "visual" ? side.visual !== undefined : side.points !== undefined)).toBe(true);
      }
      if (section.media?.type === "scene" && fixture.axis === "sceneTemplate") expect(section.media.input.template).toBe(fixture.value);
      if (section.media?.type === "record" && fixture.axis === "columns") expect(section.media.columns).toBe(fixture.value);
    }
  });
  it("renders independent badge metadata, previous marker text and real lane relationships", () => {
    const byId = (id: string) => CATALOG_FIXTURES.find(fixture => fixture.id === id)!;
    const badges = byId("items-badge-meta");
    const section = resolveSectionedViewDocument({ id: "badges", sections: [badges.section] }, catalogCopyResolver).sections[0]!;
    if (section.kind !== "content-section" || section.block?.type !== "items") throw new Error("Expected items");
    const root = new JSDOM(renderCatalogFixture(badges)).window.document;
    const rows = [...root.querySelectorAll("[data-item-meta]")];
    expect(rows.length).toBe(6);
    rows.forEach((row, index) => { const item = section.block!.type === "items" ? section.block.items[index]! : undefined; if (item?.badge) expect(row.textContent).toContain(item.badge.label); if (item?.meta !== undefined) expect(row.textContent).toContain(item.meta); });
    const meter = byId("media-meter-previous");
    const resolved = resolveSectionedViewDocument({ id: "meter", sections: [meter.section] }, catalogCopyResolver).sections[0]!;
    if (resolved.kind !== "content-section" || resolved.media?.type !== "specimen") throw new Error("Expected panel");
    const previous = resolved.media.panel.parts.find(part => part.type === "meter" && part.previous !== undefined);
    if (previous?.type !== "meter") throw new Error("Expected prior measurement");
    const document = new JSDOM(renderCatalogFixture(meter)).window.document;
    expect(document.querySelector('[data-part="previous"]')).not.toBeNull(); expect(document.body.textContent).toContain(previous.previousText); expect(document.body.textContent).toContain(previous.valueText);
    const lanes = byId("items-two-lane-list");
    const laneRoot = new JSDOM(renderCatalogFixture(lanes)).window.document;
    expect(new Set([...laneRoot.querySelectorAll("li[data-lane]")].map(node => node.getAttribute("data-lane")))).toEqual(new Set(["sender", "reviewer"]));
    const close = new JSDOM(renderCatalogFixture(byId("say-close"))).window.document;
    expect(close.body.children.length).toBe(1); expect(close.body.firstElementChild?.tagName).toBe("SECTION"); expect(close.querySelectorAll("h2")).toHaveLength(1);
  });
});

describe("validated catalog ground presentation", () => {
  it("refuses original invalid authored ground and unresolved copy before projection", () => {
    const fixture = CATALOG_FIXTURES.find(entry => entry.id === "frame-ground-sunken")!;
    const invalid = { ...fixture, section: { ...fixture.section, ground: "base" } } as unknown as typeof fixture;
    expect(() => resolveCatalogFixtureDocument(invalid)).toThrow(/ground must be inverse or omitted/);
    expect(() => resolveCatalogFixtureDocument(fixture, () => undefined)).toThrow(/could not resolve a CopyRef/);
  });
  it("removes only the presented id from automatic grounds and preserves source and provenance", () => {
    const first = CATALOG_FIXTURES.find(entry => entry.id === "frame-ground-base")!;
    const second = CATALOG_FIXTURES.find(entry => entry.id === "frame-ground-sunken")!;
    const document = { id: "catalog-ground-presentation", sections: [first.section, second.section] };
    const before = JSON.stringify(document);
    const original = resolveSectionedViewDocument(document, catalogCopyResolver);
    expect(original.viewGrounds).toEqual([first.section.id, second.section.id]);
    const presented = resolveCatalogPresentationDocument(document, catalogCopyResolver, first.section.id, "sunken");
    expect(presented.viewGrounds).toEqual([second.section.id]);
    expect(presented.sections[0]!.ground).toBe("sunken");
    expect(presented.sections[1]).toEqual(original.sections[1]);
    expect(presented.id).toBe(original.id);
    expect(presented.resolutions).toEqual(original.resolutions);
    expect(JSON.stringify(document)).toBe(before);
  });
  it.each(["base", "sunken", "inverse"] as const)("renders the retained %s descriptor through the actual native view", ground => {
    const fixture = CATALOG_FIXTURES.find(entry => entry.id === `frame-ground-${ground}`)!;
    const native = new JSDOM(renderCatalogFixture(fixture)).window.document.querySelector("[data-content-section]")!;
    expect(native).not.toBeNull();
    if (ground === "base") {
      expect(native.classList.contains("bg-surface-sunken")).toBe(false);
      expect(native.classList.contains("bg-surface-inverse")).toBe(false);
    } else expect(native.classList.contains(`bg-surface-${ground}`)).toBe(true);
    expect(native.querySelector("h2")!.classList.contains(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary")).toBe(true);
    expect(resolveCatalogFixtureDocument(fixture).sections[0]!.ground).toBe(ground);
  });
});
