// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { Scene } from "@clossys/designer/blocks/server";
import { createCopyResolver, computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewContentSection, type SectionedViewDocument, type SectionedViewItemsBlock, type ResolvedSectionedViewDocument, type SectionedViewMedia, type SectionedViewSpecimenPart } from "../../core/sectioned-view.js";
import { previewSectionedDocument, previewCopyResolver } from "../../preview/fixture-documents.js";
import { LandingView } from "./LandingView.js";
import { LandingView as ServerLandingView } from "../server.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { assertRenderableSectionedViewDocument, renderSectionedViewSections } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";
const copy = { date: "Oct 11", amount: "40 units", share: "25 percent", format: "PDF", source: "Public archive", measurement: "40 of 100", limit: "80 units", caption: "Sample table", heading: "Example section", first: "First item", second: "Second item", third: "Third item", fourth: "Fourth item", detail: "A short description.", meta: "Example metadata", badge: "Ready", eyebrow: "Example eyebrow", group: "Example group", panel: "Example panel", field: "Field", value: "Value", initials: "AB", owner: "Example owner", label: "A sample panel with labeled fields and a visible footer.", scene: "Sample documents connect to one result with labeled rows and clear relationships for review.", short: "Example", link: "Read more" };
const ref = (key: keyof typeof copy) => ({ id: `example.${key}` });
const registry = { id: "canonical-render", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(copy).map(([key, text]) => ({ id: `example.${key}`, text, context: "Canonical renderer test", status: "approved" })) } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const item = (id: string, heading: keyof typeof copy = "first") => ({ id, heading: ref(heading), description: ref("detail") });
const field = { id: "fields", type: "fields" as const, label: ref("field"), items: [{ id: "field", label: ref("field"), value: ref("value") }] };
const panel = { id: "panel", title: ref("panel"), parts: [field], footer: { assignee: { initials: ref("initials"), name: ref("owner") }, note: ref("detail") } };
const specimen = { type: "specimen" as const, label: ref("label"), panel };
const band = (fields: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({ id: "content", kind: "content-section", ground: "base", heading: ref("heading"), ...fields });
function resolve(section: SectionedViewContentSection) { const document: SectionedViewDocument = { id: "canonical", sections: [section] }; expect(validateSectionedViewDocument(document).filter(f => f.severity === "error")).toEqual([]); return resolveSectionedViewDocument(document, resolver); }
function html(document: ResolvedSectionedViewDocument, server = false) { return renderToStaticMarkup(server ? <ServerSectionedView document={document} /> : <SectionedView document={document} />); }
function dom(markup: string) { const root = document.createElement("div"); root.innerHTML = markup; return root; }
const columns = (count: 2 | 3): SectionedViewItemsBlock => ({ type: "items", arrangement: "columns", columns: count, items: [item("first"), item("second", "second"), ...(count === 3 ? [item("third", "third")] : [])] });
describe("canonical available renderer", () => {
  it.each([2, 3] as const)("renders actual unordered Items with %i columns through both entries", count => {
    const section = band({ block: columns(count) }); const resolved = resolve(section);
    const markup = html(resolved); expect(html(resolved, true)).toBe(markup);
    const root = dom(markup); expect(root.querySelector("h2")?.textContent).toBe(copy.heading); expect(root.querySelectorAll("h3").length).toBe(count);
    expect(root.querySelector("[data-items]")?.getAttribute("data-arrangement")).toBe("columns");
    expect(root.textContent).toContain(copy.detail);
    const recipe = resolve(band({ block: { ...columns(count), recipe: "features" } })); expect(html(recipe)).toBe(markup);
  });
  it.each(["compact", "standard", "display"] as const)("forwards frame and collection scale %s", size => {
    const root = dom(html(resolve(band({ size, block: columns(2) }))));
    expect(root.querySelector("[data-content-section]")?.classList.contains(size === "compact" ? "py-3xl" : size === "display" ? "py-5xl" : "py-4xl")).toBe(true);
    expect(root.querySelector("[data-item-heading]")?.classList.contains(size === "display" ? "text-h3" : "text-body-l")).toBe(true);
  });
  it.each(["split-start", "split-end"] as const)("keeps %s directions, actions and link-only footnote", layout => {
    const root = dom(html(resolve(band({ layout, block: columns(2), actions: [{ id: "start", label: ref("link"), href: "/start", emphasis: "tertiary" }], footnote: { link: { label: ref("link"), href: "/more" } } }))));
    expect(root.querySelector("[data-content-section]")?.getAttribute("data-layout")).toBe(layout);
    expect([...root.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/start", "/more"]);
    expect(root.textContent).not.toContain("undefined");
  });
  it("preserves item slots, independent badge/meta and bento span", () => {
    const root = dom(html(resolve(band({ block: { type: "items", arrangement: "bento", treatment: "plate", items: [{ ...item("first"), span: "half", featured: true, eyebrow: ref("eyebrow"), meta: ref("meta"), badge: { label: ref("badge"), tone: "success" }, visual: field }, { ...item("second", "second"), span: "half" }] } }))));
    for (const value of [copy.eyebrow, copy.meta, copy.badge, copy.field, copy.value]) expect(root.textContent).toContain(value);
    expect(root.querySelector('[data-featured="true"]')).not.toBeNull(); expect(root.querySelectorAll('[data-span="half"]').length).toBe(2);
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
  it.each(["size", "layout", "arrangement", "order", "reveal", "treatment", "emphasis", "columns"])("refuses missing resolved %s before default repair", key => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) })));
    const target = key === "size" || key === "layout" ? doc.sections[0] : doc.sections[0].block;
    delete target[key]; expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(new RegExp(key));
    target[key] = undefined; expect(() => assertRenderableSectionedViewDocument(doc)).toThrow(new RegExp(key));
  });
  it.each(["columns", "partial-links", "duplicate-links", "raw-copy", "recipe", "group", "badge", "provenance"])("refuses forged %s before invoking Designer", name => {
    const doc: any = structuredClone(resolve(band({ block: columns(2) }))); const block = doc.sections[0].block;
    if (name === "columns") block.columns = 3;
    if (name === "partial-links") block.items[0].href = "/one";
    if (name === "duplicate-links") { block.items[0].href = "/one/"; block.items[1].href = "/one#more"; }
    if (name === "raw-copy") block.items[0].heading = ref("first");
    if (name === "recipe") { block.recipe = "features"; block.emphasis = "statement"; }
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
describe("valid canonical dependency capabilities", () => {
  it.each(["numbered", "connected", "disclose", "matrix", "panel-badge", "mobile-rows", "previous"])("names the unavailable renderer capability for %s without forbidding the core contract", name => {
    let section = band({ block: columns(2) }); let capability = "ordered or disclosed items";
    if (name === "numbered") section = band({ block: { ...columns(2), order: "numbered" } });
    if (name === "connected") section = band({ block: { type: "items", recipe: "flow", items: [item("first"), item("second"), item("third")] } });
    if (name === "disclose") section = band({ block: { type: "items", recipe: "faq", items: [item("first"), item("second"), item("third"), item("fourth")] } });
    if (name === "matrix") { section = band({ block: { type: "matrix", sides: ["one", "two"].map(id => ({ id, label: ref("short"), heading: ref("short"), description: ref("detail") })) } }); capability = "matrix"; }
    if (name === "panel-badge") { section = band({ media: { ...specimen, panel: { ...panel, badge: { label: ref("badge"), tone: "info" } } } }); capability = "specimen metadata and meter markers"; }
    if (name === "mobile-rows") { section = band({ media: { ...specimen, panel: { ...panel, parts: [{ id: "rows", type: "status-rows", mobileRows: 3, items: [{ id: "row", label: ref("field"), status: { tone: "info", label: ref("badge") } }] }] } } }); capability = "specimen metadata and meter markers"; }
    if (name === "previous") { section = band({ media: { ...specimen, panel: { ...panel, parts: [{ id: "meter", type: "meter", label: ref("short"), tone: "info", value: 0, scaleMax: 100, valueText: ref("short"), previous: 0, previousText: ref("short") }] } } }); capability = "specimen metadata and meter markers"; }
    const doc = resolve(section); expect(() => assertRenderableSectionedViewDocument(doc)).not.toThrow(); expect(() => html(doc)).toThrow(new RegExp(`renderer capability unavailable for ${capability}`));
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
  it.each(["below", "end"] as const)("forwards keyed specimen %s with all three marker targets", side => {
    const media: SectionedViewMedia = { ...specimen, key: { label: short, side, items: ["header", "fields", "footer"].map((target, index) => ({ id: `marker-${index}`, target, heading: short, description: ref("detail") })) } };
    const doc = resolve(band({ media })); const markup = html(doc); expect(html(doc, true)).toBe(markup);
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
    const authoredDoc: SectionedViewDocument = { id: "faq", sections: [{ id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, description: ref("detail"), items: [{ id: "one", question: short, answer: ref("detail") }] }] };
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
      else section.media.key = { label: copy.short, side: "below", items: ["header", "fields", "footer"].map((target, index) => ({ id: `marker-${index}`, target, heading: copy.short, description: copy.detail })) };
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
  it.each(["compact", "standard", "display"] as const)("gives the %s canonical frame sole ownership of vertical padding", size => {
    const authoredDoc: SectionedViewDocument = { id: "landing", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, band({ size, block: columns(2) })] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    const markup = renderToStaticMarkup(<LandingView document={doc} peek={false} />); expect(renderToStaticMarkup(<ServerLandingView document={doc} peek={false} />)).toBe(markup);
    const root = dom(markup); const inner = root.querySelector("#content")!; const outer = inner.closest("[data-landing-ground]")!;
    expect(["0", "0px"]).toContain(window.getComputedStyle(outer).paddingBlock);
    expect(inner.classList.contains(size === "compact" ? "py-3xl" : size === "display" ? "py-5xl" : "py-4xl")).toBe(true);
    expect(root.querySelectorAll("#content")).toHaveLength(1); expect(inner.parentElement?.closest("[data-content-section]")).toBeNull();
  });
  it("forwards the private published split FAQ bridge through LandingView", () => {
    const authoredDoc: SectionedViewDocument = { id: "landing-faq", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, { id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, items: [{ id: "one", question: short, answer: ref("detail") }] }] };
    expect(validateSectionedViewDocument(authoredDoc)).toEqual([]); const doc = resolveSectionedViewDocument(authoredDoc, resolver);
    const markup = renderToStaticMarkup(<LandingView document={doc} peek={false} afterSection={{ faq: <p data-faq-after="">After FAQ</p> }} />); expect(renderToStaticMarkup(<ServerLandingView document={doc} peek={false} afterSection={{ faq: <p data-faq-after="">After FAQ</p> }} />)).toBe(markup);
    const root = dom(markup); expect(root.querySelector("#faq")?.closest<HTMLElement>("[data-landing-ground]")?.style.paddingBlock).toBe(""); expect(root.querySelector("#faq details summary")?.textContent).toContain(copy.short); expect(root.querySelector("#faq")?.textContent).toContain(copy.detail); expect(root.querySelector("#faq [data-content-section-text] [data-faq-after]")?.textContent).toBe("After FAQ");
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
  const doc: SectionedViewDocument = { id: "review", sections }; expect(validateSectionedViewDocument(doc).filter(f => f.severity === "error")).toEqual([]); return resolveSectionedViewDocument(doc, reviewResolver);
}
function landingHtml(doc: ResolvedSectionedViewDocument, server = false) {
  const page = { ...doc, sections: [{ id: "hero", kind: "hero" as const, ground: "inverse" as const, heading: copy.heading }, ...doc.sections] };
  return renderToStaticMarkup(server ? <ServerLandingView document={page} peek={false} header="reserved" measure="prose" style={{ scrollPaddingTop: "var(--ui-height-site-header)" }} /> : <LandingView document={page} peek={false} header="reserved" measure="prose" style={{ scrollPaddingTop: "var(--ui-height-site-header)" }} />);
}
function expectCssZero(value: string) { expect(["0", "0px"]).toContain(value); }
function cssUtility(name: string) {
  const css = readFileSync("../designer/styles/compiled.css", "utf8"); const found = css.match(new RegExp("\\." + name + "\\s*\\{[^{}]+\\}")); expect(found, name).not.toBeNull(); return found![0];
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
    const direct = dom(renderToStaticMarkup(<Scene id="content-scene" input={media.input} label={media.label} relationLabel={media.relationLabel} />)).querySelector(".scene-root")!.outerHTML;
    for (const server of [false, true]) { const root = dom(html(doc, server)); expect(root.querySelector("[data-scene-plate]")).toBeNull(); expect(root.querySelector('.scene-root')?.outerHTML).toBe(direct); expect(root.querySelector('.scene-root')?.textContent).toContain(copy.scene); }
  });
  it.each(["compact", "standard", "display"] as const)("aligns the %s canonical fragment with its zero-padding outer band", size => {
    const doc = reviewDocument([band({ size, block: columns(2) })]);
    for (const server of [false, true]) {
      const root = dom(landingHtml(doc, server)); const inner = root.querySelector<HTMLElement>("#content")!; const outer = inner.closest<HTMLElement>("[data-landing-ground]")!;
      expectCssZero(inner.style.scrollMarginTop); expect(inner.className).not.toContain("scroll-mt-4xl"); expect(inner.className).not.toContain("scroll-mt-5xl");
      expectCssZero(outer.style.paddingBlock); expect(inner.className).toContain(size === "compact" ? "py-3xl" : size === "display" ? "py-5xl" : "py-4xl");
      expect(inner.parentElement?.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)"); expect(inner.parentElement?.style.paddingInline).toBe("var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))");
      expect(root.querySelector('[data-landing-hero]')?.className).toContain("py-4xl"); expect(root.querySelector<HTMLElement>('[data-landing-view]')?.style.scrollPaddingTop).toBe("var(--ui-height-site-header)");
    }
  });
  it("retains legacy FAQ fragment offsets and band measure for both entries", () => {
    const authored: SectionedViewDocument = { id: "legacy-anchors", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: short }, { id: "faq", kind: "faq", ground: "base", layout: "split", heading: short, items: [{ id: "one", question: short, answer: ref("detail") }] }, { id: "features", kind: "feature-grid", ground: "base", heading: short, items: [item("first"), item("second", "second")] }] };
    expect(validateSectionedViewDocument(authored)).toEqual([]); const doc = resolveSectionedViewDocument(authored, resolver);
    for (const server of [false, true]) {
      const root = dom(renderToStaticMarkup(server ? <ServerLandingView document={doc} peek={false} header="reserved" measure="prose" /> : <LandingView document={doc} peek={false} header="reserved" measure="prose" />));
      for (const id of ["faq", "features"]) { const inner = root.querySelector<HTMLElement>(`#${id}`)!; expect(inner.className).toContain("scroll-mt-4xl"); expect(inner.className).toContain("tablet-lg:scroll-mt-5xl"); expect(inner.style.scrollMarginTop).toBe(""); expect(inner.closest<HTMLElement>("[data-landing-ground]")?.style.paddingBlock).toBe(""); }
    }
  });
});
