// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { Scene } from "@clossys/designer/blocks/server";
import { createCopyResolver, computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewGround, type SectionedViewContentSection, type SectionedViewDocument, type SectionedViewItemsBlock, type ResolvedSectionedViewDocument, type SectionedViewMedia, type SectionedViewSpecimenPart } from "../../core/sectioned-view.js";
import { previewSectionedDocument, previewCopyResolver } from "../../preview/fixture-documents.js";
import { LandingView } from "@clossys/designer/frames";
import { ServerLandingView as ServerLandingView } from "@clossys/designer/frames";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { assertRenderableSectionedViewDocument, renderSectionedViewSections } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";
import { planLandingViewGrounds } from "./landingViewGrounds.js";
const copy = { date: "Oct 11", amount: "40 units", share: "25 percent", format: "PDF", source: "Public archive", measurement: "40 of 100", limit: "80 units", caption: "Sample table", heading: "Example section", first: "First item", second: "Second item", third: "Third item", fourth: "Fourth item", detail: "A short description.", meta: "Example metadata", badge: "Ready", eyebrow: "Example eyebrow", group: "Example group", panel: "Example panel", field: "Field", value: "Value", initials: "AB", owner: "Example owner", label: "A sample panel with labeled fields and a visible footer.", scene: "Sample documents connect to one result with labeled rows and clear relationships for review.", short: "Example", link: "Read more" };
const ref = (key: keyof typeof copy) => ({ id: `example.${key}` });
const registry = { id: "canonical-render", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(copy).map(([key, text]) => ({ id: `example.${key}`, text, context: "Canonical renderer test", status: "approved" })) } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const item = (id: string, heading: keyof typeof copy = "first") => ({ id, heading: ref(heading), description: ref("detail") });
const field = { id: "fields", type: "fields" as const, label: ref("field"), items: [{ id: "field", label: ref("field"), value: ref("value") }] };
const panel = { id: "panel", title: ref("panel"), parts: [field], footer: { assignee: { initials: ref("initials"), name: ref("owner") }, note: ref("detail") } };
const specimen = { type: "specimen" as const, label: ref("label"), panel };
type PaletteSection = Omit<SectionedViewContentSection, "ground"> & { ground?: SectionedViewGround };
const paletteGrounds = new WeakMap<SectionedViewContentSection, SectionedViewGround>();
function band(fields: Partial<PaletteSection> = {}): SectionedViewContentSection {
  const { ground, ...rest } = fields;
  const section: SectionedViewContentSection = { id: "content", kind: "content-section", heading: ref("heading"), ...(ground === "inverse" ? { ground } : {}), ...rest };
  if (ground === "base" || ground === "sunken") paletteGrounds.set(section, ground);
  return section;
}
function applyPalette(document: ResolvedSectionedViewDocument, source: readonly SectionedViewContentSection[]) {
  const overridden = new Set<string>();
  const sections = document.sections.map((section, index) => {
    const ground = paletteGrounds.get(source[index]!);
    if (ground === undefined) return section;
    overridden.add(section.id); return { ...section, ground };
  });
  return { ...document, sections, ...(document.viewGrounds === undefined ? {} : { viewGrounds: document.viewGrounds.filter(id => !overridden.has(id)) }) };
}
function resolve(section: PaletteSection) {
  const { ground, ...rest } = section;
  const authored: SectionedViewContentSection = { ...rest, ...(ground === "inverse" ? { ground } : {}) };
  const palette = paletteGrounds.get(section as SectionedViewContentSection) ?? (ground === "base" || ground === "sunken" ? ground : undefined);
  if (palette !== undefined) paletteGrounds.set(authored, palette);
  const document: SectionedViewDocument = { id: "canonical", sections: [authored] };
  expect(validateSectionedViewDocument(document).filter(f => f.severity === "error")).toEqual([]);
  return applyPalette(resolveSectionedViewDocument(document, resolver), [authored]);
}
function html(document: ResolvedSectionedViewDocument, server = false) { return renderToStaticMarkup(server ? <ServerSectionedView document={document} /> : <SectionedView document={document} />); }
function dom(markup: string) { const root = document.createElement("div"); root.innerHTML = markup; return root; }
const columns = (count: 2 | 3): SectionedViewItemsBlock => ({ type: "items", arrangement: "columns", columns: count, items: [item("first"), item("second", "second"), ...(count === 3 ? [item("third", "third")] : [])] });
describe("canonical available renderer", () => {
  it("keeps consumer continuation copy hidden without creating a visible end-label row", () => {
    const section=band({block:{type:"items",arrangement:"stacked",order:"connected",end:"continues",items:[item("first"),item("second","second"),item("third","third")]}});
    const input: SectionedViewDocument={id:"continuation",sections:[section]};expect(validateSectionedViewDocument(input).filter(f=>f.severity==="error")).toEqual([]);
    const continueResolver=createCopyResolver({...registry,entries:[...registry.entries,{id:"steps.continues",text:"Consumer continuation",context:"Fixture",status:"approved"}]});
    const doc=resolveSectionedViewDocument(input,continueResolver);
    for(const server of [false,true]) {const root=dom(html(doc,server));expect(root.querySelector("[data-item-end-label]")).toBeNull();const continuation=root.querySelector<HTMLElement>("[data-content-continuation]")!;expect(continuation).not.toBeNull();expect(continuation.textContent).toBe("Consumer continuation");expect(continuation.className).toBe("sr-only");expect(continuation.previousElementSibling?.tagName).toBe("OL");}
    const block=doc.sections[0];if(block?.kind!=="content-section"||block.block?.type!=="items")throw new Error("Expected connected items");expect(block.block.continuesLabel).toBe("Consumer continuation");expect(doc.resolutions.some(entry=>entry.ref.id==="steps.continues"&&entry.text==="Consumer continuation")).toBe(true);
    const visible=resolveSectionedViewDocument({ ...input,sections:[{...section,block:{...section.block!,endLabel:ref("link")}}]},continueResolver);
    for(const server of [false,true]) {const root=dom(html(visible,server));expect(root.querySelector("[data-item-end-label]")?.textContent).toBe(copy.link);expect(root.querySelector("[data-content-continuation]")).toBeNull();}
  });
  it.each([2, 3] as const)("renders actual unordered Items with %i columns through both entries", count => {
    const section = band({ block: columns(count) }); const resolved = resolve(section);
    const markup = html(resolved); expect(html(resolved, true)).toBe(markup);
    const root = dom(markup); expect(root.querySelector("h2")?.textContent).toBe(copy.heading); expect(root.querySelectorAll("h3").length).toBe(count);
    expect(root.querySelector("[data-items]")?.getAttribute("data-arrangement")).toBe("columns");
    expect(root.textContent).toContain(copy.detail);
    const recipe = resolve(band({ block: { ...columns(count), recipe: "features" } })); expect(html(recipe)).toBe(markup);
  });
  it.each((["stacked", "split-start", "split-end"] as const).flatMap(layout => (["base", "inverse"] as const).map(ground => ({ layout, ground }))))("derives statement centering for $layout on $ground while forwarding the statement scale", ({ layout, ground }) => {
    const section = band({ layout, ground, block: { type: "items", recipe: "statement", items: columns(3).items } });
    const resolved = resolve(section); const before = JSON.stringify(resolved);
    for (const server of [false, true]) {
      const root = dom(html(resolved, server)); const header = root.querySelector("[data-content-section-header]")!;
      expect(header.classList.contains("text-center")).toBe(layout === "stacked");
      expect(header.classList.contains(layout === "stacked" ? "items-center" : "items-start")).toBe(true);
      expect(root.querySelector("h2")?.textContent).toBe(copy.heading);
      expect([...root.querySelectorAll("[data-item-heading]")].map(node => node.textContent)).toEqual([copy.first, copy.second, copy.third]);
      for (const heading of root.querySelectorAll("[data-item-heading]")) { expect(heading.tagName).toBe("H3"); expect(heading.classList.contains("text-h0")).toBe(true); }
    }
    const raw = resolve(band({ layout, ground, block: { ...columns(3), scale: "statement" } }));
    expect(html(raw)).toBe(html(resolved));
    expect(JSON.stringify(resolved)).toBe(before);
  });
  it("keeps an ordinary inverse feature header start-aligned", () => {
    const doc = resolve(band({ ground: "inverse", block: { type: "items", recipe: "features", items: columns(3).items } }));
    for (const server of [false, true]) {
      const header = dom(html(doc, server)).querySelector("[data-content-section-header]")!;
      expect(header.classList.contains("items-start")).toBe(true); expect(header.classList.contains("text-center")).toBe(false);
    }
  });
  it.each([[2, 2], [2, 4], [2, 6], [3, 3], [3, 6]] as const)("maps only link-index with %i columns and %i items to Index plates", (columnCount, count) => {
    const sourceItems = Array.from({ length: count }, (_, index) => ({ ...item(`entry-${index}`, (["first", "second", "third"] as const)[index % 3]), href: `/index-${index}`, badge: { label: ref("badge"), tone: "info" as const } }));
    for (const ground of ["base", "inverse"] as const) {
      const doc = resolve(band({ ground, block: { type: "items", recipe: "link-index", columns: columnCount, items: sourceItems } }));
      const before = JSON.stringify(doc), sections = doc.sections, resolutions = doc.resolutions, entries = [...resolutions], provenance = resolutions.map(entry => entry.source);
      for (const server of [false, true]) {
        const root = dom(html(doc, server)), list = root.querySelector("[data-items]")!;
        expect(list.getAttribute("data-treatment")).toBe("plate"); expect(list.getAttribute("data-arrangement")).toBe("rows"); expect(list.getAttribute("data-columns")).toBe(String(columnCount));
        expect(list.className).toContain(columnCount === 2 ? "tablet:grid-cols-2" : "tablet-lg:grid-cols-3");
        expect([...list.querySelectorAll("[data-item-heading]")].map(node => node.textContent?.trim())).toEqual(Array.from({ length: count }, (_, index) => [copy.first, copy.second, copy.third][index % 3]));
        for (const heading of list.querySelectorAll("[data-item-heading]")) { expect(heading.tagName).toBe("H3"); expect(heading.classList.contains("text-body")).toBe(true); }
        expect([...list.querySelectorAll("[data-item-heading] > a")].map(node => node.getAttribute("href"))).toEqual(sourceItems.map(item => item.href));
        expect(list.querySelectorAll('[data-item][data-variant="plate"]')).toHaveLength(count);
        for (const tile of list.querySelectorAll("[data-item]")) { expect(tile.querySelectorAll("a")).toHaveLength(1); expect(tile.textContent).toContain(copy.badge); expect(tile.classList.contains(ground === "inverse" ? "bg-surface-inverse-raised" : "bg-surface-sunken")).toBe(true); }
      }
      const raw = resolve(band({ ground, block: { type: "items", arrangement: "columns", columns: columnCount, treatment: "plate", items: sourceItems.map(item => ({ ...item, meta: ref("meta") })) } }));
      for (const server of [false, true]) { const rawList = dom(html(raw, server)).querySelector("[data-items]")!; expect(rawList.getAttribute("data-arrangement")).toBe("columns"); expect(rawList.querySelector("[data-item-heading]")?.classList.contains("text-h2")).toBe(true); expect(rawList.textContent).toContain(copy.meta); expect(rawList.textContent).toContain(copy.badge); }
      expect(doc.sections).toBe(sections); expect(doc.resolutions).toBe(resolutions); entries.forEach((entry, index) => { expect(doc.resolutions[index]).toBe(entry); expect(doc.resolutions[index]!.source).toBe(provenance[index]); }); expect(JSON.stringify(doc)).toBe(before);
      const forged: any = structuredClone(doc); forged.sections[0].block.treatment = "rule";
      const called = vi.fn(); expect(() => renderSectionedViewSections(forged, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/link-index fixes treatment/); expect(called).not.toHaveBeenCalled();
      for (const server of [false, true]) expect(() => html(forged, server)).toThrow(/link-index fixes treatment/);
    }
  });
  it.each(["standard", "display"] as const)("forwards frame and collection scale %s", size => {
    const root = dom(html(resolve(band({ size, block: columns(2) }))));
    expect(root.querySelector("[data-content-section]")?.classList.contains(size === "display" ? "py-5xl" : "py-4xl")).toBe(true);
    expect(root.querySelector("[data-item-heading]")?.classList.contains(size === "display" ? "text-h1" : "text-h2")).toBe(true);
  });
  it.each(["split-start", "split-end"] as const)("keeps %s directions, actions and link-only footnote", layout => {
    const root = dom(html(resolve(band({ layout, block: columns(2), actions: [{ id: "start", label: ref("link"), href: "/start", emphasis: "tertiary" }], footnote: { link: { label: ref("link"), href: "/more" } } }))));
    expect(root.querySelector("[data-content-section]")?.getAttribute("data-layout")).toBe(layout);
    expect([...root.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/start", "/more"]);
    expect(root.textContent).not.toContain("undefined");
  });
  it("preserves item slots, independent badge/meta and bento span", () => {
    const root = dom(html(resolve(band({ block: { type: "items", arrangement: "bento", treatment: "plate", items: [{ ...item("first"), span: "half", eyebrow: ref("eyebrow"), meta: ref("meta"), badge: { label: ref("badge"), tone: "success" }, visual: field }, { ...item("second", "second"), span: "half" }] } }))));
    for (const value of [copy.eyebrow, copy.meta, copy.badge, copy.field, copy.value]) expect(root.textContent).toContain(value);
    expect(root.querySelectorAll('[data-span="half"]').length).toBe(2);
  });
  it("keeps flat source IDs and group membership through linked rows", () => {
    const doc = resolve(band({ block: { type: "items", arrangement: "rows", columns: 2, treatment: "rule", items: ["first", "second", "third", "fourth"].map((id, index) => ({ ...item(id, id as "first" | "second" | "third" | "fourth"), href: `/item-${index}` })), groups: [{ id: "one", label: ref("group"), items: ["first", "second"] }, { id: "two", label: ref("group"), items: ["third", "fourth"] }] } }));
    const root = dom(html(doc)); expect(html(doc, true)).toBe(html(doc));
    expect([...root.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/item-0", "/item-1", "/item-2", "/item-3"]); expect(root.querySelectorAll("h3").length).toBe(4);
    const section = doc.sections[0]!; if (section.kind !== "content-section" || section.block?.type !== "items") throw new Error("Expected canonical grouped items");
    expect(section.block.groups).toEqual([{ id: "one", label: copy.group, items: ["first", "second"] }, { id: "two", label: copy.group, items: ["third", "fourth"] }]);
    const groups = [...root.querySelectorAll('[role="group"][aria-labelledby]')]; expect(groups).toHaveLength(2);
    groups.forEach((group, index) => {
      const labelId = group.getAttribute("aria-labelledby"); const label = [...root.querySelectorAll("[id]")].find(node => node.id === labelId); expect(label?.textContent).toBe(copy.group); expect(group.contains(label!)).toBe(true);
      expect(group.querySelectorAll('ul[role="list"] > li')).toHaveLength(2); expect([...group.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(index === 0 ? ["/item-0", "/item-1"] : ["/item-2", "/item-3"]);
    });
  });
  it("renders a single specimen without dropping footer copy through both entries", () => {
    const resolved = resolve(band({ media: specimen })); const markup = html(resolved); expect(html(resolved, true)).toBe(markup);
    for (const value of [copy.panel, copy.field, copy.value, copy.owner, copy.initials]) expect(dom(markup).textContent).toContain(value); expect(markup).toContain(`aria-label="${copy.label}"`);
  });
  it("accepts frozen ordinary arrays from the genuine resolver", () => {
    const resolved = resolve(band({ block: columns(2) })); Object.freeze(resolved.sections); Object.freeze(resolved.resolutions); expect(() => html(resolved)).not.toThrow();
  });
});
describe("canonical resolved boundary", () => {
  it("preserves shape-only provenance and caller object identity", () => {
    const doc = resolve(band({ block: columns(2) })); const resolutions = doc.resolutions;
    doc.resolutions = [resolutions[0]!]; doc.sections = doc.sections.map(section => Object.assign(Object.create(null), section));
    const before = JSON.stringify(doc); expect(() => html(doc)).not.toThrow(); expect(doc.resolutions[0]).toBe(resolutions[0]); expect(JSON.stringify(doc)).toBe(before);
  });
  it.each(["size", "layout", "arrangement", "order", "reveal", "treatment", "scale", "columns"])("refuses missing resolved %s before default repair", key => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) })));
    const target = key === "size" || key === "layout" ? doc.sections[0] : doc.sections[0].block;
    delete target[key]; expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(key);
    target[key] = undefined; expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(key);
  });
  it.each(["columns", "partial-links", "duplicate-links", "raw-copy", "recipe", "group", "badge", "provenance"])("refuses forged %s before invoking Designer", name => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) }))); const block = doc.sections[0].block;
    if (name === "columns") block.columns = 3;
    if (name === "partial-links") block.items[0].href = "/one";
    if (name === "duplicate-links") { block.items[0].href = "/one/"; block.items[1].href = "/one#more"; }
    if (name === "raw-copy") block.items[0].heading = ref("first");
    if (name === "recipe") { block.recipe = "features"; block.scale = "statement"; }
    if (name === "group") block.groups = [{ id: "group", label: copy.group, items: ["foreign"] }];
    if (name === "badge") block.items[0].badge = { label: copy.badge, tone: "accent" };
    if (name === "provenance") doc.resolutions[0].source.reference = "";
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/invalid resolved document/); expect(called).not.toHaveBeenCalled();
  });
  it.each(["index", "map", "iterator", "prototype", "block-type", "provenance-index"])("never invokes hostile %s data", name => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) }))); const calls = vi.fn(() => { throw new Error("invoked"); }); const items = doc.sections[0].block.items;
    if (name === "provenance-index") Object.defineProperty(doc.resolutions, "0", { enumerable: true, get: calls });
    if (name === "index") Object.defineProperty(items, "0", { enumerable: true, get: calls });
    if (name === "map") Object.defineProperty(items, "map", { enumerable: true, get: calls });
    if (name === "iterator") Object.defineProperty(items, Symbol.iterator, { get: calls });
    if (name === "prototype") Object.setPrototypeOf(items, { get map() { return calls(); } });
    if (name === "block-type") Object.defineProperty(doc.sections[0].block, "type", { enumerable: true, get: calls });
    expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(); expect(calls).not.toHaveBeenCalled();
  });
});
describe("canonical ordered and disclosed collections", () => {
  it.each([
    { arrangement: "stacked", columns: undefined, grid: "desktop:grid-cols-4", actorPosition: "desktop:absolute" },
    { arrangement: "columns", columns: 2, grid: "tablet:grid-cols-2", actorPosition: "tablet:absolute" },
    { arrangement: "columns", columns: 3, grid: "tablet-lg:grid-cols-3", actorPosition: "tablet:absolute" },
  ] as const)("renders four resolved lane steps in $arrangement with $columns columns through both entries", ({ arrangement, columns: count, grid, actorPosition }) => {
    const doc = resolve(band({ block: {
      type: "items", recipe: "steps", arrangement, ...(count === undefined ? {} : { columns: count }),
      lanes: [{ id: "team", label: ref("group") }, { id: "service", label: ref("meta") }], end: "ends", endLabel: ref("link"),
      items: (["first", "second", "third", "fourth"] as const).map((id, index) => ({ ...item(id, id), lane: index === 1 || index === 2 ? "service" : "team" })),
    } }));
    const before = JSON.stringify(doc); const resolutions = doc.resolutions;
    for (const server of [false, true]) {
      const root = dom(html(doc, server)); const list = root.querySelector("ol[data-items]")!;
      expect(list.classList.contains(grid)).toBe(true);
      expect(list.getAttribute("aria-labelledby")).toBe(root.querySelector("h2")!.id);
      expect([...list.querySelectorAll(":scope > li")].map(node => node.getAttribute("data-lane"))).toEqual(["team", "service", "service", "team"]);
      expect([...list.querySelectorAll("[data-item-heading]")].map(node => node.textContent?.trim())).toEqual([copy.first, copy.second, copy.third, copy.fourth]);
      const actors = [...list.querySelectorAll("[data-item-lane-label]")];
      expect(actors.map(node => node.textContent)).toEqual([copy.group, copy.meta, copy.meta, copy.group]);
      for (const actor of actors) expect(actor.classList.contains(actorPosition)).toBe(true);
      expect(list.querySelectorAll("[data-item-transition]")).toHaveLength(3);
      expect(list.querySelectorAll("[data-item-end]")).toHaveLength(1);
      expect(list.querySelector("li:last-child [data-item-end]")?.getAttribute("data-item-end")).toBe("ends");
      expect(list.querySelector("li:last-child [data-item-end-label]")?.textContent).toBe(copy.link);
      if (arrangement === "stacked") { expect(list.classList.contains("desktop:grid-cols-5")).toBe(false); expect(list.querySelectorAll('[data-item-route="columns-4"]')).toHaveLength(3); }
    }
    expect(html(doc, true)).toBe(html(doc)); expect(JSON.stringify(doc)).toBe(before); expect(doc.resolutions).toBe(resolutions);
  });
  it.each(["numbered", "connected", "disclose"])("renders ordered or disclosed %s items through their actual entry", name => {
    let section = band({ block: { ...columns(2), order: "numbered" } });
    if (name === "connected") section = band({ block: { type: "items", recipe: "steps", arrangement: "stacked", items: [item("first"), item("second"), item("third")] } });
    if (name === "disclose") section = band({ block: { type: "items", recipe: "faq", items: [item("first"), item("second"), item("third"), item("fourth")] } });
    const doc = resolve(section); const before = JSON.stringify(doc); const resolutions = doc.resolutions;
    for (const server of [false, true]) {
      const root = dom(html(doc, server)); expect(root.textContent).toContain(copy.first); expect(root.textContent).toContain(copy.detail);
      const heading = root.querySelector("h2")!; const collection = root.querySelector("[data-items]")!;
      expect(heading.id).toBe("content:heading"); expect(collection).not.toBeNull(); expect(collection.getAttribute("aria-labelledby")).toBe(heading.id);
      expect([...root.querySelectorAll("[id]")].filter(node => node.id === heading.id)).toHaveLength(1);
      if (name === "disclose") {
        expect(root.querySelectorAll(server ? "details" : "[data-rac][data-expanded]").length || root.querySelectorAll(server ? "summary" : "button").length).toBe(4);
        expect(root.querySelector("summary") !== null).toBe(server);
        expect(root.querySelector("[data-rac]") !== null).toBe(!server);
      } else { expect(root.querySelector("ol[data-items]")).not.toBeNull(); expect(root.querySelectorAll("[data-item-ordinal]")).toHaveLength(name === "connected" ? 3 : 2); }
    }
    expect(JSON.stringify(doc)).toBe(before); expect(doc.resolutions).toBe(resolutions);
  });
});

const short = ref("short");
const status = { tone: "info" as const, text: short };
const rows = ["one", "two"].map(id => ({ id, label: short, value: short }));
const person = { initials: "AB", name: short, note: short };
const scenes = {
  converge: { template: "converge" as const, seed: "stable", sources: { heading: short, items: ["a", "b", "c"].map(id => ({ id, format: "pdf" as const, title: short, origin: short })) }, target: { heading: short, title: short, meta: short, rows }, relations: ["a", "b", "c"].map(from => ({ from, to: "one" })) },
  evidence: { template: "evidence-trail" as const, seed: "stable", sources: ["a", "b"].map(id => ({ id, format: "doc" as const, title: short, origin: short, cites: "one", cite: short })), result: { title: short, meta: short, rows, status, person } },
  approval: { template: "approval-chain" as const, seed: "stable", prepared: { heading: short, meta: short }, findings: ["a", "b"].map((id, index) => ({ id, fn: short, title: short, subjectOf: short, status, ...(index === 0 ? { subject: true as const } : {}) })), node: { label: short }, decision: { title: short, meta: short, rows, status, person } },
};
describe("canonical existing media mappings", () => {
  it.each(["converge", "evidence", "approval"] as const)("preserves all resolved %s Scene copy and structural edges", name => {
    const doc = resolve(band({ media: { type: "scene", label: ref("scene"), relationLabel: short, input: scenes[name] } }));
    const before = JSON.stringify(doc); const markup = html(doc); expect(html(doc, true)).toBe(markup);
    expect(markup).toContain(copy.scene); expect(dom(markup).textContent).toContain(copy.short);
    expect(markup).toContain("data-scene"); if (name !== "converge") expect(dom(markup).textContent).toContain("AB");
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.each(["stacked", "split-start", "split-end"] as const)("derives keyed specimen placement from %s with all three marker targets", layout => {
    const media: SectionedViewMedia = { ...specimen, key: { label: short, items: ["header", "fields", "footer"].map((target, index) => ({ id: `marker-${index}`, target, heading: short, description: ref("detail") })) } };
    const doc = resolve(band({ media, layout })); const markup = html(doc); expect(html(doc, true)).toBe(markup);
    expect(dom(markup).querySelector("[data-anatomy-callouts]")?.getAttribute("data-legend-side")).toBe(layout === "stacked" ? "end" : "below");
    expect(markup).toContain("data-anatomy"); expect(dom(markup).querySelectorAll("li")).toHaveLength(3);
    for (const value of [copy.panel, copy.value, copy.owner, copy.short, copy.detail]) expect(dom(markup).textContent).toContain(value);
  });
  it("forwards record head/status/flag/owner/note and three columns without dropping provenance", () => {
    const media: SectionedViewMedia = { type: "record", id: "record", columns: 3, head: { title: ref("panel"), meta: ref("meta"), status: { tone: "success", label: ref("badge") } }, caption: ref("detail"), flagLabel: short, groups: [{ id: "one", label: ref("group"), rows: [{ id: "first", label: ref("field"), detail: ref("detail"), status: { tone: "info", label: ref("badge") }, flag: true }] }, { id: "two", label: ref("group"), rows: [{ id: "second", label: ref("field"), detail: ref("detail") }] }, { id: "owner", label: ref("group"), owner: { initials: ref("initials"), name: ref("owner"), note: ref("detail") }, note: ref("detail") }] };
    const doc = resolve(band({ media })); const markup = html(doc); expect(html(doc, true)).toBe(markup);
    for (const value of [copy.panel, copy.meta, copy.badge, copy.initials, copy.owner, copy.short, copy.detail]) expect(dom(markup).textContent).toContain(value);
    expect(markup).toContain("data-ledger"); expect(dom(markup).querySelector("[data-record-ledger]")?.getAttribute("data-columns")).toBe("3");
  });
  it("renders stacked visual Items without losing eyebrow or part labels", () => {
    const doc = resolve(band({ block: { type: "items", arrangement: "stacked", treatment: "rule", items: [{ ...item("one"), eyebrow: ref("eyebrow"), visual: field }, { ...item("two", "second"), eyebrow: ref("eyebrow"), visual: { ...field, id: "second-fields" } }] } }));
    const markup = html(doc); expect(html(doc, true)).toBe(markup); expect(dom(markup).querySelectorAll("figure")).toHaveLength(2);
    expect(dom(markup).textContent).toContain(copy.eyebrow); expect(dom(markup).textContent).toContain(copy.value);
  });
});
describe("published kind preservation", () => {
  it.each(previewSectionedDocument.sections.map(section => [section.kind, section] as const))("retains %s visible fields and outline through both entries", (_kind, authoredSection) => {
    const authoredDoc: SectionedViewDocument = { id: "published", sections: [authoredSection] };
    expect(validateSectionedViewDocument(authoredDoc).filter(f => f.severity === "error")).toEqual([]);
    const doc = resolveSectionedViewDocument(authoredDoc, previewCopyResolver); const root = dom(html(doc)); const serverRoot = dom(html(doc, true));
    for (const resolution of doc.resolutions) { expect(root.textContent).toContain(resolution.text); expect(serverRoot.textContent).toContain(resolution.text); }
    expect(root.querySelector(`[id="${authoredSection.id}"]`)).not.toBeNull(); expect(root.querySelector("h1,h2")).not.toBeNull();
  });
  it("keeps published FeatureGrid count four outside canonical column caps", () => {
    const authoredDoc: SectionedViewDocument = { id: "legacy", sections: [{ id: "features", kind: "feature-grid", ground: "base", heading: short, items: ["a", "b", "c", "d"].map(id => ({ id, heading: short })) }] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    expect(dom(html(doc)).querySelectorAll("p.font-medium.text-body")).toHaveLength(4); expect(html(doc, true)).toBe(html(doc));
  });
  it("keeps published split FAQ native and React Aria factories separate", () => {
    const authoredDoc: SectionedViewDocument = { id: "faq", sections: [{ id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, description: ref("detail"), items: ["one", "two", "three", "four"].map(id => ({ id, question: short, answer: ref("detail") })) }] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    const ordinary = dom(html(doc)); const server = dom(html(doc, true)); expect(server.querySelector("details summary")?.textContent).toContain(copy.short); expect(ordinary.querySelector("details")).toBeNull();
    expect(ordinary.querySelector("button")?.textContent).toContain(copy.short); expect(server.textContent).toContain(copy.detail);
  });
  it.each(["retired-block", "private-bridge"])("refuses external canonical %s spoof before Designer", name => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) }))); if (name === "retired-block") doc.sections[0].block = { type: "faq", items: [{ id: "one", question: copy.short, answer: copy.detail }] }; else doc.sections[0].publishedFaq = { kind: "faq", layout: "split", id: "content", items: [] };
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(); expect(called).not.toHaveBeenCalled();
  });
});

describe("canonical media and copy refusal paths", () => {
  it.each(["relation-endpoint", "scene-format", "scene-tone", "key-target", "key-order", "record-owner", "record-flag", "record-label-budget", "scene-cite-budget", "part-id", "footnote-href", "treatment"])("rejects forged %s before Designer at its actual structural path", name => {
    const doc: any = structuredClone(resolve(band({ media: { type: "scene", label: ref("scene"), input: scenes.evidence } }))); const section = doc.sections[0];
    if (name === "relation-endpoint") section.media = { type: "scene", label: copy.scene, input: { ...resolve(band({ media: { type: "scene", label: ref("scene"), input: scenes.converge } })).sections[0]!.media!.input, relations: [{ from: {}, to: "one" }] } };
    if (name === "scene-format") section.media.input.sources[0].format = undefined;
    if (name === "scene-tone") section.media.input.result.status.tone = "accent";
    if (name === "scene-cite-budget") section.media.input.sources[0].cite = "A citation too long";
    if (name === "key-target" || name === "key-order" || name === "part-id") {
      section.media = structuredClone(resolve(band({ media: specimen })).sections[0]!.media);
      if (name === "part-id") section.media.panel.parts[0].id = {};
      else section.media.key = { label: copy.short, items: ["header", "fields", "footer"].map((target, index) => ({ id: `marker-${index}`, target, heading: copy.short, description: copy.detail })) };
      if (name === "key-target") section.media.key.items[1].target = "foreign";
      if (name === "key-order") section.media.key.items.reverse();
    }
    if (name.startsWith("record-")) {
      section.media = { type: "record", id: "record", columns: 1, head: { title: copy.short }, groups: [{ id: "one", label: copy.short, rows: [{ id: "first", label: copy.short }] }] };
      if (name === "record-owner") section.media.groups[0].owner = { initials: copy.initials, name: copy.owner };
      if (name === "record-flag") section.media.groups[0].rows[0].flag = true;
      if (name === "record-label-budget") section.media.groups[0].label = "x".repeat(25);
    }
    if (name === "footnote-href") section.footnote = { link: { label: copy.short, href: "javascript:alert(1)" } };
    if (name === "treatment") section.block = { ...structuredClone(resolve(band({ block: columns(2) })).sections[0]!.block), treatment: "sunken" };
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/sections\.0/); expect(called).not.toHaveBeenCalled();
  });
  it("retains precise nonzero section index and nested finding paths", () => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) }))); doc.sections.unshift({ id: "hero", kind: "hero", ground: "base", heading: copy.heading }); doc.sections[1].block.items[1].href = "/only-one";
    expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(/sections\.1\.block\.items/);
  });
  it("accepts optional undefined CopyRef metadata in genuine resolved provenance", () => {
    const doc = resolve(band({ block: columns(2) })); doc.resolutions[0]!.ref = { ...doc.resolutions[0]!.ref, locale: undefined, values: undefined };
    expect(() => html(doc)).not.toThrow();
  });
});

function approvalDocument(approvedBy: "owner" | "delegate") {
  const approvedRegistry: CopyRegistry = { ...registry, entries: registry.entries.map(entry => ({ ...entry, approval: { approvedBy, approvedAt: "2026-08-01T00:00:00.000Z", textFingerprint: computeCopyFingerprint(entry.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM, ...(approvedBy === "delegate" ? { delegate: { id: "editor", scope: ["example"] }, pendingOwnerReview: true } : {}) } })) };
  return resolveSectionedViewDocument({ id: "approval", sections: [band({ block: columns(2) })] }, createCopyResolver(approvedRegistry, { target: "preview", now: new Date("2026-09-27T00:00:00.000Z") }));
}
describe("resolved Writer approval metadata", () => {
  it.each(["owner", "delegate"] as const)("preserves genuine %s registry resolution approval", approvedBy => {
    const doc = approvalDocument(approvedBy); expect(doc.resolutions[0]!.approval).toEqual({ approvedBy, pendingOwnerReview: approvedBy === "delegate" });
    const before = JSON.stringify(doc); const original = doc.resolutions[0]; expect(() => html(doc)).not.toThrow(); expect(doc.resolutions[0]).toBe(original); expect(JSON.stringify(doc)).toBe(before);
  });
  it("accepts the delegate's existing optional plan metadata as shape-only provenance", () => {
    const doc = approvalDocument("delegate"); const approval = doc.resolutions[0]!.approval!;
    if (approval.approvedBy !== "delegate") throw new Error("Expected delegate resolution"); approval.authorizingPlanDigest = "example-digest"; expect(() => html(doc)).not.toThrow();
  });
  it.each(["owner-pending", "owner-extra", "delegate-pending", "delegate-digest", "getter"])("refuses malformed %s approval before Designer", name => {
    const doc: any = approvalDocument(name.startsWith("delegate") ? "delegate" : "owner"); const approval = doc.resolutions[0].approval; const called = vi.fn(); const getter = vi.fn(() => true);
    if (name === "owner-pending") approval.pendingOwnerReview = true;
    if (name === "owner-extra") approval.extra = true;
    if (name === "delegate-pending") approval.pendingOwnerReview = "yes";
    if (name === "delegate-digest") approval.authorizingPlanDigest = 3;
    if (name === "getter") Object.defineProperty(approval, "pendingOwnerReview", { enumerable: true, get: getter });
    expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(); expect(called).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });
});

describe("canonical LandingView integration", () => {
  it.each(["standard", "display"] as const)("gives the %s canonical frame sole ownership of vertical padding", size => {
    const authoredDoc: SectionedViewDocument = { id: "landing", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, band({ size, block: columns(2) })] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    const markup = renderToStaticMarkup(<LandingView document={doc} peek={false} />); expect(renderToStaticMarkup(<ServerLandingView document={doc} peek={false} />)).toBe(markup);
    const root = dom(markup); const inner = root.querySelector("#content")!; const outer = inner.closest("[data-landing-ground]")!;
    expect(["0", "0px"]).toContain(window.getComputedStyle(outer).paddingBlock);
    expect(inner.classList.contains(size === "display" ? "py-5xl" : "py-4xl")).toBe(true);
    expect(root.querySelectorAll("#content")).toHaveLength(1); expect(inner.parentElement?.closest("[data-content-section]")).toBeNull();
  });
  it("renders the published split FAQ through canonical LandingView collections", () => {
    const authoredDoc: SectionedViewDocument = { id: "landing-faq", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, { id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, items: ["one", "two", "three", "four"].map(id => ({ id, question: short, answer: ref("detail") })) }] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    for (const [View, server] of [[LandingView, false], [ServerLandingView, true]] as const) {
      const root = dom(renderToStaticMarkup(<View document={doc} peek={false} afterSection={{ faq: <p data-faq-after="">After FAQ</p> }} />));
      expect(root.querySelector("#faq")?.closest<HTMLElement>("[data-landing-ground]")?.style.paddingBlock).toBe("");
      expect(root.querySelectorAll(`#faq [data-items] ${server ? "summary" : "button"}`)).toHaveLength(4);
      expect(root.querySelector("#faq")?.textContent).toContain(copy.detail);
      expect(root.querySelector("#faq [data-content-section-modules]")?.lastElementChild?.hasAttribute("data-faq-after")).toBe(true);
    }
  });
});

const availableParts: SectionedViewSpecimenPart[] = [
  { ...field, columns: 2 },
  { id: "status", type: "status-rows", label: ref("short"), items: [{ id: "row", label: ref("field"), detail: ref("detail"), status: { tone: "info", label: ref("badge") } }] },
  { id: "meter", type: "meter", label: ref("short"), value: 40, scaleMax: 100, limit: 80, direction: "max", tone: "info", valueText: ref("measurement"), limitText: ref("limit"), note: ref("detail"), status: { tone: "success", label: ref("badge") } },
  { id: "table", type: "table", label: ref("short"), caption: ref("caption"), columns: [{ id: "name", label: ref("field") }, { id: "state", label: ref("badge") }], rows: [{ id: "row", cells: [{ text: ref("value") }, { status: { tone: "info", label: ref("badge") } }] }] },
  { id: "schedule", type: "schedule", label: ref("short"), items: [{ id: "row", date: ref("date"), label: ref("field"), amount: ref("amount"), status: { tone: "warning", label: ref("badge") } }] },
  { id: "shares", type: "shares", label: ref("short"), items: [{ id: "row", name: ref("owner"), share: 25, shareText: ref("share"), status: { tone: "success", label: ref("badge") } }] },
  { id: "files", type: "files", label: ref("short"), items: [{ id: "row", format: ref("format"), name: ref("owner"), source: ref("source") }] },
];
const partCases = availableParts.flatMap(part => ["media", "visual"].map(placement => ({ part, placement })));
function partDocument(part: SectionedViewSpecimenPart, placement: string) {
  return resolve(placement === "media" ? band({ media: { ...specimen, panel: { ...panel, meta: ref("meta"), status: { tone: "info", label: ref("badge") }, parts: [part] } } }) : band({ block: { type: "items", arrangement: "columns", columns: 2, items: [{ ...item("one"), meta: ref("meta"), badge: { label: ref("badge"), tone: "info" }, visual: part }, { ...item("two", "second"), visual: { ...part, id: `second-${part.id}` } }] } }));
}
const partCopyPaths = [
  ["fields", "items.0.value"], ["status-rows", "items.0.status.label"], ["meter", "valueText"], ["table", "rows.0.cells.0.text"],
  ["schedule", "items.0.date"], ["schedule", "items.0.amount"], ["shares", "items.0.shareText"], ["files", "items.0.format"], ["files", "items.0.source"],
] as const;
describe("all available specimen part copy", () => {
  it.each(partCases)("preserves genuine $part.type in $placement through both source entries", ({ part, placement }) => {
    const doc = partDocument(part, placement); const sections = doc.sections; const resolutions = doc.resolutions; const originals = [...resolutions]; const before = JSON.stringify(doc);
    const markup = html(doc); expect(html(doc, true)).toBe(markup);
    for (const resolution of resolutions) expect(markup).toContain(resolution.text);
    expect(doc.sections).toBe(sections); expect(doc.resolutions).toBe(resolutions); originals.forEach((resolution, index) => expect(doc.resolutions[index]).toBe(resolution)); expect(JSON.stringify(doc)).toBe(before);
  });
  it.each(partCopyPaths.flatMap(([type, fieldPath]) => ["media", "visual"].map(placement => ({ type, fieldPath, placement }))))("refuses unresolved $type copy at $fieldPath in $placement before Designer", ({ type, fieldPath, placement }) => {
    const part = availableParts.find(value => value.type === type)!; const doc: any = structuredClone(partDocument(part, placement));
    let parent = placement === "media" ? doc.sections[0].media.panel.parts[0] : doc.sections[0].block.items[0].visual;
    const keys = fieldPath.split("."); for (const key of keys.slice(0, -1)) parent = parent[key]; parent[keys[keys.length - 1]!] = ref("short");
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/sections\.0/); expect(called).not.toHaveBeenCalled();
    for (const server of [false, true]) expect(() => html(doc, server)).toThrow(/invalid resolved document/);
  });
  it.each([{ type: "constructor", placement: "media" }, { type: "toString", placement: "visual" }])("retains the core type refusal for unknown $type in $placement", ({ type, placement }) => {
    const doc: any = structuredClone(partDocument(availableParts[0]!, placement));
    const part = placement === "media" ? doc.sections[0].media.panel.parts[0] : doc.sections[0].block.items[0].visual; part.type = type;
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/sections\.0.*type.*not a specimen part type/); expect(called).not.toHaveBeenCalled();
  });
  it("keeps specimen file copy distinct from Scene formats and provenance source records", () => {
    const doc = partDocument(availableParts.find(part => part.type === "files")!, "media");
    const sceneDoc = resolve(band({ id: "scene", media: { type: "scene", label: ref("scene"), input: scenes.converge } })); doc.sections.push(...sceneDoc.sections); doc.resolutions.push(...sceneDoc.resolutions);
    const before = JSON.stringify(doc); const sources = doc.resolutions.map(resolution => resolution.source); const markup = html(doc); expect(html(doc, true)).toBe(markup);
    for (const value of [copy.format, copy.source, copy.scene]) expect(markup).toContain(value);
    sources.forEach((source, index) => expect(doc.resolutions[index]!.source).toBe(source)); expect(JSON.stringify(doc)).toBe(before);
  });
});

const longCopy = "Legitimate item copy exceeding the scene heading and metadata budgets";
const reviewResolver = createCopyResolver({ ...registry, entries: [...registry.entries, { id: "example.long", text: longCopy, context: "Renderer regression", status: "approved" }] });
function reviewDocument(sections: SectionedViewContentSection[]) {
  const doc: SectionedViewDocument = { id: "review", sections }; expect(validateSectionedViewDocument(doc).filter(f => f.severity === "error")).toEqual([]); return applyPalette(resolveSectionedViewDocument(doc, reviewResolver), sections);
}
function landingHtml(doc: ResolvedSectionedViewDocument, server = false) {
  const page = { ...doc, sections: [{ id: "hero", kind: "hero" as const, ground: "inverse" as const, heading: copy.heading }, ...doc.sections] };
  return renderToStaticMarkup(server ? <ServerLandingView document={page} peek={false} header="reserved" measure="prose" style={{ scrollPaddingTop: "var(--ui-height-site-header, 0px)" }} /> : <LandingView document={page} peek={false} header="reserved" measure="prose" style={{ scrollPaddingTop: "var(--ui-height-site-header, 0px)" }} />);
}
function expectCssZero(value: string) { expect(["0", "0px"]).toContain(value); }
function cssUtility(name: string) {
  const css = readFileSync("../designer/styles/compiled.css", "utf8"); const found = [...css.matchAll(/\.[\w-]+\s*\{[^{}]+\}/g)].find(match => match[0].slice(0, match[0].indexOf("{")).trim() === `.${name}`); expect(found, name).toBeDefined(); return found![0];
}
describe("canonical renderer review regressions", () => {
  it.each((["converge", "evidence", "approval"] as const).flatMap(name => (["heading", "meta"] as const).map(field => ({ name, field }))))("accepts long Items $field beside $name Scene through both entries", ({ name, field }) => {
    const block = { ...columns(2), items: [{ ...item("first"), [field]: { id: "example.long" } }, item("second", "second")] };
    const without = reviewDocument([band({ block })]); const withScene = reviewDocument([band({ block, media: { type: "scene", label: ref("scene"), input: scenes[name] } })]);
    for (const server of [false, true]) { expect(html(without, server)).toContain(longCopy); expect(html(withScene, server)).toContain(longCopy); expect(landingHtml(withScene, server)).toContain(longCopy); }
  });
  it.each(["converge", "evidence", "approval"] as const)("still refuses excessive $name Scene copy at the actual media path before Designer", name => {
    const doc: any = reviewDocument([band({ id: "before", block: columns(2) }), band({ block: columns(2), media: { type: "scene", label: ref("scene"), input: scenes[name] } })]);
    const input = doc.sections[1].media.input; let path: string;
    if (name === "converge") { input.sources.heading = longCopy; path = "media.input.sources.heading"; }
    else if (name === "evidence") { input.sources[0].title = longCopy; path = "media.input.sources.0.title"; }
    else { input.prepared.heading = longCopy; path = "media.input.prepared.heading"; }
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(`sections.1.${path}`); expect(called).not.toHaveBeenCalled();
    for (const server of [false, true]) expect(() => html(doc, server)).toThrow(`sections.1.${path}`);
  });
  it.each(["repeated", "concatenation"])("namespaces %s record instances without changing visible nodes or provenance", kind => {
    const ids = kind === "repeated" ? [["first-record", "record"], ["second-record", "record"]] : [["a-b", "c"], ["a", "b-c"]];
    const authored = ids.map(([id, mediaId], index) => band({ id: id!, media: { type: "record", id: mediaId!, columns: 2, head: { title: ref(index === 0 ? "first" : "second"), meta: ref("meta") }, caption: ref("detail"), groups: [{ id: "one", label: ref("group"), rows: [{ id: "row", label: ref("field"), detail: ref("detail") }] }, { id: "two", label: ref("group"), rows: [{ id: "row", label: ref("field"), detail: ref("detail") }] }] } }));
    const authoredBefore = JSON.stringify(authored); const doc = reviewDocument(authored); const before = JSON.stringify(doc); const resolutions = doc.resolutions; const originalResolutions = [...resolutions]; const originalSources = resolutions.map(value => value.source);
    for (const server of [false, true]) for (const view of ["section", "landing"]) {
      const render = (value: ResolvedSectionedViewDocument) => view === "section" ? html(value, server) : landingHtml(value, server);
      const root = dom(render(doc)); const allIds = [...root.querySelectorAll("[id]")].map(node => node.id); expect(new Set(allIds).size).toBe(allIds.length);
      const figures = [...root.querySelectorAll('figure[data-record-ledger]')]; expect(figures).toHaveLength(2);
      const reversed = dom(render({ ...doc, sections: [...doc.sections].reverse() }));
      for (const [sectionId] of ids) expect(reversed.querySelector(`[id="${sectionId}"] figure[data-record-ledger]`)?.id).toBe(root.querySelector(`[id="${sectionId}"] figure[data-record-ledger]`)?.id);
      figures.forEach((figure, index) => {
        expect(figure.querySelectorAll('[data-ledger-group]')).toHaveLength(2); expect(figure.textContent).toContain(index === 0 ? copy.first : copy.second);
        for (const named of [figure, ...figure.querySelectorAll('[aria-labelledby]')]) {
          const id = named.getAttribute("aria-labelledby"); const label = [...named.querySelectorAll("[id]")].find(node => node.id === id); expect(label).toBeDefined(); expect(label?.textContent?.trim()).not.toBe("");
          expect([...root.querySelectorAll("[id]")].filter(node => node.id === id)).toHaveLength(1);
        }
        for (const value of [copy.meta, copy.group, copy.field, copy.detail]) expect(figure.textContent).toContain(value);
      });
    }
    expect(JSON.stringify(doc)).toBe(before); expect(doc.resolutions).toBe(resolutions); expect(JSON.stringify(authored)).toBe(authoredBefore); originalResolutions.forEach((value, index) => { expect(doc.resolutions[index]).toBe(value); expect(doc.resolutions[index]!.source).toBe(originalSources[index]); });
  });
  it.each((["converge", "evidence", "approval"] as const).flatMap(name => ["section", "landing"].map(view => ({ name, view }))))("backs inverse $name Scene with semantic base tokens in $view through both entries", ({ name, view }) => {
    const doc = reviewDocument([band({ ground: "inverse", media: { type: "scene", label: ref("scene"), input: scenes[name] } })]); const before = JSON.stringify(doc);
    for (const server of [false, true]) {
      const root = dom(view === "landing" ? landingHtml(doc, server) : html(doc, server)); const scene = root.querySelector('.scene-root')!; const plate = scene.parentElement!;
      expect(plate.hasAttribute("data-scene-plate")).toBe(true); expect(plate.getAttribute("data-ground")).toBe("base");
      for (const cls of ["bg-surface-base", "text-ink-primary", "min-w-0", "w-full"]) expect(plate.classList.contains(cls)).toBe(true);
      expect(cssUtility("bg-surface-base")).toContain("var(--color-surface-base"); expect(cssUtility("text-ink-primary")).toContain("var(--color-ink-primary");
      expect(scene.classList.contains("scene-root")).toBe(true); expect(root.querySelectorAll('.scene-root')).toHaveLength(1); expect(scene.querySelector('[data-scene-linear]')).not.toBeNull();
      expect(plate.getAttribute("style") ?? "").not.toMatch(/#[a-f0-9]{3,8}|rgb|oklch/i); expect(root.textContent).toContain(copy.scene);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.each((["converge", "evidence", "approval"] as const).flatMap(name => (["base", "sunken"] as const).map(ground => ({ name, ground }))))("keeps $name Scene on $ground free of an added plate", ({ name, ground }) => {
    const doc = reviewDocument([band({ ground, media: { type: "scene", label: ref("scene"), input: scenes[name] } })]);
    const media = doc.sections[0]!.kind === "content-section" ? doc.sections[0].media : undefined; if (media?.type !== "scene") throw new Error("Expected scene media");
    const direct = dom(renderToStaticMarkup(<Scene id="7:content:5:scene" input={media.input} label={media.label} relationLabel={media.relationLabel} />)).querySelector(".scene-root")!.outerHTML;
    for (const server of [false, true]) { const root = dom(html(doc, server)); expect(root.querySelector("[data-scene-plate]")).toBeNull(); expect(root.querySelector('.scene-root')?.outerHTML).toBe(direct); expect(root.querySelector('.scene-root')?.textContent).toContain(copy.scene); }
  });
  it.each(["standard", "display"] as const)("aligns the %s canonical fragment with its zero-padding outer band", size => {
    const doc = reviewDocument([band({ size, block: columns(2) })]);
    for (const server of [false, true]) {
      const root = dom(landingHtml(doc, server)); const inner = root.querySelector<HTMLElement>("#content")!; const outer = inner.closest<HTMLElement>("[data-landing-ground]")!;
      expectCssZero(inner.style.scrollMarginTop); expect(inner.className).not.toContain("scroll-mt-4xl"); expect(inner.className).not.toContain("scroll-mt-5xl");
      expectCssZero(outer.style.paddingBlock); expect(inner.className).toContain(size === "display" ? "py-5xl" : "py-4xl");
      expect(inner.parentElement?.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)"); expect(inner.parentElement?.style.paddingInline).toBe("var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))");
      expect(root.querySelector('[data-landing-hero]')?.className).toContain("py-4xl"); expect(root.querySelector<HTMLElement>('[data-landing-view]')?.style.scrollPaddingTop).toBe("var(--ui-height-site-header, 0px)");
    }
  });
  it("retains legacy FAQ fragment offsets and band measure for both entries", () => {
    const authored: SectionedViewDocument = { id: "legacy-anchors", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: short }, { id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, items: ["one", "two", "three", "four"].map(id => ({ id, question: short, answer: ref("detail") })) }, { id: "features", kind: "feature-grid", ground: "base", heading: short, items: [item("first"), item("second", "second")] }] };
    expect(validateSectionedViewDocument(authored)).toEqual([]); const doc = resolveSectionedViewDocument(authored, resolver);
    for (const server of [false, true]) {
      const root = dom(renderToStaticMarkup(server ? <ServerLandingView document={doc} peek={false} header="reserved" measure="prose" /> : <LandingView document={doc} peek={false} header="reserved" measure="prose" />));
      for (const id of ["faq", "features"]) { const inner = root.querySelector<HTMLElement>(`#${id}`)!; expect(inner.className).toContain("scroll-mt-4xl"); expect(inner.className).toContain("tablet-lg:scroll-mt-5xl"); expect(inner.style.scrollMarginTop).toBe(""); expect(inner.closest<HTMLElement>("[data-landing-ground]")?.style.paddingBlock).toBe(""); }
    }
  });
});


describe("canonical matrix and specimen metadata integration", () => {
  function matrix(part?: SectionedViewSpecimenPart, points = true): SectionedViewContentSection {
    return band({ block: { type: "matrix", featured: "right", sides: ["left", "right"].map(id => ({ id, label: ref(id === "left" ? "short" : "group"), heading: ref(id === "left" ? "first" : "second"), description: ref(id === "left" ? "detail" : "meta"), ...(part ? { visual: { ...panel, id: `${id}-panel`, meta: ref("meta"), status: { tone: "warning", label: ref("field") }, badge: { tone: "info", label: ref("badge") }, parts: [{ ...part, id: `${id}-${part.id}` }] } } : points ? { points: [ref(id === "left" ? "first" : "second"), ref(id === "left" ? "detail" : "meta")] } : {}) })) } });
  }
  function preserve(doc: ResolvedSectionedViewDocument) {
    const before = JSON.stringify(doc); const sections = doc.sections; const resolutions = doc.resolutions; const originals = [...resolutions]; const sources = resolutions.map(value => value.source);
    const markup = html(doc); expect(html(doc, true)).toBe(markup);
    expect(doc.sections).toBe(sections); expect(doc.resolutions).toBe(resolutions); originals.forEach((value, index) => { expect(doc.resolutions[index]).toBe(value); expect(doc.resolutions[index]!.source).toBe(sources[index]); }); expect(JSON.stringify(doc)).toBe(before);
    return dom(markup);
  }
  it.each(["base", "sunken", "inverse"] as const)("forwards points Matrix identity, feature and %s ground", ground => {
    const doc = resolve({ ...matrix(), ground }); const root = preserve(doc);
    expect([...root.querySelectorAll("[data-matrix-side]")].map(node => node.getAttribute("data-matrix-side"))).toEqual(["side-0063006f006e00740065006e0074-006c006500660074", "side-0063006f006e00740065006e0074-00720069006700680074"]);
    expect(root.querySelectorAll('[data-matrix-side]')[1]!.querySelector('[data-featured="true"]')).not.toBeNull(); expect(root.querySelectorAll("h3")).toHaveLength(2); const matrixRoot=root.querySelector("[data-matrix]")!;expect(matrixRoot.hasAttribute("aria-labelledby")).toBe(false);expect(root.querySelectorAll('[id="content:heading"]')).toHaveLength(1);expect(root.querySelector('[id="content:heading"]')?.textContent).toBe(copy.heading);
    const sides = [...root.querySelectorAll("[data-matrix-side]")]; sides.forEach((side, index) => { expect(side.querySelector("h3")?.textContent).toBe(index === 0 ? copy.first : copy.second); expect(side.textContent).toContain(index === 0 ? copy.first : copy.second); expect(side.textContent).toContain(index === 0 ? copy.detail : copy.meta); const plate = side.querySelector('[data-variant="plate"]')!; expect(plate.classList.contains(ground === "base" ? "bg-surface-sunken" : ground === "sunken" ? "bg-surface-raised" : "bg-surface-inverse-raised")).toBe(true); expect(side.querySelector("h3")!.classList.contains(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary")).toBe(true); });
  });
  it.each(["points", "visual"] as const)("renders unlabeled Matrix %s headings and retained featured identity through both views", form => {
    const section = matrix(form === "visual" ? field : undefined);
    if (section.block?.type !== "matrix") throw new Error("Expected Matrix");
    for (const side of section.block.sides) delete side.label;
    const doc = resolve(section); const before = JSON.stringify(doc); const resolutions = doc.resolutions;
    for (const server of [false, true]) for (const markup of [html(doc, server), landingHtml(doc, server)]) {
      const root = dom(markup); const sides = [...root.querySelectorAll("[data-matrix-side]")];
      expect(sides).toHaveLength(2);
      expect(sides.map(side => side.querySelector("h3")?.textContent)).toEqual([copy.first, copy.second]);
      for (const side of sides) { expect(side.querySelectorAll("h3")).toHaveLength(1); expect(side.querySelector("h3")!.classList.contains("text-h2")).toBe(true); }
      expect(sides[0]!.querySelector("[data-featured]")).toBeNull(); expect(sides[1]!.querySelector('[data-featured="true"]')).not.toBeNull();
      expect([...root.querySelectorAll("[data-matrix-description]")].map(node => node.textContent)).toEqual([copy.detail, copy.meta]);
      expect(root.querySelectorAll(form === "visual" ? "[data-matrix-visual] figure" : "[data-matrix] li")).toHaveLength(form === "visual" ? 2 : 4);
    }
    expect(JSON.stringify(doc)).toBe(before); expect(doc.resolutions).toBe(resolutions);
  });
  it.each((["points", "visual"] as const).flatMap(form => [0, 1].map(unlabeledSide => ({ form, unlabeledSide }))))("refuses forged mixed labels on $form side $unlabeledSide before the adapter", ({ form, unlabeledSide }) => {
    const doc: any = structuredClone(resolve(matrix(form === "visual" ? field : undefined)));
    delete doc.sections[0].block.sides[unlabeledSide].label;
    const called = vi.fn();
    expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/Both sides must have labels or neither/);
    expect(called).not.toHaveBeenCalled();
    for (const server of [false, true]) {
      expect(() => html(doc, server)).toThrow(/Both sides must have labels or neither/);
      expect(() => landingHtml(doc, server)).toThrow(/Both sides must have labels or neither/);
    }
  });
  it("refuses a forged description-only Matrix before either rendering entry invokes the adapter", () => {
    const doc: any = structuredClone(resolve(matrix()));
    for (const side of doc.sections[0].block.sides) delete side.points;
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/points or visual/); expect(called).not.toHaveBeenCalled();
    for (const server of [false, true]) expect(() => html(doc, server)).toThrow(/points or visual/);
  });
  it("keeps the section heading without labelling a generic Matrix div", () => { const root = preserve(resolve(matrix())); const collection = root.querySelector("[data-matrix]")!; expect(collection.tagName).toBe("DIV"); expect(collection.hasAttribute("aria-labelledby")).toBe(false); expect(root.querySelector('[id="content:heading"]')?.textContent).toBe(copy.heading); });
  it("renders equal point rows and descriptions without dropping either", () => { const root = preserve(resolve(matrix(undefined, true))); expect(root.querySelectorAll("[data-matrix] li")).toHaveLength(4); [...root.querySelectorAll("[data-matrix-side]")].forEach((side, index) => { expect([...side.querySelectorAll("li")].map(node => node.textContent)).toEqual(index === 0 ? [copy.first, copy.detail] : [copy.second, copy.meta]); expect(side.textContent).toContain(index === 0 ? copy.detail : copy.meta); expect(side.querySelectorAll("p")[1]?.textContent).toBe(index === 0 ? copy.detail : copy.meta); }); });
  it.each(availableParts)("projects and renders Matrix $type visuals losslessly", part => {
    const doc = resolve(matrix(part)); const root = preserve(doc); expect(root.querySelectorAll("[data-matrix-side] figure")).toHaveLength(2); [...root.querySelectorAll("[data-matrix-side]")].forEach((side, index) => { expect(side.querySelectorAll("p")[1]?.textContent).toBe(index === 0 ? copy.detail : copy.meta); expect(side.textContent).toContain(index === 0 ? copy.first : copy.second); });
    doc.resolutions.forEach(value => expect(root.textContent).toContain(value.text));
  });
  it.each(partCopyPaths)("refuses unresolved Matrix %s %s at the original side path", (type, fieldPath) => {
    const doc: any = structuredClone(resolve(matrix(availableParts.find(value => value.type === type)!))); let parent = doc.sections[0].block.sides[0].visual.parts[0]; const keys = fieldPath.split("."); for (const key of keys.slice(0, -1)) parent = parent[key]; parent[keys.at(-1)!] = short;
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/sections\.0\.block\.sides\.0\.visual\.parts\.0/); expect(called).not.toHaveBeenCalled(); for (const server of [false, true]) expect(() => html(doc, server)).toThrow(/invalid resolved document/);
  });
  it.each(["badge-tone", "badge-copy", "mobile-limit", "orphan-previous", "foreign-featured"])("refuses forged available %s before Designer", name => {
    const part: SectionedViewSpecimenPart = { id: "meter", type: "meter", label: short, tone: "info", value: 40, scaleMax: 100, valueText: ref("measurement"), previous: 30, previousText: ref("amount") };
    const section = name === "foreign-featured" ? matrix() : band({ media: { ...specimen, panel: { ...panel, badge: { label: ref("badge"), tone: "info" }, parts: name === "mobile-limit" ? [{ id: "rows", type: "status-rows", mobileRows: 3, items: [{ id: "row", label: ref("field"), status: { tone: "info", label: ref("badge") } }] }] : [part] } } });
    const doc: any = structuredClone(resolve(section)); if (name === "foreign-featured") doc.sections[0].block.featured = "foreign"; else { const panel = doc.sections[0].media.panel; if (name === "badge-tone") panel.badge.tone = "accent"; if (name === "badge-copy") panel.badge.label = ref("badge"); if (name === "mobile-limit") panel.parts[0].mobileRows = 4; if (name === "orphan-previous") delete panel.parts[0].previousText; }
    const called = vi.fn(); expect(() => renderSectionedViewSections(doc, { ...sectionedViewBlocks, ContentSection: called }, {})).toThrow(/sections\.0/); expect(called).not.toHaveBeenCalled(); for (const server of [false, true]) expect(() => html(doc, server)).toThrow(/invalid resolved document/);
  });
  it("preserves whitespace and UTF-16 Matrix IDs through injective presentation namespaces", () => {
    for (const ids of [["left side", "left-side"], ["\ud800", "\ud801"]]) {
      const section = matrix(); if (section.block?.type !== "matrix") throw new Error("Expected Matrix"); section.block.sides[0]!.id = ids[0]!; section.block.sides[1]!.id = ids[1]!; section.block.featured = ids[0]; const doc = resolve(section); const before = JSON.stringify(doc); const resolutions = doc.resolutions;
      expect(() => assertRenderableSectionedViewDocument(doc)).not.toThrow();
      for (const server of [false, true]) {
        const root = dom(html(doc, server)); const sides = [...root.querySelectorAll("[data-matrix-side]")]; expect(sides).toHaveLength(2);
        const adapted = sides.map(side => side.getAttribute("data-matrix-side")); expect(new Set(adapted).size).toBe(2); adapted.forEach(id => expect(id).not.toMatch(/\s/));
        expect(sides[0]!.querySelector('[data-featured="true"]')).not.toBeNull(); expect(sides[1]!.querySelector('[data-featured="true"]')).toBeNull();
        expect(root.textContent).toContain(copy.first); expect(root.textContent).toContain(copy.second);
      }
      expect(JSON.stringify(doc)).toBe(before); expect(doc.resolutions).toBe(resolutions);
    }
  });
  it.each(["neutral", "success", "warning", "danger", "info"] as const)("passes panel %s badge independently of metadata and status", tone => {
    const doc = resolve(band({ media: { ...specimen, panel: { ...panel, meta: ref("meta"), status: { tone: "warning", label: ref("field") }, badge: { tone, label: ref("badge") } } } })); const root = preserve(doc);
    for (const text of [copy.meta, copy.field, copy.badge, copy.panel, copy.owner]) expect(root.textContent).toContain(text); const badge = [...root.querySelectorAll("[data-specimen-panel-header] span")].find(node => node.textContent === copy.badge && node.classList.contains("text-caption")); expect(badge).toBeDefined(); expect(badge!.classList.contains(tone === "neutral" ? "bg-surface-sunken" : `bg-status-${tone}-tint`)).toBe(true); if (tone !== "neutral") expect(badge!.parentElement!.classList.contains("bg-surface-base")).toBe(true);
  });
  it("forwards status-row mobile limits while retaining every authored row", () => {
    const doc = resolve(band({ media: { ...specimen, panel: { ...panel, parts: [{ id: "rows", type: "status-rows", mobileRows: 3, items: ["first", "second", "third", "fourth"].map(id => ({ id, label: ref(id as "first" | "second" | "third" | "fourth"), detail: ref("detail"), status: { tone: "info", label: ref("badge") } })) }] } } })); const root = preserve(doc); const rows = root.querySelectorAll("figure li"); expect(rows).toHaveLength(4); expect(rows[2]!.classList.contains("max-tablet:hidden")).toBe(false); expect(rows[3]!.classList.contains("max-tablet:hidden")).toBe(true); expect(rows[3]!.textContent).toContain(copy.fourth);
  });
  it.each([0, 100])("forwards previous Meter marker %i and its visible text with unchanged value/limit domain", previous => {
    const doc = resolve(band({ media: { ...specimen, panel: { ...panel, parts: [{ id: "meter", type: "meter", label: short, tone: "info", value: 140, limit: 180, scaleMax: 100, valueText: ref("measurement"), limitText: ref("limit"), previous, previousText: ref("amount") }] } } })); const root = preserve(doc); const marker = root.querySelector<HTMLElement>('[data-part="previous"]')!; expect(marker).not.toBeNull(); expect(marker.style.insetInlineStart).toContain(`${previous}%`); expect(root.textContent).toContain(copy.amount); expect(root.textContent).toContain(copy.measurement); expect(root.textContent).toContain(copy.limit);
  });
});


describe("media DOM identity namespace", () => {
  it.each(["scene", "specimen"] as const)("keeps %s labels separate from valid section fragments through both entries", kind => {
    const targets = kind === "scene" ? ["intro-scene-label"] : ["intro-specimen-label", "intro-specimen-key", "intro-specimen-key-name"];
    const media: SectionedViewMedia = kind === "scene" ? { type: "scene", label: ref("scene"), input: scenes.converge } : { ...specimen, key: { label: short, items: ["header", "fields", "footer"].map((target, index) => ({ id: `marker-${index}`, target, heading: short, description: ref("detail") })) } };
    const authored: SectionedViewDocument = { id: "namespaced-media", sections: [band({ id: "intro", media }), ...targets.map(id => band({ id, block: columns(2), footnote: { link: { label: ref("link"), href: `#${id}` } } }))] };
    expect(validateSectionedViewDocument(authored).filter(f => f.severity === "error")).toEqual([]);
    const resolved = resolveSectionedViewDocument(authored, resolver); const before = JSON.stringify(resolved); const resolutions = resolved.resolutions;
    for (const ordered of [resolved, { ...resolved, sections: [...resolved.sections].reverse() }]) for (const server of [false, true]) for (const markup of [html(ordered, server), landingHtml(ordered, server)]) {
      const root = dom(markup); const ids = [...root.querySelectorAll("[id]")].map(node => node.id);
      expect(new Set(ids).size, "unique DOM IDs").toBe(ids.length);
      for (const target of targets) { const matching = [...root.querySelectorAll("[id]")].filter(node => node.id === target); expect(matching).toHaveLength(1); expect(matching[0]?.matches("[data-content-section]")).toBe(true); expect(root.querySelector(`a[href="#${target}"]`)).not.toBeNull(); }
      for (const node of root.querySelectorAll("[aria-labelledby]")) for (const id of node.getAttribute("aria-labelledby")!.split(/\s+/)) expect([...root.querySelectorAll("[id]")].filter(candidate => candidate.id === id)).toHaveLength(1);
      expect(root.textContent).toContain(copy.heading); expect(root.textContent).toContain(kind === "scene" ? copy.short : copy.value);
    }
    expect(resolved.resolutions).toBe(resolutions); expect(JSON.stringify(resolved)).toBe(before);
  });
});


describe("automatic canonical body grounds", () => {
  const page = (count: number, inverse = false) => resolveSectionedViewDocument({ id: "automatic", sectionGroundRhythm: "view", sections: [
    { id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") },
    ...Array.from({ length: count }, (_, index) => ({ id: `body-${index}`, kind: "content-section" as const, layout: "split-start" as const, heading: ref("heading"), ...(inverse && index === count - 1 ? { ground: "inverse" as const } : {}), block: { ...columns(2), treatment: "plate" as const }, actions: [{ id: "read", label: ref("link"), href: `/body-${index}`, emphasis: "quiet" as const }], footnote: { text: ref("detail") } })),
  ] }, resolver);
  it.each(Array.from({ length: 8 }, (_, count) => count))("plans %i automatic body bands equally through both render paths", count => {
    const doc = page(count); const before = JSON.stringify(doc);
    const expected = Array.from({ length: count }, (_, index) => (count - index - 1) % 2 === 0 ? "base" : "sunken");
    for (const server of [false, true]) for (const close of [false, true]) {
      const View = server ? ServerLandingView : LandingView;
      const root = dom(renderToStaticMarkup(<View document={doc} callToAction={close ? { heading: "Close", action: <a href="/close">Close</a> } : undefined} afterSection={count ? { "body-0": <span>Nested content</span> } : undefined} />));
      const generic = dom(html(doc, server));
      expected.forEach((ground, index) => {
        const outer = root.querySelector(`#body-${index}`)!.closest("[data-landing-ground]")!;
        expect(outer.getAttribute("data-landing-ground")).toBe(ground);
        expect(outer.classList.contains("bg-surface-sunken")).toBe(ground === "sunken");
        expect(outer.classList.contains("bg-surface-inverse")).toBe(false);
        const ordinary = generic.querySelector(`#body-${index}`)!;
        expect(ordinary.classList.contains("bg-surface-sunken")).toBe(ground === "sunken");
        expect(ordinary.classList.contains("bg-surface-inverse")).toBe(false);
        for (const host of [ordinary, root.querySelector(`#body-${index}`)!]) {
          expect(host.querySelector("h2")!.classList.contains("text-ink-primary")).toBe(true);
          expect(host.querySelector('[data-item][data-variant="plate"]')!.classList.contains(ground === "base" ? "bg-surface-sunken" : "bg-surface-raised")).toBe(true);
          expect(host.querySelector('a[href="/body-' + index + '"]')!.classList.contains("text-control-quiet")).toBe(true);
          expect(host.querySelector("[data-content-section-footnote]")?.classList.contains("text-ink-secondary")).toBe(true);
        }
      });
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("keeps canonical final inverse as the cadence anchor through CTA close", () => {
    const doc = page(3, true);
    for (const View of [LandingView, ServerLandingView]) {
      const root = dom(renderToStaticMarkup(<View document={doc} callToAction={{ heading: "Close", action: <a href="/close">Close</a> }} />));
      expect([0, 1, 2].map(index => root.querySelector(`#body-${index}`)!.closest("[data-landing-ground]")!.getAttribute("data-landing-ground"))).toEqual(["sunken", "base", "inverse"]);
    }
  });
});


describe("canonical automatic ground seams", () => {
  const automatic = (id: string): SectionedViewContentSection => ({ id, kind: "content-section", heading: ref("heading"), block: columns(2) });
  it("resolves canonical omitted grounds without document rhythm and keeps the source provenance", () => {
    const authored: SectionedViewDocument = { id: "automatic-default", sections: [automatic("first-band"), automatic("last-band")] };
    const source = JSON.stringify(authored);
    expect(validateSectionedViewDocument(authored).filter(f => f.severity === "error")).toEqual([]);
    const resolved = resolveSectionedViewDocument(authored, resolver);
    expect(resolved.viewGrounds).toEqual(["first-band", "last-band"]);
    for (const server of [false, true]) {
      const root = dom(html(resolved, server));
      expect(root.querySelector("#first-band")!.classList.contains("bg-surface-sunken")).toBe(true);
      expect(root.querySelector("#last-band")!.classList.contains("bg-surface-sunken")).toBe(false);
    }
    expect(JSON.stringify(authored)).toBe(source);
    const forged: any = structuredClone(resolved); forged.sections[0].block.columns = 1;
    for (const server of [false, true]) expect(() => html(forged, server)).toThrow(/columns/);
  });
  it.each([false, true])("keeps mixed trailing-document cadence continuous with CTA=%s", close => {
    const primary = resolveSectionedViewDocument({ id: "mixed", sectionGroundRhythm: "view", sections: [
      { id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, automatic("first-band"),
      { id: "legacy", kind: "feature-grid", heading: ref("heading"), items: [item("one"), item("two", "second")] },
    ] }, resolver);
    const tail = resolveSectionedViewDocument({ id: "tail", sectionGroundRhythm: "view", sections: [
      { id: "tail-hero", kind: "hero", heading: ref("heading") }, automatic("last-band"),
    ] }, resolver);
    const plan = planLandingViewGrounds(primary, [tail], { callToAction: close });
    const expected = ["inverse", "sunken", "base", "sunken", "base", ...(close ? ["inverse"] : [])];
    expect(plan.bands.map(band => band.ground)).toEqual(expected); expect(plan.repeats).toEqual([]);
    for (const View of [LandingView, ServerLandingView]) {
      const root = dom(renderToStaticMarkup(<View document={primary} trailing={[tail]} callToAction={close ? { heading: "Close", action: <a href="/close">Close</a> } : undefined} />));
      expect([...root.querySelectorAll("[data-landing-ground]")].map(node => node.getAttribute("data-landing-ground"))).toEqual(expected);
      expect(root.querySelectorAll("h1")).toHaveLength(1);
    }
    const legacyTail = { ...tail, sections: [{ id: "last-legacy", kind: "hero" as const, ground: "inverse" as const, heading: copy.heading }], viewGrounds: [] };
    expect(planLandingViewGrounds(primary, [legacyTail], { callToAction: true }).bands.find(band => band.id === "last-legacy")!.ground).toBe("base");
  });
  it("keeps document-local eligibility when duplicate IDs are refused by Landing", () => {
    const primary = resolveSectionedViewDocument({ id: "duplicate-primary", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, automatic("shared-band")] }, resolver);
    const explicit = resolveSectionedViewDocument({ id: "duplicate-tail", sections: [{ ...automatic("shared-band"), ground: "inverse" }] }, resolver);
    expect(primary.viewGrounds).toEqual(["shared-band"]); expect(explicit.viewGrounds).toBeUndefined();
    expect(planLandingViewGrounds(primary, [explicit]).bands.map(({ ground, assigned }) => ({ ground, assigned }))).toEqual([{ ground: "inverse", assigned: false }, { ground: "base", assigned: true }, { ground: "inverse", assigned: false }]);
    for (const View of [LandingView, ServerLandingView]) expect(() => renderToStaticMarkup(<View document={primary} trailing={[explicit]} />)).toThrow(/earlier document already rendered that id/);
    const overridden = { ...primary, sections: primary.sections.map(section => section.kind === "content-section" ? { ...section, ground: "inverse" as const } : section) };
    expect(planLandingViewGrounds(overridden).bands.at(-1)).toMatchObject({ ground: "base", assigned: true });
    expect(planLandingViewGrounds({ ...overridden, viewGrounds: [] }).bands.at(-1)).toMatchObject({ ground: "inverse", assigned: false });
  });
  it("sends one planned ground to specimen key, header, action and footnote", () => {
    const keyMedia = { ...specimen, key: { label: ref("short"), items: ["header", "fields", "footer"].map((target, index) => ({ id: `mark-${index}`, target, heading: ref("short"), description: ref("detail") })) } };
    const authored: SectionedViewDocument = { id: "grounded-key", sectionGroundRhythm: "view", sections: [
      { id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") },
      { ...automatic("key-band"), layout: "split-start", media: keyMedia, actions: [{ id: "go", label: ref("link"), href: "/go", emphasis: "quiet" }], footnote: { text: ref("detail") } }, automatic("last-band"),
    ] };
    const doc = resolveSectionedViewDocument(authored, resolver);
    for (const server of [false, true]) for (const view of ["section", "landing"]) {
      const View = server ? ServerLandingView : LandingView;
      const root = dom(view === "section" ? html(doc, server) : renderToStaticMarkup(<View document={doc} />));
      const band = root.querySelector("#key-band")!;
      expect(band.querySelector("[data-anatomy-key-number]")!.classList.contains("text-surface-sunken")).toBe(true);
      expect(band.querySelector("[data-anatomy-callouts]")!.getAttribute("data-legend-side")).toBe("below");
      expect(band.querySelector("h2")!.classList.contains("text-ink-primary")).toBe(true);
      expect(band.querySelector('a[href="/go"]')!.classList.contains("text-control-quiet")).toBe(true);
      expect(band.querySelector("[data-content-section-footnote]")!.classList.contains("text-ink-secondary")).toBe(true);
    }
  });
});


it("plans every retained top-level body kind across a document seam", () => {
  const inherited = resolveSectionedViewDocument(previewSectionedDocument, previewCopyResolver);
  const canonical = resolve(band({ id: "canonical-band", block: columns(2) }));
  const sections = [...inherited.sections.slice(0, 4), canonical.sections[0]!, ...inherited.sections.slice(4)].map(section => ({ ...section, ground: section.kind === "hero" ? "inverse" as const : "base" as const }));
  const combined = { ...inherited, sections, resolutions: [...inherited.resolutions, ...canonical.resolutions], viewGrounds: sections.slice(1).map(section => section.id) };
  const primary = { ...combined, sections: sections.slice(0, 6), viewGrounds: sections.slice(1, 6).map(section => section.id) };
  const tail = { ...combined, id: "all-kind-tail", sections: sections.slice(6), viewGrounds: sections.slice(6).map(section => section.id) };
  const body = sections.slice(1), expected = body.map((_, index) => (body.length - index - 1) % 2 ? "sunken" : "base");
  for (const server of [false, true]) {
    const generic = dom(html(combined, server));
    body.forEach((section, index) => expect(generic.querySelector(`#${section.id}`)!.classList.contains("bg-surface-sunken")).toBe(expected[index] === "sunken"));
    for (const close of [false, true]) {
      const View = server ? ServerLandingView : LandingView;
      const root = dom(renderToStaticMarkup(<View document={primary} trailing={[tail]} callToAction={close ? { heading: "Close", action: <a href="/close">Close</a> } : undefined} />));
      expect([...root.querySelectorAll("[data-landing-ground]")].map(node => node.getAttribute("data-landing-ground"))).toEqual(["inverse", ...expected, ...(close ? ["inverse"] : [])]);
      expect(planLandingViewGrounds(primary, [tail], { callToAction: close }).bands.map(band => band.ground)).toEqual(["inverse", ...expected, ...(close ? ["inverse"] : [])]);
    }
  }
});


it("excludes an automatic initial Hero from body cadence", () => {
  const authored: SectionedViewDocument = { id: "automatic-hero", sectionGroundRhythm: "view", sections: [
    { id: "hero", kind: "hero", heading: ref("heading") }, ...[0, 1, 2].map(index => ({ id: `body-${index}`, kind: "content-section" as const, heading: ref("heading"), block: columns(2) })),
  ] };
  const doc = resolveSectionedViewDocument(authored, resolver);
  expect(planLandingViewGrounds(doc).bands.map(band => ({ ground: band.ground, assigned: band.assigned }))).toEqual([{ ground: "base", assigned: false }, { ground: "base", assigned: true }, { ground: "sunken", assigned: true }, { ground: "base", assigned: true }]);
  for (const View of [LandingView, ServerLandingView]) expect(dom(renderToStaticMarkup(<View document={doc} />)).querySelector('[data-landing-hero]')!.classList.contains("bg-surface-sunken")).toBe(false);
});
