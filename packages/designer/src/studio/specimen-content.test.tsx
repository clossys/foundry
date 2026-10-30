import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as components from "../components/index.js";
import * as blocks from "../blocks/index.js";
import { loadCatalog, loadComponentRegistry, loadSectionRegistry } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/api.js";
import { resolveComposite } from "../catalog-core/library-components.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { selectedPackageComponentOptions } from "../catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import type { SurfaceCandidateDocument } from "../catalog-core/surface-types.js";
import { emittedDesignerSpecimenContext } from "./emitted-specimens.js";
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { contentSpecimenLeaves, contentSpecimenNeeds, copyInContextItems, pageViewportCases, richPassageItems, SpecimenCopyInContext, SpecimenPageViewports, SpecimenRichPassage, unpublishedPageViewportCases, isSpecimenUnpublishedPage, type CopyInContextValue } from "./specimen-content.js";
import type { SpecimenAxis, SpecimenItem, SpecimenLeafProps } from "./specimen-layouts.js";
import { bindAgentSpecimenPlan } from "./specimen-plan.js";
import { SpecimenPageViewports as DedicatedPageViewports, pageViewportSpecimenNeeds, pageViewportSpecimenLeaf } from "./specimen-page-viewports.js";

let context: DesignerSpecimenContext;
const labels = { showAllVariants: (count: number) => `All ${count}` };
const need: SpecimenLeafProps["need"] = value => <components.SemanticContent as="p" role="status">{value.leaf}: {value.reason}</components.SemanticContent>;
const visible = (root: Element, selector: string) => [...root.querySelectorAll(selector)].filter(node => !node.closest("[hidden]"));
const base = (items: readonly SpecimenItem[], axes?: readonly SpecimenAxis[], selected = context): SpecimenLeafProps => ({ items, axes, context: selected, labels, need });
beforeAll(() => {
  const valuesCatalog = loadCatalog(), candidates = importFoundryComponents().fills;
  const rich = loadCatalogBundles().componentFills.find(doc => doc.$extensions["com.clossys.fill"].slot === "components.rich-text");
  if (!rich) throw new Error("The actual RichText candidate is required.");
  const imported = importFoundrySections().fills.filter(doc => ["sections.section-header", "sections.empty-state"].includes(doc.$extensions["com.clossys.fill"].slot));
  // Exercise the same JSON document boundary as a consumer reading its native library.
  const surfaces: SurfaceCandidateDocument[] = JSON.parse(JSON.stringify(imported));
  const catalog: CompositeCatalogData = { values: valuesCatalog, components: { slots: loadComponentRegistry().slots, fills: [...candidates, rich] }, surfaces: { slots: loadSectionRegistry().slots, fills: surfaces, transforms: [], rules: [], materializations: [] } };
  const values = completedCatalogLibrary(valuesCatalog, { id: "content-specimen-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const { source, adoptedAt, ...portion } = values;
  const empty: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] } };
  const componentOptions = selectedPackageComponentOptions();
  const available = new Map([...candidates, rich].map(doc => [doc.$extensions["com.clossys.fill"].slot, doc]));
  const ordered: string[] = [], visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const doc = available.get(id);
    if (!doc) throw new Error(`Native component dependency is unavailable: ${id}`);
    visited.add(id);
    const component = componentOf(doc);
    for (const dependency of [...component.reads.components, ...component.composes]) visit(dependency);
    ordered.push(id);
  };
  for (const id of ["components.semantic-content", "components.rich-text", "components.grid-list", "components.table", "components.disclosure", "components.navigation-tree", "components.button"]) visit(id);
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: ordered.map(id => ({ portion: "components", change: { op: "adopt", slot: id, source: available.get(id)!.$extensions["com.clossys.fill"].source } })) }, { componentOptions });
  const selected = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: imported.map(doc => ({ portion: "surfaces", change: { op: "adopt", slot: doc.$extensions["com.clossys.fill"].slot, source: "foundry" } })) }, { componentOptions });
  const profile = resolveComposite({ catalog, library: selected, componentOptions });
  const emitted = emittedDesignerSpecimenContext(profile, { components, surfaces: blocks });
  context = { ...emitted, modules: { "@clossys/designer/components": components } };
}, 60_000);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const passages = (count: number) => richPassageItems(Array.from({ length: count }, (_, index) => ({ id: `passage-${index}`, label: `Passage ${index}`, value: { passage: `## Complete passage ${index}\n\nOpening **emphasis**.\n\nFinal paragraph ${index}.` } })));
it.each([1, 3, 15])("renders %i complete passages in the intrinsic ladder and expands all in a full tab", count => {
  const props = base(passages(count)), view = render(<SpecimenRichPassage {...props} />);
  expect(visible(view.container, "[data-ds-specimen-item]")).toHaveLength(Math.min(count, 12));
  expect(visible(view.container, "[data-readonly='true']")).toHaveLength(Math.min(count, 12));
  expect(view.container.textContent).toContain("Final paragraph 0.");
  expect(view.container.querySelector("textarea,[contenteditable='true']")).toBeNull();
  if (count === 1) expect(view.container.querySelector("[role='grid'],table,button")).toBeNull();
  if (count > 12) {
    fireEvent.click(screen.getByRole("button", { name: `All ${count}` }));
    expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
  }
  view.rerender(<SpecimenRichPassage {...props} expanded />);
  expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
  expect(screen.queryByRole("button", { name: `All ${count}` })).toBeNull();
});
it("uses the native disclosure for the full clamped passage and expands it in the full tab", () => {
  const props = base([{ id: "strategy", label: "Strategy", value: { passage: Array.from({ length: 20 }, (_, index) => `Paragraph ${index}.`).join("\n\n"), clamp: { lines: 12, showMore: "Read the full strategy" } } }]);
  const view = render(<SpecimenRichPassage {...props} />);
  expect(view.container.querySelector("[style*='line-clamp: 12']")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Read the full strategy" }));
  expect(screen.getAllByText("Paragraph 19.")).toHaveLength(2);
  view.rerender(<SpecimenRichPassage {...props} expanded />);
  expect(screen.getAllByText("Paragraph 19.")).toHaveLength(1);
  expect(screen.queryByRole("button")).toBeNull();
});
it("renders a full valid JSON document and refuses malformed document content", () => {
  const props = base([{ id: "json", label: "JSON passage", value: { passage: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Full JSON paragraph" }] }] } } }]);
  const view = render(<SpecimenRichPassage {...props} />);
  expect(screen.getByText("Full JSON paragraph")).toBeVisible();
  view.rerender(<SpecimenRichPassage {...base([{ id: "bad", label: "Invalid", value: { passage: { type: "doc", content: [{ type: "not-a-node" }] } } }])} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
});

const roles: readonly CopyInContextValue["role"][] = ["headline", "body", "cta", "nav", "error", "empty"];
const copyCases = (count: number) => {
  const items = copyInContextItems(Array.from({ length: count }, (_, index): SpecimenItem<CopyInContextValue> => {
    const role = roles[index % roles.length]!, common = { context: `Context ${index}`, locale: index === 1 ? "ar" : "en", dir: index === 1 ? "rtl" : "ltr" };
    const value: CopyInContextValue = role === "body" ? { ...common, dir: index === 1 ? "rtl" : "ltr", role, passage: `**Complete body ${index}**\n\nFinal copy paragraph.` } : { ...common, dir: "ltr", role, text: `Produced ${role} ${index}` };
    return { id: `copy-${index}`, label: `String ${index}`, value, coordinates: { string: `string-${index}`, context: role } };
  }));
  const axes: readonly SpecimenAxis[] = [{ id: "string", label: "String", values: items.map(item => ({ id: item.coordinates!.string!, label: item.label })) }, { id: "context", label: "Context", values: roles.map(role => ({ id: role, label: role })) }];
  return { items, axes };
};
it.each([1, 3, 15])("renders %i Writer strings in their actual native role components", count => {
  const cases = copyCases(count), props = base(cases.items, cases.axes), view = render(<SpecimenCopyInContext {...props} expanded />);
  expect(view.container.querySelectorAll("[data-copy-role]")).toHaveLength(count);
  expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
  expect(screen.getByRole("heading", { name: "Produced headline 0" })).toBeVisible();
  if (count > 1) expect(view.container.querySelector("[lang='ar'][dir='rtl'] [data-readonly='true']")).toBeTruthy();
  if (count > 2) expect(screen.getAllByRole("button", { name: /Produced cta/ }).length).toBeGreaterThan(0);
  if (count > 5) {
    expect(view.container.querySelector("[data-ds-leaf='components.navigation-tree']")).toBeTruthy();
    expect(view.container.querySelector("[data-copy-role='error'] [data-ds-leaf='sections.empty-state']")).toBeTruthy();
    expect(view.container.querySelector("[data-copy-role='empty'] [data-ds-leaf='sections.empty-state']")).toBeTruthy();
  }
  if (count === 1) expect(view.container.querySelector("table,[role='grid'],button")).toBeNull();
  view.rerender(<SpecimenCopyInContext {...props} />);
  if (count > 1) {
    expect(visible(view.container, "[data-copy-role]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `All ${count}` }));
    expect(view.container.querySelectorAll("[data-copy-role]")).toHaveLength(count);
  }
});
it("passes caller copy through the descriptor-matched selected surface port and refuses stale ports", () => {
  const bound = context.surfaces?.["sections.section-header"];
  if (!bound) throw new Error("The native selected heading port is required.");
  const renderContent = vi.fn(bound.renderContent);
  const selected = { ...context, surfaces: { ...context.surfaces, "sections.section-header": { ...bound, renderContent } } };
  const cases = copyCases(1), props = base(cases.items, cases.axes, selected), view = render(<SpecimenCopyInContext {...props} />);
  expect(renderContent).toHaveBeenCalledWith({ title: "Produced headline 0", level: 3 });
  view.rerender(<SpecimenCopyInContext {...base(cases.items, cases.axes, { ...selected, surfaces: { "sections.section-header": { ...bound, descriptorHash: "stale" } } })} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull();
});

const viewportCases = (count: number) => pageViewportCases({ id: "page", label: "Emitted page" }, Array.from({ length: count }, (_, index) => ({ id: `width-${index}`, label: index === 0 ? "Desktop" : index === 1 ? "Mobile" : `Width ${index}`, width: index === 0 ? 1440 : 390 + index, height: 900 })), { page: "Page", viewport: "Viewport" });
it("registers the Publisher's dedicated renderer and validator while preserving old import identity", () => {
  expect(SpecimenPageViewports).toBe(DedicatedPageViewports);
  expect(contentSpecimenLeaves.find(leaf => leaf.id === "sections.specimen-page-viewports")).toBe(pageViewportSpecimenLeaf);
  expect(pageViewportSpecimenLeaf.render).toBe(DedicatedPageViewports);
  expect(pageViewportSpecimenLeaf.validate).toBe(pageViewportSpecimenNeeds);
  const props = base(viewportCases(1).items, viewportCases(1).axes);
  expect(pageViewportSpecimenNeeds(props)).toEqual(contentSpecimenNeeds("sections.specimen-page-viewports", props));
});
it.each([1, 2, 15])("dispatches %i page viewport cases to the actual host engine port", count => {
  const renderViewport = vi.fn(({ page, viewport, interactive, fullSize }) => <components.SemanticContent as="div" data-ds-leaf="components.semantic-content" data-engine-interactive={String(interactive)} data-engine-full-size={String(fullSize)}><iframe title={viewport.label} src={page.previewUrl} sandbox="" tabIndex={-1} width={viewport.width} height={viewport.height} style={{ pointerEvents: "none" }} /></components.SemanticContent>);
  const selected: DesignerSpecimenContext = { ...context, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [{ id: "page", route: "/actual-route", previewUrl: "/preview/publication/pages/page.html", emitted: true, stage: "preview" }], renderViewport } };
  const cases = viewportCases(count), props = base(cases.items, cases.axes, selected), view = render(<SpecimenPageViewports {...props} />);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(count);
  expect(view.container.querySelector("[data-publication-route='/actual-route'][data-publication-stage='preview']")).toBeTruthy();
  for (const frame of view.container.querySelectorAll("iframe")) { expect(frame).toHaveAttribute("sandbox", ""); expect(frame).toHaveAttribute("tabindex", "-1"); expect(frame).toHaveStyle({ pointerEvents: "none" }); }
  expect(renderViewport).toHaveBeenCalledWith(expect.objectContaining({ interactive: false, fullSize: false }));
  if (count === 1) expect(view.container.querySelector("table,[role='grid'],button")).toBeNull();
  view.rerender(<SpecimenPageViewports {...props} expanded />);
  expect(renderViewport).toHaveBeenLastCalledWith(expect.objectContaining({ fullSize: true, interactive: false }));
});
it("fails missing emit, missing native engine, unsafe origin and URL-card-shaped input", () => {
  const cases = viewportCases(2), props = base(cases.items, cases.axes), view = render(<SpecimenPageViewports {...props} />);
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", props)).not.toEqual([]);
  for (const origin of ["http://localhost:4300", "https://example.invalid", "http://127.0.0.1:4300/path", "http://127.0.0.1:999999"]) {
    const selected: DesignerSpecimenContext = { ...context, pagePreview: { engine: "producer-emitted-page@1", origin, pages: [{ id: "page", route: "/", previewUrl: "/preview/publication/pages/page.html", emitted: true, stage: "preview" }], renderViewport: () => null } };
    expect(contentSpecimenNeeds("sections.specimen-page-viewports", base(cases.items, cases.axes, selected))).not.toEqual([]);
  }
  const renderViewport = vi.fn(() => null);
  const notEmitted: DesignerSpecimenContext = { ...context, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [{ id: "page", route: "/", previewUrl: "/preview/publication/pages/page.html", emitted: false, stage: "preview" }], renderViewport } };
  view.rerender(<SpecimenPageViewports {...base(cases.items, cases.axes, notEmitted)} />);
  expect(renderViewport).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  view.rerender(<SpecimenPageViewports {...base([{ id: "url", label: "URL card", value: { url: "/preview/publication/pages/page.html" } }])} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
});
it("switches the native emitted viewport through selected device buttons", () => {
  const viewports = [{ id: "desktop", label: "Desktop", width: 1440, height: 900 }, { id: "tablet", label: "Tablet", width: 768, height: 1024 }, { id: "mobile", label: "Mobile", width: 390, height: 844 }];
  const cases = pageViewportCases({ id: "page", label: "Emitted page" }, viewports, { page: "Page", viewport: "Viewport" });
  const selected: DesignerSpecimenContext = { ...context, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [{ id: "page", route: "/", previewUrl: "/preview/site/pages/page.html", emitted: true, stage: "preview" }], renderViewport: ({ page, viewport }) => <components.SemanticContent as="div"><iframe title={viewport.label} src={page.previewUrl} width={viewport.width} height={viewport.height} sandbox="" tabIndex={-1} /></components.SemanticContent> } };
  const view = render(<SpecimenPageViewports {...base(cases.items, cases.axes, selected)} />);
  expect(pageViewportSpecimenNeeds(base(cases.items, cases.axes, selected))).toEqual([]);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
  for (const viewport of viewports) {
    fireEvent.click(screen.getByRole("button", { name: viewport.label }));
    expect(screen.getByRole("button", { name: viewport.label })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector("iframe")).toHaveAttribute("width", String(viewport.width));
    expect(view.container.querySelector("iframe")).toHaveAttribute("sandbox", "");
    expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(1);
  }
});
it.each(contentSpecimenLeaves)("$id rejects zero items as failed coverage", leaf => {
  const props = base([]), view = render(<>{leaf.render(props)}</>);
  expect(leaf.validate?.(props).length).toBeGreaterThan(0);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  expect(view.container.querySelector("[data-ds-specimen-item]")).toBeNull();
});
it("never falls back when the consumer's selected rich-text module is absent", () => {
  const view = render(<SpecimenRichPassage {...base(passages(1), undefined, { ...context, modules: {} })} />);
  expect(screen.getByRole("status")).toHaveTextContent("module-unavailable");
  expect(view.container.querySelector("[data-readonly]")).toBeNull();
});

const unpublishedPage = {
  publication: "unpublished" as const, emitted: false as const, id: "page", route: "/example-co",
  emptyState: { title: "Not published yet", description: "Publish ExampleCo to preview this route.", command: "clossys publish --target preview", context: "ExampleCo Publisher preview" },
};
const unpublishedContext = (): DesignerSpecimenContext => ({ ...context, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [unpublishedPage], renderViewport: vi.fn(() => null) } });
it("binds a native unpublished presentation without publication-variant proof", () => {
  const items = [{ id: "desktop", label: "Desktop", width: 1440, height: 900 }, { id: "tablet", label: "Tablet", width: 768, height: 1024 }, { id: "mobile", label: "Mobile", width: 390, height: 844 }].map(viewport => ({ id: `cell:${viewport.id}`, kind: "publisher", publication: "unpublished", page: { id: "page" }, viewport }));
  const nativePlan = { cellId: "cell", items, expectedVariantIds: items.map(item => item.id), issues: [] };
  const selected = unpublishedContext(), props = base([], undefined, selected);
  const bound = bindAgentSpecimenPlan({ agent: "publisher", plan: nativePlan, props, nativeRegistered: () => true });
  expect(bound.registered).toBe(true);
  expect(bound.presentationReady).toBe(true);
  expect(bound.variantIds).toEqual([]);
  expect(bound.issues).toEqual([]);
  const view = render(<SpecimenPageViewports {...props} items={bound.items} axes={bound.cell.axes} />);
  expect(view.container.querySelectorAll("[data-ds-leaf='sections.empty-state']")).toHaveLength(1);
  expect(view.container.textContent).toContain("Not published yet");
  expect(view.container.textContent).toContain("clossys publish --target preview");
  expect(view.container.querySelector("iframe,[aria-pressed]")).toBeNull();
  const unregistered = bindAgentSpecimenPlan({ agent: "publisher", plan: nativePlan, props, nativeRegistered: () => false });
  expect(unregistered.presentationReady).toBe(false);
  expect(unregistered.variantIds).toEqual([]);
});
it.each([1, 3, 15])("renders %i confirmed unpublished viewport states through the selected empty state without publication coverage", count => {
  const viewports = Array.from({ length: count }, (_, index) => ({ id: `viewport-${index}`, label: index === 0 ? "Desktop" : index === 1 ? "Tablet" : "Mobile", width: [1440, 768, 390][index % 3]!, height: 900 }));
  const cases = unpublishedPageViewportCases({ id: "page", label: "ExampleCo page" }, viewports, { page: "Page", viewport: "Viewport" });
  const selected = unpublishedContext(), bound = selected.surfaces!["sections.empty-state"]!, renderContent = vi.fn(bound.renderContent);
  const props = base(cases.items, cases.axes, { ...selected, surfaces: { ...selected.surfaces, "sections.empty-state": { ...bound, renderContent } } });
  const view = render(<SpecimenPageViewports {...props} />);
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", props)).toEqual([]);
  expect(view.container.querySelectorAll("[data-publication-state='unpublished'][data-publication-rendered='false']")).toHaveLength(count);
  expect(view.container.querySelectorAll("[data-ds-leaf='sections.empty-state']")).toHaveLength(count);
  expect(renderContent).toHaveBeenCalledWith({ title: unpublishedPage.emptyState.title, description: unpublishedPage.emptyState.description });
  expect(view.container.textContent).toContain("clossys publish --target preview");
  expect(view.container.querySelector("[data-publication-route='/example-co'][data-publication-context='ExampleCo Publisher preview']")).toBeTruthy();
  expect(view.container.querySelector("iframe,[data-ds-specimen-need='true']")).toBeNull();
  expect(selected.pagePreview!.renderViewport).not.toHaveBeenCalled();
  expect(cases.items.map(item => [item.id, item.label, item.coordinates, item.value.viewport])).toEqual(viewports.map(viewport => [`page/${viewport.id}`, viewport.label, { page: "page", viewport: viewport.id }, viewport]));
  view.rerender(<SpecimenPageViewports {...props} expanded />);
  expect(view.container.querySelectorAll("[data-publication-rendered='false']")).toHaveLength(count);
});
it("rejects unknown inventory, incomplete payload, mismatched state and missing selected empty-state renderer", () => {
  const cases = unpublishedPageViewportCases({ id: "page", label: "ExampleCo page" }, [{ id: "mobile", label: "Mobile", width: 390, height: 900 }], { page: "Page", viewport: "Viewport" });
  const selected = unpublishedContext();
  const invalid: DesignerSpecimenContext[] = [
    { ...selected, pagePreview: { ...selected.pagePreview!, pages: [] } },
    { ...selected, pagePreview: { ...selected.pagePreview!, pages: [{ id: "page", route: "/example-co", emitted: false, stage: "preview", previewUrl: "/preview/site/pages/page.html" }] } },
    { ...selected, pagePreview: { ...selected.pagePreview!, pages: [{ ...unpublishedPage, emptyState: { ...unpublishedPage.emptyState, command: "" } }] } },
    { ...selected, surfaces: {} },
    { ...selected, surfaces: { ...selected.surfaces, "sections.empty-state": { ...selected.surfaces!["sections.empty-state"]!, descriptorHash: "stale" } } },
  ];
  for (const candidate of invalid) expect(contentSpecimenNeeds("sections.specimen-page-viewports", base(cases.items, cases.axes, candidate))).not.toEqual([]);
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", base(viewportCases(1).items, viewportCases(1).axes, selected))).not.toEqual([]);
  expect(isSpecimenUnpublishedPage(undefined)).toBe(false);
  expect(isSpecimenUnpublishedPage({ ...unpublishedPage, emitted: true })).toBe(false);
  expect(isSpecimenUnpublishedPage({ ...unpublishedPage, publication: "unknown" })).toBe(false);
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", base([{ id: "bad", label: "Unknown", value: { ...cases.items[0]!.value, publication: "unknown" } }], undefined, selected))).not.toEqual([]);
});

it("keeps published and unpublished rows distinct in one caller inventory", () => {
  const selected = unpublishedContext(), renderViewport = vi.fn(() => <components.SemanticContent as="div" data-actual-published-engine="true" />);
  const mixed: DesignerSpecimenContext = { ...selected, pagePreview: { ...selected.pagePreview!, pages: [...selected.pagePreview!.pages, { id: "published", route: "/published", previewUrl: "/preview/site/pages/published.html", emitted: true, stage: "preview" }], renderViewport } };
  const viewports = [{ id: "desktop", label: "Desktop", width: 1440, height: 900 }, { id: "tablet", label: "Tablet", width: 768, height: 900 }, { id: "mobile", label: "Mobile", width: 390, height: 900 }];
  const emitted = pageViewportCases({ id: "published", label: "Published ExampleCo page" }, viewports, { page: "Page", viewport: "Viewport" });
  const absent = unpublishedPageViewportCases({ id: "page", label: "Unpublished ExampleCo page" }, viewports, { page: "Page", viewport: "Viewport" });
  const view = render(<><SpecimenPageViewports {...base(emitted.items, emitted.axes, mixed)} /><SpecimenPageViewports {...base(absent.items, absent.axes, mixed)} /></>);
  expect(renderViewport).toHaveBeenCalledTimes(1);
  for (const [input] of renderViewport.mock.calls) expect(input).toEqual(expect.objectContaining({ page: expect.objectContaining({ id: "published", emitted: true }), interactive: false }));
  expect(view.container.querySelectorAll("[data-publication-rendered='false']")).toHaveLength(1);
  expect(view.container.querySelectorAll("[data-actual-published-engine='true']")).toHaveLength(1);
  expect(view.container.querySelector("iframe,[data-ds-specimen-need='true']")).toBeNull();
});
