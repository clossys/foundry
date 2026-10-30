import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import * as components from "../components/index.js";
import * as shell from "../shell/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import type { SpecimenItem, SpecimenLeafProps } from "./specimen-layouts.js";
import { assetSpecimenItems, colorRampSpecimenItems, tokenAssetSpecimenLeaves, tokenSpecimenItems } from "./specimen-token-assets.js";

const catalog = loadCatalog();
const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "specimen-test-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
function context(): DesignerSpecimenContext {
  return { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values: structuredClone(values), components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, "@clossys/designer/shell": shell, ...defaultSourceModules } };
}
const need: SpecimenLeafProps["need"] = ({ leaf, reason }) => <components.SemanticContent as="p" role="status" data-ds-specimen-need="true">NEED {leaf}: {reason}</components.SemanticContent>;
const labels = { showAllVariants: (count: number) => `Show all ${count}` };
const leaves = ["tokens.accent-color", "tokens.accent-color", "tokens.heading-size", "tokens.spacing", "tokens.radius", "tokens.duration", "assets.favicon", "assets.icon-close"];
function itemsFor(index: number, selected: DesignerSpecimenContext): readonly SpecimenItem[] {
  const leaf = leaves[index]!;
  return index === 1 ? colorRampSpecimenItems(selected, leaf) : index > 5 ? assetSpecimenItems(selected, leaf) : tokenSpecimenItems(selected, leaf);
}
const repeated = (items: readonly SpecimenItem[], count: number) => Array.from({ length: count }, (_, index) => ({ ...items[index % items.length]!, id: `case-${index}`, label: `Case ${index}` }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { animate?: unknown }).animate; });

it.each(tokenAssetSpecimenLeaves.map((leaf, index) => ({ leaf, index })))("$leaf.id renders 1, a few, and many with its intrinsic native layout", ({ leaf, index }) => {
  const selected = context(), native = itemsFor(index, selected);
  expect(native.length).toBeGreaterThan(0);
  for (const count of [1, 3, 15]) {
    const props = { items: repeated(native, count), context: selected, need, labels };
    expect(leaf.validate(props)).toEqual([]);
    const view = render(leaf.render(props));
    expect(view.container.querySelector("[data-ds-specimen-need]")).toBeNull();
    const rendered = [...view.container.querySelectorAll("[data-ds-specimen-item]")];
    expect(rendered).toHaveLength(count);
    for (const item of rendered.slice(0, 12)) expect(item).toBeVisible();
    if (count === 15) for (const item of rendered.slice(12)) expect(item).not.toBeVisible();
    if (count === 1) {
      expect(view.container.querySelector("[data-ds-leaf='components.grid-list'],h4,[data-ds-leaf='components.disclosure']")).toBeNull();
      expect(view.container.querySelector("[data-ds-specimen-layout='single']")).toBeTruthy();
    }
    if (count === 15) {
      fireEvent.click(screen.getByRole("button", { name: "Show all 15" }));
      expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(15);
      for (const item of rendered) expect(item).toBeVisible();
    }
    expect(view.container.querySelector("textarea,[contenteditable='true']")).toBeNull();
    expect(view.container.textContent).not.toMatch(/\$extensions|originKinds:|```/);
    view.unmount();
    const full = render(leaf.render({ ...props, expanded: true }));
    expect(full.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
    expect(screen.queryByRole("button", { name: `Show all ${count}` })).toBeNull();
    full.unmount();
  }
});

it.each(tokenAssetSpecimenLeaves)("$id rejects zero items and invalid member identities", leaf => {
  const selected = context();
  const props = { context: selected, need, labels, items: [] };
  expect(leaf.validate(props)).toEqual([expect.objectContaining({ reason: expect.stringContaining("zero-items") })]);
  const empty = render(leaf.render(props));
  expect(screen.getByRole("status")).toHaveTextContent("zero-items");
  expect(empty.container.querySelector("[data-ds-specimen-item]")).toBeNull();
  empty.unmount();
  expect(leaf.validate({ ...props, items: [{ id: "invalid", label: "Invalid", value: { memberId: "tokens.missing.value" } }] }).length).toBeGreaterThan(0);
});

it("applies actual native color, typography, spacing and radius values without mutating them", () => {
  const selected = context(), before = JSON.stringify(selected.profile.values);
  for (const index of [0, 2, 3, 4]) {
    const item = itemsFor(index, selected)[0]!;
    const view = render(tokenAssetSpecimenLeaves[index]!.render({ items: [item], context: selected, need, labels }));
    const id = typeof item.value === "object" && item.value && "memberId" in item.value && typeof item.value.memberId === "string" ? item.value.memberId : "";
    const value = selected.profile.values.members[id]!.css.light;
    const target = view.container.querySelector<HTMLElement>(index === 2 ? "[data-type-sample]" : "[role='img']")!;
    if (index === 0) { expect(target).toHaveStyle({ background: value }); expect(view.container.querySelector("[data-contrast-pair]")).toBeTruthy(); }
    if (index === 2) expect(target.style.fontSize).toBe(value);
    if (index === 3) expect(target.style.inlineSize).toBe(value);
    if (index === 4) expect(target.style.borderRadius).toBe(value);
    view.unmount();
  }
  expect(JSON.stringify(selected.profile.values)).toBe(before);
});

it("uses actual selected SVG logos and selected icon glyphs on both grounds", () => {
  const selected = context();
  for (const index of [6, 7]) {
    const view = render(tokenAssetSpecimenLeaves[index]!.render({ items: itemsFor(index, selected).slice(0, 1), context: selected, need, labels }));
    expect(view.container.querySelectorAll("[data-asset-ground]")).toHaveLength(2);
    if (index === 6) expect(view.container.querySelectorAll("img[src^='data:image/svg+xml,']")).toHaveLength(2);
    else expect(view.container.querySelectorAll("svg")).toHaveLength(2);
    view.unmount();
  }
});

it("refuses an unavailable native image capability and a missing selected component", () => {
  const selected = context();
  const images = assetSpecimenItems(selected, "assets.image");
  expect(images.length).toBeGreaterThan(0);
  expect(tokenAssetSpecimenLeaves[6]!.validate({ items: images, context: selected, need, labels }).some(fault => fault.reason.includes("native image"))).toBe(true);
  const noPorts = { ...selected, modules: {} };
  expect(tokenAssetSpecimenLeaves[0]!.validate({ items: itemsFor(0, selected), context: noPorts, need, labels }).some(fault => fault.reason.includes("module-unavailable"))).toBe(true);
});

it("executes the exact consumer source override and refuses to borrow a missing source module", () => {
  const selected = context();
  const original = selected.profile.components.components["components.semantic-content"]!;
  const entry = "components/semantic-content/consumer.tsx";
  const ConsumerContent = (props: Record<string, unknown>) => createElement(components.SemanticContent, { ...props, as: "div", "data-consumer-source": entry });
  const native = {
    ...selected,
    profile: { ...selected.profile, components: { ...selected.profile.components, components: { ...selected.profile.components.components,
      "components.semantic-content": { ...original, impl: { kind: "source" as const, entry, export: "ConsumerContent" } },
    } } },
    modules: { ...selected.modules, [entry]: { ConsumerContent } },
  };
  const items = itemsFor(0, native).slice(0, 1), leaf = tokenAssetSpecimenLeaves[0]!;
  const view = render(leaf.render({ items, context: native, need, labels }));
  expect(view.container.querySelector("[data-consumer-source='components/semantic-content/consumer.tsx']")).toBeTruthy();
  expect(view.container.querySelector("[role='img']")).toHaveStyle({ background: native.profile.values.members["tokens.accent-color.default"]!.css.light });
  view.unmount();
  const absent = { ...native, modules: selected.modules };
  expect(leaf.validate({ items, context: absent, need, labels })).toEqual([expect.objectContaining({ reason: `module-unavailable: ${entry}` })]);
});

it("plays selected duration/easing and holds a static final state for reduced motion", () => {
  const selected = context();
  let reduced = false;
  const changes = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => changes.add(fn), removeEventListener: (_: string, fn: () => void) => changes.delete(fn) }));
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  const item = itemsFor(5, selected)[0]!;
  const view = render(tokenAssetSpecimenLeaves[5]!.render({ items: [item], context: selected, need, labels }));
  fireEvent.click(screen.getByRole("button", { name: "Play motion" }));
  const duration = selected.profile.values.members["tokens.duration.default"]!;
  const easing = Object.values(selected.profile.values.members).find(member => member.$type === "cubicBezier")!;
  expect(animate).toHaveBeenCalledWith([{ transform: "translateX(0)" }, { transform: "translateX(4rem)" }], { duration: Number.parseFloat(duration.css.light) * (duration.css.light.endsWith("ms") ? 1 : 1000), easing: easing.css.light, fill: "forwards" });
  reduced = true;
  fireEvent.click(screen.getByRole("button", { name: "Play motion" }));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalled();
  expect(view.container.querySelector("[data-reduced-motion='static-final']")).toHaveStyle({ transform: "translateX(4rem)" });
  view.unmount();
  expect(changes.size).toBe(0);
});
