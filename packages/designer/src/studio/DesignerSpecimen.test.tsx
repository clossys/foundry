import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve, loadSectionRegistry, loadComponentRegistry, applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import type { CompositeResolved, CompositeCatalogData, FrameSlot } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import { DesignerSpecimen, type DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import type { SurfaceCandidateDocument, SurfaceSlot } from "../catalog-core/surface-types.js";

const catalog = loadCatalog();
const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "specimen-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
type MutableContext = { -readonly [Key in keyof DesignerSpecimenContext]: DesignerSpecimenContext[Key] };
function context(): MutableContext {
  return { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values: structuredClone(values), components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules } };
}
const need = ({ leaf, reason }: { leaf: string; reason: string }) => <components.SemanticContent as="p" data-ds-leaf="components.semantic-content" role="status">NEED {leaf}: {reason}</components.SemanticContent>;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("applies resolved colors and both contrast pairs inside selected consumer chrome, with no source text", () => {
  const selected = context();
  const Content = forwardRef<HTMLElement, Record<string, unknown>>(function ConsumerContent(props, ref) {
    return <components.SemanticContent {...props as ComponentProps<typeof components.SemanticContent>} as={(props.as ?? "div") as "div"} ref={ref as never} data-consumer-chrome="selected" />;
  });
  selected.modules = { ...selected.modules, "@clossys/designer/components": { ...components, SemanticContent: Content } };
  const { container } = render(<DesignerSpecimen leaf="tokens.accent-color" context={selected} need={need} />);
  const member = selected.profile.values.members["tokens.accent-color.default"]!;
  expect(screen.getByRole("img", { name: "tokens.accent-color.default light" })).toHaveStyle({ background: member.css.light });
  expect(screen.getByRole("img", { name: "tokens.accent-color.default dark" })).toHaveStyle({ background: member.css.dark });
  expect(container.querySelector("[data-contrast-pair='tokens.text-color.primary']")).toBeTruthy();
  expect(container.querySelectorAll("[data-consumer-chrome='selected']").length).toBeGreaterThan(4);
  for (const node of container.querySelectorAll("*")) expect(node.closest("[data-ds-leaf]")).toBeTruthy();
  expect(container.textContent).not.toMatch(/originKinds:|confirmed:|\$extensions|## Fill|```/);
  expect(container.querySelector("textarea,[contenteditable='true']")).toBeNull();
});

it("draws type scales, spacing and radius using the actual selected values", () => {
  const selected = context();
  const type = render(<DesignerSpecimen leaf="tokens.heading-size" context={selected} need={need} />);
  const sample = type.container.querySelector<HTMLElement>("[data-type-sample]")!;
  expect(sample).toBeTruthy();
  expect(sample.style.fontSize).toBe(selected.profile.values.members[sample.dataset.typeSample!]!.css.light);
  type.unmount();
  const spacing = render(<DesignerSpecimen leaf="tokens.spacing" context={selected} need={need} />);
  const ruler = spacing.getAllByRole("img")[0] as HTMLElement;
  expect(ruler.style.inlineSize).toBe(selected.profile.values.members[ruler.getAttribute("aria-label")!]!.css.light);
  spacing.unmount();
  const radius = render(<DesignerSpecimen leaf="tokens.radius" context={selected} need={need} />);
  const box = radius.getAllByRole("img")[0] as HTMLElement;
  expect(box.style.borderRadius).toBe(selected.profile.values.members[box.getAttribute("aria-label")!]!.css.light);
});

it("plays the selected motion values and cancels for reduced motion and unmount", () => {
  const selected = context();
  let reduced = false;
  const change = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => change.add(fn), removeEventListener: (_: string, fn: () => void) => change.delete(fn) }));
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  const result = render(<DesignerSpecimen leaf="tokens.duration" context={selected} need={need} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Play motion" })[0]!);
  const duration = Object.values(selected.profile.values.members).find(value => value.slot === "tokens.duration")!;
  const easing = Object.values(selected.profile.values.members).find(value => value.$type === "cubicBezier")!;
  expect(animate).toHaveBeenCalledWith(expect.any(Array), { duration: Number.parseFloat(duration.css.light) * (duration.css.light.endsWith("ms") ? 1 : 1000), easing: easing.css.light });
  reduced = true;
  fireEvent.click(screen.getAllByRole("button", { name: "Play motion" })[0]!);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Reduced motion");
  expect(cancel).toHaveBeenCalled();
  result.unmount();
  expect(change.size).toBe(0);
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

it("shows actual SVG and icon artwork on both grounds", () => {
  const selected = context();
  const logo = render(<DesignerSpecimen leaf="assets.favicon" context={selected} need={need} />);
  expect(logo.container.querySelectorAll("[data-asset-ground]")).toHaveLength(2);
  expect(logo.getAllByRole("img")[0]).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml,"));
  logo.unmount();
  const glyph = render(<DesignerSpecimen leaf="assets.icon-close" context={selected} need={need} />);
  expect(glyph.container.querySelectorAll("svg")).toHaveLength(2);
  expect(glyph.container.querySelector("[data-ds-leaf='components.icon']")).toBeTruthy();
});

it("renders the selected live component variants and real disabled/invalid fixtures", () => {
  const selected = context();
  const result = render(<DesignerSpecimen leaf="components.text-field" context={selected} need={need} />);
  const disabled = result.container.querySelector("[data-specimen-state='disabled']")!;
  expect(within(disabled as HTMLElement).getAllByRole("textbox").every(input => (input as HTMLInputElement).disabled)).toBe(true);
  const invalid = result.container.querySelector("[data-specimen-state='invalid']")!;
  expect(invalid.querySelector("[aria-invalid='true']")).toBeTruthy();
  expect(result.container.querySelector("[data-specimen-source='foundry']")).toBeTruthy();
  expect(result.container.querySelectorAll("[data-component-specimen]").length).toBeGreaterThan(5);
  expect(screen.getByText(/Hover the live specimen/)).toBeVisible();
  expect(screen.getByText(/Focus the live specimen/)).toBeVisible();
});

it("uses the chosen implementation export and refuses absent module bindings", () => {
  const selected = context();
  const ConsumerButton = (props: Record<string, unknown>) => <components.Button {...props}>Selected consumer button</components.Button>;
  selected.modules = { ...selected.modules, "@clossys/designer/components": { ...components, Button: ConsumerButton } };
  const result = render(<DesignerSpecimen leaf="components.button" context={selected} need={need} />);
  expect(screen.getAllByRole("button", { name: "Selected consumer button" }).length).toBeGreaterThan(5);
  result.unmount();
  selected.modules = {};
  render(<DesignerSpecimen leaf="components.button" context={selected} need={need} />);
  expect(screen.getByRole("status")).toHaveTextContent("module-unavailable");
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps missing selections as NEED and never borrows a catalog default", () => {
  const selected = context();
  render(<DesignerSpecimen leaf="sections.content" context={selected} need={need} />);
  expect(screen.getByRole("status")).toHaveTextContent("not-chosen");
  cleanup();
  render(<DesignerSpecimen leaf="tokens.accent-color" need={need} />);
  expect(screen.getByRole("status")).toHaveTextContent("Consumer Designer resolution is unavailable");
});

it("renders native selected section/frame fixtures in actual desktop/mobile viewports and refuses stale source bindings", async () => {
  const selected = context();
  const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills].filter(doc => ["sections.content", "frames.auth-shell"].includes(doc.$extensions["com.clossys.fill"].slot));
  const surfaceCatalog: CompositeCatalogData = { values: catalog, components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: { slots: [...loadSectionRegistry().slots, ...frameSlots as unknown as FrameSlot[]], fills: fills as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] } };
  const nativeValues = completedCatalogLibrary(catalog, { id: "surface-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29");
  const { source, adoptedAt, ...portion } = nativeValues;
  const empty = { source, adoptedAt, values: portion, components: { fills: [], files: [] }, surfaces: { version: 1 as const, fills: [], files: [] } };
  const surfaceOptions = { packages: await readSurfacePackageEvidence(fills), measurements: [] };
  const library = applyLibraryChange(surfaceCatalog, empty, { baseHash: libraryHash(empty), changes: fills.map(doc => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: doc.$extensions["com.clossys.fill"].slot as SurfaceSlot, source: "foundry" } })) }, { surfaceOptions });
  const profile = resolve({ catalog: surfaceCatalog, library, surfaceOptions });
  selected.profile = { ...selected.profile, surfaces: profile.surfaces };
  const resolved = selected.profile.surfaces!.fills["sections.content"]!;
  const result = render(<DesignerSpecimen leaf="sections.content" context={selected} need={need} />);
  expect(result.container.querySelectorAll("[data-specimen-viewport]")).toHaveLength(2);
  const mobile = result.container.querySelector<HTMLIFrameElement>("iframe[width='375']")!;
  fireEvent.load(mobile);
  expect(mobile.contentDocument!.body.textContent).toMatch(/\S/);
  expect(mobile.contentDocument!.body.querySelector("[data-ds-leaf='sections.content']")).toBeTruthy();
  expect(mobile).toHaveAttribute("sandbox", "allow-same-origin");
  expect(result.container.querySelector("[data-ds-leaf='sections.content']")).toBeTruthy();
  result.unmount();
  const frame = render(<DesignerSpecimen leaf="frames.auth-shell" context={selected} need={need} />);
  const desktop = frame.container.querySelector<HTMLIFrameElement>("iframe[width='1280']")!;
  expect(desktop).toBeTruthy();
  fireEvent.load(desktop);
  expect(desktop.contentDocument!.body.querySelector("[data-ds-leaf='frames.auth-shell']")).toBeTruthy();
  frame.unmount();
  selected.surfaces = { "sections.content": { descriptorHash: "stale", render: () => "wrong source" } };
  render(<DesignerSpecimen leaf="sections.content" context={selected} need={need} />);
  expect(screen.getByRole("status")).toHaveTextContent("no matching runtime specimen binding");
  expect(screen.queryByText("wrong source")).toBeNull();
}, 30_000);
