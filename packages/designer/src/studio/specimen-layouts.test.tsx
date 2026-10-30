import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { SpecimenLayoutSection, specimenLayoutNeeds, type SpecimenAxis, type SpecimenItem } from "./specimen-layouts.js";
import { componentSpecimenItems, SpecimenVariantMatrix } from "./specimen-viewports.js";
import { NativeSpecimenStateClone } from "./specimen-state-clone.js";

const catalog = loadCatalog();
const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "layout-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
const context = (): DesignerSpecimenContext => ({ profile: { consumer: values.consumer, selectionHash: values.selectionHash, values: structuredClone(values), components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules } });
const need = ({ reason }: { leaf: string; reason: string }) => <components.SemanticContent as="p" role="status">NEED: {reason}</components.SemanticContent>;
const labels = { showAllVariants: (count: number) => `Show all ${count} variants` };
const items = (count: number): SpecimenItem[] => Array.from({ length: count }, (_, index) => ({ id: String(index), label: `Token ${index}`, value: index }));
const draw = (item: SpecimenItem) => <components.Button>{item.label}</components.Button>;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["ladder", "grid", "matrix"] as const)("%s renders one item with no collection, header, or disclosure", layout => {
  const props = { id: "sections.specimen-variant-matrix" as const, layout, items: items(1), context: context(), need, labels };
  expect(specimenLayoutNeeds(props)).toEqual([]);
  const view = render(<SpecimenLayoutSection {...props} label="Specimen" renderItem={draw} />);
  expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(1);
  expect(view.container.querySelector('table,[role="grid"],h3,h4,[data-ds-leaf="components.disclosure"]')).toBeNull();
  expect(view.container.querySelector("[data-ds-specimen-layout='single']")).toBeTruthy();
});

it.each(["ladder", "grid"] as const)("%s owns first12, native in-place disclosure, and full expanded mode", layout => {
  const props = { id: "sections.specimen-type-ladder" as const, layout, label: "Scale", items: items(15), context: context(), need, labels, renderItem: draw };
  const view = render(<SpecimenLayoutSection {...props} />);
  const all = [...view.container.querySelectorAll("[data-ds-specimen-item]")];
  expect(all).toHaveLength(15);
  for (const item of all.slice(0, 12)) expect(item).toBeVisible();
  for (const item of all.slice(12)) expect(item).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show all 15 variants" }));
  for (const item of all) expect(item).toBeVisible();
  view.unmount();
  const full = render(<SpecimenLayoutSection {...props} expanded />);
  for (const item of full.container.querySelectorAll("[data-ds-specimen-item]")) expect(item).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});

function matrix() {
  const axes: SpecimenAxis[] = [{ id: "variant", label: "Variant", values: [{ id: "primary", label: "Primary" }, { id: "secondary", label: "Secondary" }] }, { id: "state", label: "State", values: [{ id: "live", label: "Live" }, { id: "disabled", label: "Disabled" }] }, { id: "size", label: "Size", values: [{ id: "sm", label: "Small" }, { id: "lg", label: "Large" }] }];
  const cases = axes[2]!.values.flatMap(size => axes[0]!.values.flatMap(variant => axes[1]!.values.map(state => ({ id: `${size.id}/${variant.id}/${state.id}`, label: `${variant.label} ${state.label}`, coordinates: { size: size.id, variant: variant.id, state: state.id }, value: state.id }))));
  return { axes, items: cases };
}
it("stacks labelled third-axis matrices and exposes one initial row block", () => {
  const view = render(<SpecimenLayoutSection id="sections.specimen-variant-matrix" label="Variants" layout="matrix" {...matrix()} context={context()} need={need} labels={labels} renderItem={draw} />);
  expect(screen.getAllByRole("columnheader", { name: "Live" }).length).toBeGreaterThan(0);
  const all = [...view.container.querySelectorAll("[data-ds-specimen-item]")];
  expect(all).toHaveLength(8);
  expect(all.filter(item => !(item.closest("[hidden]")))).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Show all 8 variants" }));
  for (const item of all) expect(item).toBeVisible();
  expect(view.container.querySelector('[data-specimen-matrix-group="lg"]')).toHaveTextContent("Size: Large");
});
it("turns a mobile matrix into labelled native stacked groups with no horizontal scroller", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const view = render(<SpecimenLayoutSection id="sections.specimen-variant-matrix" label="Variants" layout="matrix" {...matrix()} context={context()} need={need} labels={labels} renderItem={draw} expanded />);
  await waitFor(() => expect(view.container.querySelector('[data-specimen-matrix-mobile="true"]')).toBeTruthy());
  expect(view.container.querySelector("table")).toBeNull();
  expect(screen.getAllByText("State: Live")).toHaveLength(4);
  expect(view.container.querySelector('[class*="overflow-auto"],[class*="overflow-x"]')).toBeNull();
});
it("rejects empty inputs and real missing native parts before counting any proper specimen", () => {
  const props = { id: "sections.specimen-type-ladder" as const, layout: "ladder" as const, items: [], context: context(), need, labels };
  expect(specimenLayoutNeeds(props).length).toBeGreaterThan(0);
  render(<SpecimenLayoutSection {...props} label="Scale" renderItem={draw} />);
  expect(screen.getByRole("status")).toHaveTextContent("at least one");
  cleanup();
  const selected = context();
  const broken = { ...selected, modules: { ...selected.modules, "@clossys/designer/components": { ...components, GridList: () => null } } };
  expect(specimenLayoutNeeds({ ...props, items: items(2), context: broken })).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("item part") }));
});
it("enumerates the native descriptor's full variant×state×size universe and honors selected overrides", () => {
  const selected = context(), cases = componentSpecimenItems(selected, "components.button");
  const descriptor = selected.profile.components.components["components.button"]!.descriptor;
  const variants = descriptor.members.filter(member => member.startsWith("variant."));
  expect(cases.axes[0]!.values.map(value => value.id)).toEqual(["default", ...variants]);
  expect(cases.items).toHaveLength(cases.axes.reduce((count, axis) => count * axis.values.length, 1));
  const first = { id: "registered-secondary", label: "Secondary", value: { leaf: "components.button", members: ["variant.secondary"], state: "default" } };
  const view = render(<SpecimenVariantMatrix items={[first]} context={selected} need={need} labels={labels} />);
  expect(screen.getByRole("button")).toHaveClass("border-line-control");
  expect(view.container.textContent).not.toMatch(/originKinds:|\$extensions|```/);
});
it.each(["hover", "focus-visible", "pressed"] as const)("captures a real native %s state into an inert eventless clone", async state => {
  if (state === "hover") {
    class NativePointerEvent extends MouseEvent {
      readonly pointerType: string;
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? "mouse"; this.pointerId = init.pointerId ?? 1; }
    }
    vi.stubGlobal("PointerEvent", NativePointerEvent);
  }
  const onPress = vi.fn();
  const view = render(<NativeSpecimenStateClone Content={components.SemanticContent as never} state={state} unavailable={reason => <components.SemanticContent as="p" role="status">{reason}</components.SemanticContent>}><components.Button onPress={onPress}>Native action</components.Button></NativeSpecimenStateClone>);
  await waitFor(() => expect(view.container.querySelector('[data-ds-specimen-capture="ready"]')).toBeTruthy());
  const clone = view.container.querySelector("[data-ds-state-clone]")!;
  expect(clone).toHaveAttribute("inert");
  expect(clone.querySelector(`[data-${state === "hover" ? "hovered" : state === "pressed" ? "pressed" : "focus-visible"}]`)).toBeTruthy();
  fireEvent.click(clone.querySelector("button")!);
  expect(onPress).not.toHaveBeenCalled();
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
});
