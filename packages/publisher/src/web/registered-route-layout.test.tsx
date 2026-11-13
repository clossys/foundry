/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { FrameStage, frameSectionRefKey } from "@clossys/designer/frames";
import { renderToStaticMarkup } from "react-dom/server";
import { runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import { bindRegisteredFlowLayout, registeredLayoutSourceMatches } from "./registered-route-layout.js";
import { REGISTERED_LAYOUT_FILLS, registeredLayoutSourcePin } from "../core/layout-fill-source.js";
import { getEffectiveLayoutContract, getLayoutLeaf } from "../layouts/resolve.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding, LayoutRendererSource } from "../core/instance-binding.js";
import { syntheticRoute } from "../core/__fixtures__/registered-route.js";
const pixels = { "tokens.breakpoint.mobile": 480, "tokens.breakpoint.mobile-lg": 640, "tokens.breakpoint.tablet": 768, "tokens.breakpoint.tablet-lg": 960, "tokens.breakpoint.desktop": 1280, "tokens.breakpoint.wide": 1600 };
function fixture(leaf: FlowInstanceBinding["layout"]["leaf"]) {
  const pin = registeredLayoutSourcePin(leaf)!; const source: LayoutRendererSource = { entry: pin.entry, files: Object.fromEntries(Object.keys(pin.files).map(file => [file, readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), "..", file), "utf8")])) };
  const binding = structuredClone(syntheticRoute().composition.binding) as FlowInstanceBinding;
  Object.assign(binding, { layout: { leaf, config: getLayoutLeaf(leaf)!.contract.configs[0]!.id } });
  const contract = getEffectiveLayoutContract(leaf, binding.layout.config);
  Object.assign(binding, { fills: Object.fromEntries(contract.slots.map(slot => [slot.id, Array.from({ length: slot.min }, () => ({ section: slot.accepts[0]!, content: {} }))])) });
  const fullSource = { ...source, dependencies: {} };
  const renderer: RuntimeRendererDescriptor = { id: pin.export, source: fullSource, sourceHash: runtimeHash(fullSource) };
  const library: ConsumerInstanceLibrary = { id: "example", role: "consumer", resolveFill: (id, config) => id === leaf && config === binding.layout.config ? { library: "example", leaf, config, headings: [], states: ["default"], renderer: source } : undefined, resolveContent: ref => ref };
  return { binding, source, renderer, library };
}
describe("fixed selected flow Layout binder (synthetic, no whole-instance qualification)", () => {
  it.each(REGISTERED_LAYOUT_FILLS.map(fill => fill.leaf) as FlowInstanceBinding["layout"]["leaf"][])("executes %s with its exact selected source/configuration", leaf => {
    const f = fixture(leaf); expect(registeredLayoutSourceMatches(leaf, f.source)).toBe(true);
    const port = bindRegisteredFlowLayout(f.binding, f.library, f.renderer, pixels)!;
    expect(port.descriptor.leaf).toBe(leaf); expect(port.descriptor.config).toBe(f.binding.layout.config);
    const slots = Object.fromEntries(Object.entries(f.binding.fills).map(([slot, fills]) => [slot, fills.map((_, index) => <article key={index}>{`${slot}.${index}`}</article>)]));
    const profile = { values: { members: Object.fromEntries(Object.entries(pixels).map(([id, value]) => [id, { value: { light: { unit: "px", value } } }])) } } as never;
    expect(renderToStaticMarkup(<>{port.render({ slots, cell: { theme: "light", state: "default", width: 1280 }, profile, stageWidth: 1280 })}</>)).toContain(`data-layout="${leaf}"`);
  });
  it("rejects stale source, foreign library and wrong selected config rather than substituting a built-in", () => {
    const f = fixture("layouts.stack");
    const changed = { ...f.source, files: { ...f.source.files, [f.source.entry]: f.source.files[f.source.entry] + "\n// changed" } };
    expect(registeredLayoutSourceMatches("layouts.stack", changed)).toBe(false);
    expect(bindRegisteredFlowLayout(f.binding, { ...f.library, id: "foreign" }, f.renderer, pixels)).toBeUndefined();
    expect(bindRegisteredFlowLayout(f.binding, f.library, { ...f.renderer, sourceHash: `sha256:${"0".repeat(64)}` }, pixels)).toBeUndefined();
    expect(bindRegisteredFlowLayout(f.binding, { ...f.library, resolveFill: () => ({ library: "example", leaf: "layouts.stack", config: "foreign", states: [], headings: [], renderer: f.source }) }, f.renderer, pixels)).toBeUndefined();
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(REGISTERED_LAYOUT_FILLS.map(fill => fill.leaf) as FlowInstanceBinding["layout"]["leaf"][])("shared live Stage executes exact %s at selected threshold minus/at/plus one with fixed viewport", leaf => {
  const f = fixture(leaf), contract = getEffectiveLayoutContract(leaf, f.binding.layout.config);
  const fills = Object.fromEntries(contract.slots.map(slot => [slot.id, Array.from({ length: Math.max(1, slot.min) }, () => ({ section: slot.accepts[0]!, content: {} }))]));
  Object.assign(f.binding, { fills });
  const port = bindRegisteredFlowLayout(f.binding, f.library, f.renderer, pixels)!;
  const refs = Object.entries(fills).flatMap(([slot, fills]) => fills.map((_, index) => ({ slot, index })));
  const sectionNodes = Object.fromEntries(refs.map(ref => [frameSectionRefKey(ref), { label: `${ref.slot}.${ref.index}`, node: <article data-test-ref={`${ref.slot}.${ref.index}`}>{`${ref.slot}.${ref.index}`}</article> }]));
  const expectedSlots = leaf === "layouts.split" ? ["lead", "start", "end"] : leaf === "layouts.sidebar-content" ? ["lead", "main", "aside"] : leaf === "layouts.bento" ? ["lead", "tiles"] : ["lead", "body", "close"];
  const expected = expectedSlots.flatMap(slot => refs.filter(ref => ref.slot === slot).map(ref => `${ref.slot}.${ref.index}`));
  const thresholds = contract.reflow.length ? contract.reflow.map(step => pixels[step.at]) : [pixels["tokens.breakpoint.mobile"]];
  let width = thresholds[0]! - 1, resized!: () => void;
  const observed: Element[] = [], constructions = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { constructions(); resized = callback; } observe(node: Element) { observed.push(node); } disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function () { return (this as HTMLElement).hasAttribute("data-frame-stage") ? width : 1800; });
  const profile = { values: { members: Object.fromEntries(Object.entries(pixels).map(([id, value]) => [id, { value: { light: { unit: "px", value } } }])) } } as never;
  const renderPort = vi.fn(port.render), selected = { ...port, render: renderPort }, cell = { theme: "light", state: "default", width: 1800 };
  const descriptor = runtimeHash(port.descriptor);
  render(<FrameStage aria-label="Actual selected flow" body={{ kind: "flow", source: { kind: "static" }, sections: refs }} sectionNodes={sectionNodes} contract={{ accepts: ["flow", "canvas"], scroll: "region" }} layout={selected} cell={cell} profile={profile} />);
  for (const threshold of thresholds) for (const next of [threshold! - 1, threshold!, threshold! + 1]) {
    width = next; act(() => resized());
    expect(renderPort.mock.lastCall![0].stageWidth).toBe(next);
    expect(renderPort.mock.lastCall![0].cell.width).toBe(1800);
    expect([...document.querySelectorAll("[data-test-ref]")].map(node => node.getAttribute("data-test-ref"))).toEqual(expected);
    expect(port.expectedOrder(cell, Object.fromEntries(Object.entries(fills).map(([slot, fills]) => [slot, fills.map((_, index) => `${slot}.${index}`)])), next)).toEqual(expected);
    expect(document.querySelector(`[data-layout="${leaf}"]`)).not.toBeNull();
    expect(runtimeHash(port.descriptor)).toBe(descriptor);
  }
  expect(constructions).toHaveBeenCalledTimes(1); expect(observed).toHaveLength(1);
});
