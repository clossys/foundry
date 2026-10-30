import { Suspense, type ReactNode } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as components from "../components/index.js";
import * as blocks from "../blocks/index.js";
import * as frames from "../frames/index.js";
import * as charts from "../charts/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve, loadSectionRegistry, loadComponentRegistry, applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfacePrimary } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData, CompositeResolved, FrameSlot } from "../catalog-core/types.js";
import type { SurfaceCandidateDocument, SurfaceSlot } from "../catalog-core/surface-types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { renderNativeSpecimenViewport } from "../../../producer/studio/lib/native-specimen-preview.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { emittedDesignerSpecimenContext } from "./emitted-specimens.js";
import type { SpecimenSurfaceRenderRequest } from "./specimen-layouts.js";
import { surfaceSpecimenItems, SpecimenSectionViewports } from "./specimen-viewports.js";

let context: DesignerSpecimenContext;
const labels = { showAllVariants: (count: number) => `All ${count}` };
const need = ({ reason }: { leaf: string; reason: string }) => <components.SemanticContent as="p" role="status">{reason}</components.SemanticContent>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll("[data-native-preview-test-style]").forEach(node => node.remove()); document.documentElement.removeAttribute("data-native-preview-test-revision"); });

beforeAll(async () => {
  const valuesCatalog = loadCatalog();
  const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills].filter(doc => ["sections.content", "frames.auth-shell"].includes(doc.$extensions["com.clossys.fill"].slot));
  const catalog: CompositeCatalogData = { values: valuesCatalog, components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: { slots: [...loadSectionRegistry().slots, ...frameSlots as unknown as FrameSlot[]], fills: fills as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] } };
  const values = completedCatalogLibrary(valuesCatalog, { id: "viewport-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const { source, adoptedAt, ...portion } = values;
  const empty = { source, adoptedAt, values: portion, components: { fills: [], files: [] }, surfaces: { version: 1 as const, fills: [], files: [] } };
  const surfaceOptions = { packages: await readSurfacePackageEvidence(fills), measurements: [] };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: fills.map(doc => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: doc.$extensions["com.clossys.fill"].slot as SurfaceSlot, source: "foundry" } })) }, { surfaceOptions });
  const resolved = resolve({ catalog, library, surfaceOptions });
  const profile = { ...resolved, components: structuredClone(componentData) } as CompositeResolved;
  const namespaces: Record<string, Record<string, unknown>> = { "@clossys/designer/blocks": blocks, "@clossys/designer/frames": frames };
  // Use the native emitted surface-index convention and each selected package's actual export.
  const surfaces = Object.fromEntries(Object.values(profile.surfaces!.fills).map(selected => {
    const entry = surfaceEntryOf(selected.document);
    if (!isSurfacePackageEntry(entry)) throw new Error("The viewport fixture requires the selected native package surface.");
    const Component = namespaces[entry.impl.module]?.[entry.impl.export];
    if (!Component) throw new Error(`The selected surface export is unavailable: ${entry.impl.module}#${entry.impl.export}`);
    return [surfacePrimary(entry.slot), Component];
  }));
  const emitted = emittedDesignerSpecimenContext(profile, { components, surfaces });
  context = { profile, modules: { "@clossys/designer/components": components, "@clossys/designer/charts": charts, ...defaultSourceModules }, surfaces: emitted.surfaces };
});

function selected(children: ReactNode) {
  const descriptors = Object.fromEntries(Object.entries(context.profile.components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)]));
  return <ConsumerComponentProvider value={{ profile: context.profile, selectionHash: context.profile.components.selectionHash, modules: context.modules, descriptors }}><Suspense>{children}</Suspense></ConsumerComponentProvider>;
}

it("retains native case identities while applying the selected emitted breakpoint tokens", () => {
  const section = surfaceSpecimenItems(context, "sections.content");
  expect(section.items.map(item => item.id)).toEqual(["sections.content/1280", "sections.content/375"]);
  expect(section.items.map(item => item.value.width)).toEqual([`var(${context.profile.values.members["tokens.breakpoint.desktop"]!.emit})`, `var(${context.profile.values.members["tokens.breakpoint.mobile"]!.emit})`]);
  expect(context.profile.values.members["tokens.breakpoint.desktop"]!.value.light).toEqual({ unit: "rem", value: 80 });
  const frame = surfaceSpecimenItems(context, "frames.auth-shell");
  expect(frame.items.map(item => item.id)).toEqual(["frames.auth-shell/default"]);
  expect(frame.items[0]!.value.width).toBe(`var(${context.profile.values.members["tokens.breakpoint.desktop"]!.emit})`);
});

it("refuses unavailable or mismapped selected breakpoint emissions", () => {
  const members = context.profile.values.members;
  const missing = { ...context, profile: { ...context.profile, values: { ...context.profile.values, members: Object.fromEntries(Object.entries(members).filter(([id]) => id !== "tokens.breakpoint.mobile")) } } };
  expect(surfaceSpecimenItems(missing, "sections.content")).toEqual({ items: [], axes: [] });
  const mismapped = { ...context, profile: { ...context.profile, values: { ...context.profile.values, members: { ...members, "tokens.breakpoint.desktop": { ...members["tokens.breakpoint.desktop"]!, emit: "--other-desktop" as const } } } } };
  expect(surfaceSpecimenItems(mismapped, "sections.content")).toEqual({ items: [], axes: [] });
});

it("refuses missing declared parts under the authenticated selected provider without mounting an iframe", async () => {
  const cases = surfaceSpecimenItems(context, "sections.content");
  const view = render(selected(<SpecimenSectionViewports items={cases.items.slice(0, 1)} context={context} need={need} labels={labels} />));
  expect(await screen.findByRole("status")).toHaveTextContent("The selected specimen section has no declared surface and viewport render parts.");
  expect(view.container.querySelector("iframe,[data-designer-specimen-frame]")).toBeNull();
});

const SelectedContent = componentLeaf<typeof components.SemanticContent>("components.semantic-content");

/** Deterministic browser measurement boundary; the real iframe, portal and selected components still mount. */
function measurementBoundary(initialContainerWidth: number, initialViewportWidth: number) {
  let containerWidth = initialContainerWidth, viewportWidth = initialViewportWidth;
  const observers: BoundaryResizeObserver[] = [];
  class BoundaryResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();
    readonly disconnect = vi.fn(() => this.targets.clear());
    constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    notify() { this.callback(Array.from(this.targets, target => ({ target, contentRect: { width: target.clientWidth, height: target.scrollHeight } }) as ResizeObserverEntry), this); }
  }
  vi.stubGlobal("ResizeObserver", BoundaryResizeObserver);
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => containerWidth);
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const result = computedStyle(element, pseudo);
    if (!(element instanceof HTMLElement) || element.style.visibility !== "hidden" || element.style.position !== "absolute") return result;
    return new Proxy(result, { get(target, key) {
      if (key === "inlineSize") return `${viewportWidth}px`;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const notify = () => act(() => { for (const observer of observers) observer.notify(); });
  return {
    observers, notify,
    resize(container: number, viewport = viewportWidth) { containerWidth = container; viewportWidth = viewport; notify(); },
    frame(frame: HTMLIFrameElement, documentHeight: () => number) {
      const document = frame.contentDocument!, view = frame.contentWindow!;
      Object.defineProperty(view, "ResizeObserver", { configurable: true, value: BoundaryResizeObserver });
      Object.defineProperty(view, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => view.setTimeout(() => callback(performance.now()), 0) });
      Object.defineProperty(view, "cancelAnimationFrame", { configurable: true, value: (handle: number) => view.clearTimeout(handle) });
      Object.defineProperty(document.body, "scrollHeight", { configurable: true, get: documentHeight });
      return { document, view };
    },
  };
}

it("measures the native iframe scale, live document height and portal revisions and releases observers/listeners", async () => {
  const boundary = measurementBoundary(480, 1280), widths: number[] = [];
  const addWindow = vi.spyOn(window, "addEventListener"), removeWindow = vi.spyOn(window, "removeEventListener");
  const stylesheet = document.createElement("style"); stylesheet.setAttribute("data-native-preview-test-style", ""); document.head.append(stylesheet);
  document.documentElement.setAttribute("data-native-preview-test-revision", "one");
  let height = 900;
  const draw = (revision: string) => selected(renderNativeSpecimenViewport({ Content: SelectedContent, leaf: "sections.content", width: "var(--breakpoint-desktop)", need, children: width => { widths.push(width); return <SelectedContent as="p">{revision}</SelectedContent>; } }));
  const view = render(draw("Native revision one"));
  const frame = await waitFor(() => {
    const frame = view.container.querySelector("iframe");
    expect(frame).toBeTruthy(); return frame!;
  });
  const native = boundary.frame(frame, () => height);
  const addDocument = vi.spyOn(native.document, "addEventListener"), removeDocument = vi.spyOn(native.document, "removeEventListener");
  fireEvent.load(frame);
  await waitFor(() => expect(native.document.body).toHaveTextContent("Native revision one"));
  await waitFor(() => expect(frame).toHaveAttribute("height", "900"));
  expect(widths.at(-1)).toBe(1280);
  expect(frame).toHaveAttribute("width", "1280");
  expect((frame.parentElement as HTMLElement).style.zoom).toBe(String(480 / 1280));
  expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
  expect(frame).toHaveAttribute("tabindex", "-1");
  expect(frame).toHaveStyle({ pointerEvents: "none", border: "0px" });
  expect(native.document.querySelector("[data-designer-specimen-frame='sections.content']")).toHaveAttribute("inert");
  expect(native.document.head.querySelector("[data-native-preview-test-style]")).toBeTruthy();
  expect(native.document.documentElement).toHaveAttribute("data-native-preview-test-revision", "one");
  stylesheet.textContent = "/* live selected stylesheet revision */";
  document.documentElement.setAttribute("data-native-preview-test-revision", "two");
  await waitFor(() => expect(native.document.head.querySelector("[data-native-preview-test-style]")?.textContent).toBe("/* live selected stylesheet revision */"));
  expect(native.document.documentElement).toHaveAttribute("data-native-preview-test-revision", "two");

  height = 350; boundary.notify();
  await waitFor(() => expect(frame).toHaveAttribute("height", "350"));
  height = 1100; boundary.notify();
  await waitFor(() => expect(frame).toHaveAttribute("height", "1100"));
  boundary.resize(640);
  await waitFor(() => expect((frame.parentElement as HTMLElement).style.zoom).toBe(String(640 / 1280)));
  view.rerender(draw("Native revision two"));
  await waitFor(() => expect(native.document.body).toHaveTextContent("Native revision two"));
  expect(view.container.querySelector("iframe")).toBe(frame);

  const resizeListener = addWindow.mock.calls.find(([name]) => name === "resize")?.[1];
  const loadListener = addDocument.mock.calls.find(([name, , capture]) => name === "load" && capture === true)?.[1];
  expect(resizeListener).toBeTypeOf("function"); expect(loadListener).toBeTypeOf("function");
  expect(boundary.observers.some(observer => observer.targets.has(native.document.body))).toBe(true);
  view.unmount();
  expect(boundary.observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
  expect(removeWindow).toHaveBeenCalledWith("resize", resizeListener);
  expect(removeDocument).toHaveBeenCalledWith("load", loadListener, true);
  expect(native.document.querySelector("[data-designer-specimen-frame]")).toBeNull();
});

it("routes measured native widths through the declared surface part to the actual selected fixture", async () => {
  const boundary = measurementBoundary(480, 1280);
  const renderSurface = vi.fn(({ leaf, width, state }: SpecimenSurfaceRenderRequest) => context.surfaces![leaf]!.render({ width, state }));
  const cases = surfaceSpecimenItems(context, "sections.content");
  const view = render(selected(<SpecimenSectionViewports items={cases.items.slice(0, 1)} context={context} need={need} labels={labels} renderParts={{ "sections.specimen-section-viewports": { renderViewport: renderNativeSpecimenViewport, renderSurface } }} />));
  const frame = await waitFor(() => {
    const frame = view.container.querySelector("iframe");
    expect(frame).toBeTruthy(); return frame!;
  });
  const native = boundary.frame(frame, () => 900);
  fireEvent.load(frame);
  await waitFor(() => expect(native.document.querySelector("[data-ds-leaf='sections.content']")).toBeTruthy());
  expect(renderSurface).toHaveBeenLastCalledWith({ leaf: "sections.content", width: 1280, state: "default" });
  boundary.resize(480, 1440);
  await waitFor(() => expect(renderSurface).toHaveBeenLastCalledWith({ leaf: "sections.content", width: 1440, state: "default" }));
  expect(frame).toHaveAttribute("width", "1440");
});
