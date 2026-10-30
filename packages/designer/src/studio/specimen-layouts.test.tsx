import { afterEach, expect, it, vi } from "vitest";
import { Suspense, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { emittedTokenProperties, loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { SpecimenLayoutSection, specimenLayoutNeeds, type SpecimenAxis, type SpecimenItem } from "./specimen-layouts.js";
import { componentSpecimenItems, SpecimenVariantMatrix } from "./specimen-viewports.js";
import { NativeSpecimenStateClone } from "./specimen-state-clone.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentCatalog, type ComponentLibrary } from "../catalog-core/resolve-components.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { renderNativeSpecimenComponentState } from "../../../producer/studio/lib/native-specimen-preview.js";

const catalog = loadCatalog();
const valueLibrary = completedCatalogLibrary(catalog, { id: "layout-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29");
const values = resolve({ catalog, library: valueLibrary });
const componentCatalog: ComponentCatalog = { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills as unknown as ComponentCatalog["fills"] };
const emptyComponents: ComponentLibrary = { source: valueLibrary.source, adoptedAt: "2026-10-29", fills: [], files: [] };
const disclosureLibrary = applyComponentLibraryChange(componentCatalog, emptyComponents, { baseHash: componentLibraryHash(emptyComponents), changes: [{ op: "adopt", slot: "components.disclosure", source: "foundry" }] });
const nativeDisclosure = resolveComponents({ catalog: componentCatalog, library: disclosureLibrary, values: {
  tokens: Object.fromEntries([...emittedTokenProperties(values)].map(([id, output]) => [id, { property: output.property, light: values.members[id]!.css.light }])),
  assets: [...new Set(Object.values(values.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))],
} });
// Unit context: refresh disclosure through real adoption; the remaining saved selection is runtime-pending.
const context = (): DesignerSpecimenContext => {
  const selected = structuredClone(componentData);
  return { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values: structuredClone(values), components: { ...selected, components: { ...selected.components, ...nativeDisclosure.components } } } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules } };
};
const need = ({ reason }: { leaf: string; reason: string }) => <components.SemanticContent as="p" role="status">NEED: {reason}</components.SemanticContent>;
const labels = { showAllVariants: (count: number) => `Show all ${count} variants` };
const items = (count: number): SpecimenItem[] => Array.from({ length: count }, (_, index) => ({ id: String(index), label: `Token ${index}`, value: index }));
const draw = (item: SpecimenItem) => <components.Button>{item.label}</components.Button>;
async function renderSelected(children: ReactNode, selected = context()) {
  const view = render(<ConsumerComponentProvider value={{ profile: selected.profile, selectionHash: selected.profile.components.selectionHash, modules: selected.modules, descriptors: Object.fromEntries(Object.entries(selected.profile.components.components).map(([id, chosen]) => [id, componentDescriptorHash(chosen.descriptor)])) }}><Suspense>{children}</Suspense></ConsumerComponentProvider>);
  await waitFor(() => expect(view.container.childElementCount).toBeGreaterThan(0));
  return view;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["ladder", "grid", "matrix"] as const)("%s renders one item with no collection, header, or disclosure", async layout => {
  const props = { id: "sections.specimen-variant-matrix" as const, layout, items: items(1), context: context(), need, labels };
  expect(specimenLayoutNeeds(props)).toEqual([]);
  const view = await renderSelected(<SpecimenLayoutSection {...props} label="Specimen" renderItem={draw} />, props.context);
  expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(1);
  expect(view.container.querySelector('table,[role="grid"],h3,h4,[data-ds-leaf="components.disclosure"]')).toBeNull();
  expect(view.container.querySelector("[data-ds-specimen-layout='single']")).toBeTruthy();
});

it.each(["ladder", "grid"] as const)("%s owns first12, native in-place disclosure, and full expanded mode", async layout => {
  const props = { id: "sections.specimen-type-ladder" as const, layout, label: "Scale", items: items(15), context: context(), need, labels, renderItem: draw };
  const view = await renderSelected(<SpecimenLayoutSection {...props} />, props.context);
  const all = [...view.container.querySelectorAll("[data-ds-specimen-item]")];
  expect(all).toHaveLength(15);
  for (const item of all.slice(0, 12)) expect(item).toBeVisible();
  for (const item of all.slice(12)) expect(item).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show all 15 variants" }));
  for (const item of all) expect(item).toBeVisible();
  view.unmount();
  const full = await renderSelected(<SpecimenLayoutSection {...props} expanded />, props.context);
  for (const item of full.container.querySelectorAll("[data-ds-specimen-item]")) expect(item).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});

it("preserves native list row order and arrow-key navigation", async () => {
  const selected = context(), user = userEvent.setup();
  await renderSelected(<SpecimenLayoutSection id="sections.specimen-type-ladder" label="Scale" layout="ladder" items={items(3)} context={selected} need={need} labels={labels} renderItem={draw} />, selected);
  const rows = screen.getAllByRole("row");
  expect(rows.map(row => row.querySelector("[data-ds-specimen-item]")?.getAttribute("data-ds-specimen-item"))).toEqual(["0", "1", "2"]);
  rows[0]!.focus();
  await user.keyboard("{ArrowDown}");
  expect(rows[1]).toHaveFocus();
});

function matrix() {
  const axes: SpecimenAxis[] = [{ id: "variant", label: "Variant", values: [{ id: "primary", label: "Primary" }, { id: "secondary", label: "Secondary" }] }, { id: "state", label: "State", values: [{ id: "live", label: "Live" }, { id: "disabled", label: "Disabled" }] }, { id: "size", label: "Size", values: [{ id: "sm", label: "Small" }, { id: "lg", label: "Large" }] }];
  const cases = axes[2]!.values.flatMap(size => axes[0]!.values.flatMap(variant => axes[1]!.values.map(state => ({ id: `${size.id}/${variant.id}/${state.id}`, label: `${variant.label} ${state.label}`, coordinates: { size: size.id, variant: variant.id, state: state.id }, value: state.id }))));
  return { axes, items: cases };
}
it("stacks labelled third-axis matrices and exposes one initial row block", async () => {
  const selected = context();
  const view = await renderSelected(<SpecimenLayoutSection id="sections.specimen-variant-matrix" label="Variants" layout="matrix" {...matrix()} context={selected} need={need} labels={labels} renderItem={draw} />, selected);
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
  const selected = context();
  const view = await renderSelected(<SpecimenLayoutSection id="sections.specimen-variant-matrix" label="Variants" layout="matrix" {...matrix()} context={selected} need={need} labels={labels} renderItem={draw} expanded />, selected);
  await waitFor(() => expect(view.container.querySelector('[data-specimen-matrix-mobile="true"]')).toBeTruthy());
  expect(view.container.querySelector("table")).toBeNull();
  expect(screen.getAllByText("State: Live")).toHaveLength(4);
  expect(view.container.querySelector('[class*="overflow-auto"],[class*="overflow-x"]')).toBeNull();
});
it("rejects empty inputs and real missing native parts before counting any proper specimen", async () => {
  const props = { id: "sections.specimen-type-ladder" as const, layout: "ladder" as const, items: [], context: context(), need, labels };
  expect(specimenLayoutNeeds(props).length).toBeGreaterThan(0);
  await renderSelected(<SpecimenLayoutSection {...props} label="Scale" renderItem={draw} />, props.context);
  expect(screen.getByRole("status")).toHaveTextContent("at least one");
  cleanup();
  const selected = context();
  const broken = { ...selected, modules: { ...selected.modules, "@clossys/designer/components": { ...components, GridList: () => null } } };
  expect(specimenLayoutNeeds({ ...props, items: items(2), context: broken })).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("item part") }));
});
it("enumerates the native descriptor's full variant×state×size universe and honors selected overrides", async () => {
  const selected = context(), cases = componentSpecimenItems(selected, "components.button");
  const descriptor = selected.profile.components.components["components.button"]!.descriptor;
  const variants = descriptor.members.filter(member => member.startsWith("variant."));
  expect(cases.axes[0]!.values.map(value => value.id)).toEqual(["default", ...variants]);
  expect(cases.items).toHaveLength(cases.axes.reduce((count, axis) => count * axis.values.length, 1));
  const first = { id: "registered-secondary", label: "Secondary", value: { leaf: "components.button", members: ["variant.secondary"], state: "default" } };
  const view = await renderSelected(<SpecimenVariantMatrix items={[first]} context={selected} need={need} labels={labels} renderParts={{ "sections.specimen-variant-matrix": { renderComponentState: renderNativeSpecimenComponentState } }} />, selected);
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
  const view = render(<NativeSpecimenStateClone Content={components.SemanticContent} state={state} unavailable={reason => <components.SemanticContent as="p" role="status">{reason}</components.SemanticContent>}><components.Button onPress={onPress}>Native action</components.Button></NativeSpecimenStateClone>);
  await waitFor(() => expect(view.container.querySelector('[data-ds-specimen-capture="ready"]')).toBeTruthy());
  const clone = view.container.querySelector("[data-ds-state-clone]")!;
  expect(clone).toHaveAttribute("inert");
  expect(clone.querySelector(`[data-${state === "hover" ? "hovered" : state === "pressed" ? "pressed" : "focus-visible"}]`)).toBeTruthy();
  fireEvent.click(clone.querySelector("button")!);
  expect(onPress).not.toHaveBeenCalled();
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
});
