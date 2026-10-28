// @vitest-environment jsdom
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument, type SectionedViewStatusItem, type SectionedViewStatusListSection } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { LandingView } from "@clossys/designer/frames";
import { ServerLandingView as ServerLandingView } from "@clossys/designer/frames";

const words = { heading: "Capability reference", detail: "A bounded explanation", available: "Available", partial: "Partial", planned: "Planned", off: "Not offered", ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`item${i}`, `Capability ${i}`])), group0: "First group", group1: "Second group", group2: "Third group" };
const ref = (key: string) => ({ id: `status-catalog.${key}` });
const registry = { id: "status-catalog-example", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(words).map(([key, text]) => ({ id: ref(key).id, text, context: "Generic status catalog test", status: "approved" })) } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const labels = { available: ref("available"), partial: ref("partial"), planned: ref("planned"), dispositions: { "not-offered": ref("off") } };
const row = (i: number): SectionedViewStatusItem => ({ id: `row-${i}`, label: ref(`item${i}`), detail: ref("detail"), ...(["available", "partial", "planned", "not-offered"][i % 4] === "not-offered" ? { disposition: "not-offered" as const } : { state: ["available", "partial", "planned"][i % 4] as "available" | "partial" | "planned" }) });
const section = (count: number): SectionedViewStatusListSection => ({ id: "capabilities", kind: "status-list", ground: "base", heading: ref("heading"), labels: structuredClone(labels), items: Array.from({ length: count }, (_, i) => row(i)) });
const documentOf = (s: SectionedViewStatusListSection): SectionedViewDocument => ({ id: "status-catalog-document", sections: [s] });
function markup(s: SectionedViewStatusListSection, server = false) {
  const doc = resolveSectionedViewDocument(documentOf(s), resolver);
  return JSDOM.fragment(renderToStaticMarkup(server ? <ServerSectionedView document={doc} /> : <SectionedView document={doc} />));
}

describe("declared status catalog alias", () => {
  it.each(["count", "xor", "shape"])("refuses original %s poison before invoking copy resolution", poison => {
    const input = section(poison === "count" ? 2 : 3);
    if (poison === "xor") (input.items![0] as unknown as Record<string, unknown>).disposition = "not-offered";
    if (poison === "shape") (input as unknown as Record<string, unknown>).render = "unrecognized";
    const observed = vi.fn(resolver);
    expect(() => resolveSectionedViewDocument(documentOf(input), observed)).toThrow();
    expect(observed).not.toHaveBeenCalled();
  });
  it.each([24, 25])("enforces the resolved group heading limit at %s characters", count => {
    const { items: _items, ...base } = section(4);
    const input: SectionedViewStatusListSection = { ...base, groups: [
      { id: "first", heading: ref("group0"), items: [row(0), row(1)] },
      { id: "second", heading: ref("group1"), items: [row(2), row(3)] },
    ] };
    const local = createCopyResolver({ ...registry, entries: registry.entries.map(entry => entry.id === ref("group0").id ? { ...entry, text: "G".repeat(count) } : entry) });
    if (count === 25) expect(() => resolveSectionedViewDocument(documentOf(input), local)).toThrow(/24/);
    else {
      const resolved = resolveSectionedViewDocument(documentOf(input), local);
      for (const View of [SectionedView, ServerSectionedView]) expect(renderToStaticMarkup(<View document={resolved} />)).toContain("G".repeat(24));
      const first = resolved.sections[0]!;
      if (first.kind !== "status-list" || !first.groups) throw new Error("Expected groups.");
      first.groups[0]!.heading += "G";
      for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolved} />)).toThrow();
    }
  });
  it.each([false, true])("leaves status band padding to the canonical inner frame (server=%s)", server => {
    const resolved = resolveSectionedViewDocument(documentOf(section(4)), resolver);
    const input = { ...resolved, sections: [{ id: "hero", kind: "hero" as const, ground: "inverse" as const, heading: "Reference" }, ...resolved.sections] };
    const View = server ? ServerLandingView : LandingView;
    const dom = JSDOM.fragment(renderToStaticMarkup(<View document={input} peek={false} afterSection={{ capabilities: <aside data-status-appendix>Reference note</aside> }} />));
    const inner = dom.querySelector<HTMLElement>("#capabilities")!;
    expect(inner.querySelectorAll("[data-item]")).toHaveLength(4);
    const outer = inner.closest<HTMLElement>("[data-landing-ground]")!;
    expect(outer).not.toBe(inner);
    expect(Number.parseFloat(outer.style.paddingBlock)).toBe(0);
    expect(outer.dataset.landingGround).toBe("base");
    const appendix = inner.querySelector("[data-status-appendix]")!;
    expect(appendix.textContent).toBe("Reference note");
    expect(inner.querySelector("[data-items]")!.compareDocumentPosition(appendix) & 4).toBe(4);
  });
  it.each([false, true])("renders readiness and off-axis disposition through canonical Items (server=%s)", server => {
    const input = section(4), before = JSON.stringify(input), dom = markup(input, server);
    const list = dom.querySelector('[data-items][data-arrangement="rows"]');
    expect(list).not.toBeNull();
    expect(dom.querySelectorAll('[data-item]')).toHaveLength(4);
    expect([...dom.querySelectorAll('[data-item-heading]')].map(n => n.textContent)).toEqual(["Capability 0", "Capability 1", "Capability 2", "Capability 3"]);
    const expected = [["Available", "bg-status-success-tint"], ["Partial", "bg-status-warning-tint"], ["Planned", "bg-status-info-tint"], ["Not offered", "bg-surface-sunken"]];
    [...dom.querySelectorAll('[data-item]')].forEach((item, i) => {
      const badge = item.querySelector(`[data-item-meta] .${expected[i]![1]}`);
      expect(badge, expected[i]![0]).not.toBeNull();
      expect(badge!.textContent).toBe(expected[i]![0]);
      expect(item.querySelector('[data-item-description]')?.textContent).toBe("A bounded explanation");
    });
    expect(dom.querySelector('dl, details')).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });
  it("preserves three groups of 3/3/2 members within the eight-item budget", () => {
    const { items: _items, ...base } = section(8);
    const input: SectionedViewStatusListSection = { ...base, groups: [[0, 1, 2], [3, 4, 5], [6, 7]].map((indices, i) => ({ id: `group-${i}`, heading: ref(`group${i}`), items: indices.map(row) })) };
    const dom = markup(input);
    const groups = [...dom.querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.querySelectorAll('[data-item]').length)).toEqual([3, 3, 2]);
    expect([...dom.querySelectorAll('[data-item-heading]')].map(n => n.textContent)).toEqual(Array.from({ length: 8 }, (_, i) => `Capability ${i}`));
  });
  it.each([3, 8, 3])("supports a consumer-shaped count of %s with generic copy", count => {
    expect(markup(section(count)).querySelectorAll('[data-item]')).toHaveLength(count);
  });
  it("retains the status wire union and authored provenance order for a conforming input", () => {
    const input = section(3), before = JSON.stringify(input);
    const resolved = resolveSectionedViewDocument(documentOf(input), resolver);
    const status = resolved.sections[0]!;
    expect(status.kind).toBe("status-list");
    expect(Object.hasOwn(status, "items")).toBe(true);
    expect(Object.hasOwn(status, "groups")).toBe(false);
    expect(resolved.resolutions.map(r => r.ref.id)).toEqual(["heading", "available", "partial", "planned", "off", "item0", "detail", "item1", "detail", "item2", "detail"].map(k => ref(k).id));
    expect(JSON.stringify(input)).toBe(before);
  });
  it("enforces the same count floor on an otherwise valid resolved wire document", () => {
    const resolved = resolveSectionedViewDocument(documentOf(section(3)), resolver);
    const forged = structuredClone(resolved);
    const status = forged.sections[0]!;
    if (status.kind !== "status-list" || status.items === undefined) throw new Error("Expected flat status fixture.");
    status.items.pop();
    expect(() => renderToStaticMarkup(<SectionedView document={forged} />)).toThrow(/three to eight/);
  });
  it("refuses a single group instead of deleting its authored group heading", () => {
    const { items: _items, ...base } = section(4);
    const input = { ...base, groups: [{ id: "only", heading: ref("group0"), items: Array.from({ length: 4 }, (_, i) => row(i)) }] };
    expect(validateSectionedViewDocument(documentOf(input)).some(f => f.severity === "error")).toBe(true);
    expect(() => markup(input)).toThrow();
  });
  it("refuses original resolved XOR poison before the projection drops the extra axis", () => {
    const doc = resolveSectionedViewDocument(documentOf(section(4)), resolver);
    const status = doc.sections[0]!;
    if (status.kind !== "status-list" || status.items === undefined) throw new Error("Expected flat status fixture.");
    (status.items[0] as unknown as Record<string, unknown>).disposition = "not-offered";
    expect(() => renderToStaticMarkup(<SectionedView document={doc} />)).toThrow(/status item|disposition/);
  });
  it("requires every original label, including the unused off-axis label, before projection", () => {
    const input = section(3);
    delete (input.labels as unknown as Record<string, unknown>).dispositions;
    expect(validateSectionedViewDocument(documentOf(input)).some(f => f.rule === "sectioned-view-status-labels-shape")).toBe(true);
    expect(() => markup(input)).toThrow();
  });
  it.each([[1, 2], [5, 3]])("refuses grouped member counts %s/%s without widening canonical bounds", (first, second) => {
    const { items: _items, ...base } = section(first + second);
    const input: SectionedViewStatusListSection = { ...base, groups: [
      { id: "first", heading: ref("group0"), items: Array.from({ length: first }, (_, i) => row(i)) },
      { id: "second", heading: ref("group1"), items: Array.from({ length: second }, (_, i) => row(i + first)) },
    ] };
    expect(validateSectionedViewDocument(documentOf(input)).some(f => f.rule === "sectioned-view-content-topics-groups-shape")).toBe(true);
    expect(() => markup(input)).toThrow();
  });
  it("refuses an item id reused across groups instead of rendering duplicate canonical identities", () => {
    const { items: _items, ...base } = section(4);
    const input: SectionedViewStatusListSection = { ...base, groups: [
      { id: "first", heading: ref("group0"), items: [row(0), row(1)] },
      { id: "second", heading: ref("group1"), items: [row(0), row(3)] },
    ] };
    expect(validateSectionedViewDocument(documentOf(input)).some(f => f.severity === "error")).toBe(true);
    expect(() => markup(input)).toThrow();
  });
  it.each([1, 2, 9])("refuses count %s rather than widening canonical row bounds", count => {
    expect(validateSectionedViewDocument(documentOf(section(count))).some(f => f.severity === "error")).toBe(true);
    expect(() => markup(section(count))).toThrow(/count|two|eight|2|8|row/i);
  });
  it.each([
    { name: "both axes", poison: { state: "available", disposition: "not-offered" } },
    { name: "neither axis", poison: { state: undefined } },
    { name: "unknown readiness", poison: { state: "blocked" } },
    { name: "unknown disposition", poison: { disposition: "planned", state: undefined } },
  ])("refuses original $name before badge projection can hide it", ({ poison }) => {
    const input = section(3);
    input.items![0] = { id: "bad", label: ref("item0"), ...poison } as unknown as SectionedViewStatusItem;
    expect(validateSectionedViewDocument(documentOf(input)).some(f => f.severity === "error")).toBe(true);
    expect(() => markup(input)).toThrow();
  });
});
