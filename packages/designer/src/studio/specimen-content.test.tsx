import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderUi, screen } from "@testing-library/react";
import { isValidElement, Suspense, type ReactNode } from "react";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import * as components from "../components/index.js";
import * as blocks from "../blocks/index.js";
import { producerPagePreview } from "../../../producer/studio/lib/producer-page-preview.js";
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
import { contentSpecimenLeaves, contentSpecimenNeeds, copyInContextItems, pageViewportCases, richPassageItems, SpecimenCopyInContext, SpecimenPageViewports, SpecimenRichPassage, type CopyInContextValue } from "./specimen-content.js";
import type { SpecimenAxis, SpecimenItem, SpecimenLeafProps, SpecimenRenderParts } from "./specimen-layouts.js";

let context: DesignerSpecimenContext;
function SelectedComponents({ children }: { readonly children?: ReactNode }) {
  const selected = isValidElement<{ readonly context?: DesignerSpecimenContext }>(children) ? children.props.context ?? context : context;
  const descriptors = Object.fromEntries(Object.entries(selected.profile.components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)]));
  return <ConsumerComponentProvider value={{ profile: selected.profile, selectionHash: selected.profile.components.selectionHash, modules: selected.modules, descriptors }}><Suspense>{children}</Suspense></ConsumerComponentProvider>;
}
function render(ui: ReactNode) {
  const wrap = (children: ReactNode) => <SelectedComponents>{children}</SelectedComponents>;
  const view = renderUi(wrap(ui));
  return { ...view, rerender: (next: ReactNode) => view.rerender(wrap(next)) };
}
const labels = { showAllVariants: (count: number) => `All ${count}` };
const need: SpecimenLeafProps["need"] = value => <components.SemanticContent as="p" role="status">{value.leaf}: {value.reason}</components.SemanticContent>;
const visible = (root: Element, selector: string) => [...root.querySelectorAll(selector)].filter(node => !node.closest("[hidden]"));
const base = (items: readonly SpecimenItem[], axes?: readonly SpecimenAxis[], selected = context): SpecimenLeafProps => ({ items, axes, context: selected, labels, need, renderParts: {
  "sections.specimen-copy-in-context": { renderContent: ({ leaf, ...input }) => selected.surfaces![leaf]!.renderContent!(input) },
} });
function nativePagePreview(emitted = true) {
  const port = producerPagePreview({ state: "ready", publication: "publication", publications: ["publication"], manifest: { schemaVersion: 1, publication: "publication", sourceApp: "web", format: "web.page.responsive", routes: [{ id: "page", path: "/actual-route", source: { file: "pages/page.tsx", export: "default" } }], contentMap: { version: 1, publicationId: "publication", entries: [{ id: "page", title: "Actual page", kind: "page", path: "/actual-route" }] } }, pages: [{ id: "page", route: "/actual-route", emitted, previewUrl: "/preview/publication/pages/page.html" }] }, "http://127.0.0.1:4300");
  if (!port) throw new Error("The actual Producer emitted-page port is required.");
  return port;
}
beforeAll(async () => {
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
  // Resolve the real lazy selected-component boundary before synchronous DOM assertions.
  render(<SpecimenRichPassage {...base(passages(1))} />);
  await screen.findByText("Final paragraph 0.");
  cleanup();
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
it("shows the complete passage in canvas and full tabs when caller clamp metadata is present", () => {
  const props = base([{ id: "strategy", label: "Strategy", value: { passage: Array.from({ length: 20 }, (_, index) => `Paragraph ${index}.`).join("\n\n"), clamp: { lines: 12, showMore: "Read the full strategy" } } }]);
  const view = render(<SpecimenRichPassage {...props} />);
  expect(screen.getByText("Paragraph 19.")).toBeVisible();
  expect(view.container.querySelector("[style*='line-clamp'],[style*='-webkit-box']")).toBeNull();
  expect(screen.queryByRole("button", { name: "Read the full strategy" })).toBeNull();
  view.rerender(<SpecimenRichPassage {...props} expanded />);
  expect(screen.getByText("Paragraph 19.")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});
it("renders a full valid JSON document and refuses malformed document content", () => {
  const props = base([{ id: "json", label: "JSON passage", value: { passage: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Full JSON paragraph" }] }] } } }]);
  const view = render(<SpecimenRichPassage {...props} />);
  expect(screen.getByText("Full JSON paragraph")).toBeVisible();
  view.rerender(<SpecimenRichPassage {...base([{ id: "bad", label: "Invalid", value: { passage: { type: "doc", content: [{ type: "not-a-node" }] } } }])} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
});

it("preserves headings, lists, links, escaped code and tables through the selected RichText API", () => {
  const passage = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Actual document heading" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Actual list item" }] }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Actual reference", marks: [{ type: "link", attrs: { href: "/reference" } }] }] },
    { type: "codeBlock", content: [{ type: "text", text: "<script>actualCode()</script>" }] },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Actual column" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Actual cell" }] }] }] },
    ] },
  ] };
  const view = render(<SpecimenRichPassage {...base([{ id: "actual-document", label: "Actual document", value: { passage } }])} />);
  expect(screen.getByRole("heading", { name: "Actual document heading", level: 2 })).toBeVisible();
  expect(screen.getByRole("listitem")).toHaveTextContent("Actual list item");
  expect(screen.getByRole("link", { name: "Actual reference" })).toHaveAttribute("href", "/reference");
  expect(view.container.querySelector("pre code")).toHaveTextContent("<script>actualCode()</script>");
  expect(view.container.querySelector("script")).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Actual column" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "Actual cell" })).toBeVisible();
  expect(view.container.querySelector("[data-readonly='true']")).toBeTruthy();
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
it("routes caller copy through the declared renderContent part and rejects stale or missing wiring", () => {
  const bound = context.surfaces?.["sections.section-header"];
  if (!bound?.renderContent) throw new Error("The native selected heading port is required.");
  const renderContent = vi.fn<NonNullable<NonNullable<SpecimenRenderParts["sections.specimen-copy-in-context"]>["renderContent"]>>(({ leaf, ...input }) => context.surfaces![leaf]!.renderContent!(input));
  const obsoleteRenderContent = vi.fn(() => null);
  const selected = { ...context, surfaces: { ...context.surfaces, "sections.section-header": { ...bound, renderContent: obsoleteRenderContent } } };
  const cases = copyCases(1), props = { ...base(cases.items, cases.axes, selected), renderParts: { "sections.specimen-copy-in-context": { renderContent } } }, view = render(<SpecimenCopyInContext {...props} />);
  expect(renderContent).toHaveBeenCalledWith({ leaf: "sections.section-header", title: "Produced headline 0", level: 3 });
  expect(obsoleteRenderContent).not.toHaveBeenCalled();
  const { renderContent: _obsolete, ...metadata } = bound;
  view.rerender(<SpecimenCopyInContext {...props} context={{ ...selected, surfaces: { "sections.section-header": metadata } }} />);
  expect(screen.getByRole("heading", { name: "Produced headline 0" })).toBeVisible();
  view.rerender(<SpecimenCopyInContext {...props} context={{ ...selected, surfaces: { "sections.section-header": { ...bound, descriptorHash: "stale" } } }} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull();
  view.rerender(<SpecimenCopyInContext {...props} renderParts={{}} />);
  expect(screen.getByRole("status")).toHaveTextContent("The registered renderContent part is not wired.");
  expect(screen.queryByRole("heading")).toBeNull();
});

it("routes headline, error and empty copy values through the declared native surface part", () => {
  const renderContent = vi.fn<NonNullable<NonNullable<SpecimenRenderParts["sections.specimen-copy-in-context"]>["renderContent"]>>(({ leaf, ...input }) => context.surfaces![leaf]!.renderContent!(input));
  const cases = copyCases(6);
  render(<SpecimenCopyInContext {...base(cases.items, cases.axes)} expanded renderParts={{ "sections.specimen-copy-in-context": { renderContent } }} />);
  expect(renderContent).toHaveBeenCalledWith({ leaf: "sections.section-header", title: "Produced headline 0", level: 3 });
  expect(renderContent).toHaveBeenCalledWith({ leaf: "sections.empty-state", title: "Produced error 4", role: "alert" });
  expect(renderContent).toHaveBeenCalledWith({ leaf: "sections.empty-state", title: "Produced empty 5" });
});

const viewportCases = (count: number) => pageViewportCases({ id: "page", label: "Emitted page" }, Array.from({ length: count }, (_, index) => ({ id: `width-${index}`, label: index === 0 ? "Desktop" : index === 1 ? "Mobile" : `Width ${index}`, width: index === 0 ? 1440 : 390 + index, height: 900 })), { page: "Page", viewport: "Viewport" });
it.each([1, 2, 15])("dispatches %i page viewport cases through the declared native engine part", count => {
  const native = nativePagePreview(), renderViewport = vi.fn(native.renderViewport), obsoleteRenderViewport = vi.fn(() => null);
  const selected: DesignerSpecimenContext = { ...context, pagePreview: { ...native, renderViewport: obsoleteRenderViewport } };
  const cases = viewportCases(count), props = { ...base(cases.items, cases.axes, selected), renderParts: { "sections.specimen-page-viewports": { renderViewport } } }, view = render(<SpecimenPageViewports {...props} />);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(count);
  expect(view.container.querySelector("[data-publication-route='/actual-route'][data-publication-stage='emitted']")).toBeTruthy();
  for (const [index, frame] of [...view.container.querySelectorAll("iframe")].entries()) {
    const viewport = cases.items[index]!.value.viewport;
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame).toHaveAttribute("width", String(viewport.width));
    expect(frame).toHaveAttribute("height", String(viewport.height));
    expect(frame).toHaveStyle({ pointerEvents: "none" });
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:4300/preview/publication/pages/page.html");
  }
  expect(renderViewport).toHaveBeenCalledWith({ page: native.pages[0], viewport: cases.items[0]!.value.viewport, interactive: false, fullSize: false });
  expect(obsoleteRenderViewport).not.toHaveBeenCalled();
  if (count === 1) expect(view.container.querySelector("table,[role='grid'],button")).toBeNull();
  view.rerender(<SpecimenPageViewports {...props} expanded />);
  expect(renderViewport).toHaveBeenLastCalledWith(expect.objectContaining({ fullSize: true, interactive: false }));
});
it("fails missing emit, missing native engine, unsafe origin and URL-card-shaped input", () => {
  const cases = viewportCases(2), props = base(cases.items, cases.axes), view = render(<SpecimenPageViewports {...props} />);
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  expect(contentSpecimenNeeds("sections.specimen-page-viewports", props)).not.toEqual([]);
  const native = nativePagePreview(), renderViewport = vi.fn(native.renderViewport), renderParts = { "sections.specimen-page-viewports": { renderViewport } };
  for (const origin of ["http://localhost:4300", "https://example.invalid", "http://127.0.0.1:4300/path", "http://127.0.0.1:999999"]) {
    const selected: DesignerSpecimenContext = { ...context, pagePreview: { ...native, origin } };
    const invalid = { ...base(cases.items, cases.axes, selected), renderParts };
    expect(contentSpecimenNeeds("sections.specimen-page-viewports", invalid)).not.toEqual([]);
    view.rerender(<SpecimenPageViewports {...invalid} />);
    expect(view.container.querySelector("iframe")).toBeNull();
  }
  expect(renderViewport).not.toHaveBeenCalled();
  const notEmitted: DesignerSpecimenContext = { ...context, pagePreview: nativePagePreview(false) };
  view.rerender(<SpecimenPageViewports {...base(cases.items, cases.axes, notEmitted)} renderParts={renderParts} />);
  expect(renderViewport).not.toHaveBeenCalled();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  view.rerender(<SpecimenPageViewports {...base([{ id: "url", label: "URL card", value: { url: "/preview/publication/pages/page.html" } }])} renderParts={renderParts} />);
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
  view.rerender(<SpecimenPageViewports {...base(cases.items, cases.axes, { ...context, pagePreview: native })} renderParts={{}} />);
  expect(screen.getByRole("status")).toHaveTextContent("The registered renderViewport part is not wired.");
  expect(view.container.querySelector("iframe")).toBeNull();
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
