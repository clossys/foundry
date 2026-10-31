import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import ts from "typescript";
import * as components from "../components/index.js";
import * as shell from "../shell/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { emittedTokenProperties, loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentCatalog, type ComponentLibrary } from "../catalog-core/resolve-components.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { sha256 } from "../catalog-core/digest.js";
import { ConsumerComponentProvider, SelectedComponentLeaf } from "../runtime/component-leaf.client.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import type { SpecimenItem, SpecimenLeafProps } from "./specimen-layouts.js";
import { assetSpecimenItems, colorRampSpecimenItems, tokenAssetSpecimenLeaves, tokenSpecimenItems } from "./specimen-token-assets.js";
import { renderSpecimenContrastHostPart, renderSpecimenSwatchHostPart } from "./specimen-token-host-parts.js";
import type { SpecimenTokenHostParts } from "./specimen-token-host-part-types.js";
import { specimenDataset } from "./specimen-dataset.js";

const catalog = loadCatalog();
const valueLibrary = completedCatalogLibrary(catalog, { id: "specimen-test-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29");
const values = resolve({ catalog, library: valueLibrary });
const componentCatalog: ComponentCatalog = { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills as unknown as ComponentCatalog["fills"] };
const emptyComponents: ComponentLibrary = { source: valueLibrary.source, adoptedAt: "2026-10-29", fills: [], files: [] };
const disclosureLibrary = applyComponentLibraryChange(componentCatalog, emptyComponents, { baseHash: componentLibraryHash(emptyComponents), changes: [{ op: "adopt", slot: "components.disclosure", source: "foundry" }] });
const nativeDisclosure = resolveComponents({ catalog: componentCatalog, library: disclosureLibrary, values: {
  tokens: Object.fromEntries([...emittedTokenProperties(values)].map(([id, output]) => [id, { property: output.property, light: values.members[id]!.css.light }])),
  assets: [...new Set(Object.values(values.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))],
} });
function context(): DesignerSpecimenContext {
  const selected = structuredClone(componentData);
  return { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values: structuredClone(values), components: { ...selected, components: { ...selected.components, ...nativeDisclosure.components } } } as CompositeResolved, modules: { "@clossys/designer/components": components, "@clossys/designer/shell": shell, ...defaultSourceModules } };
}
async function renderSelected(node: ReactNode, selected: DesignerSpecimenContext): Promise<ReturnType<typeof render>> {
  let view: ReturnType<typeof render> | undefined;
  const value = {
    profile: selected.profile,
    selectionHash: selected.profile.components.selectionHash,
    descriptors: Object.fromEntries(Object.entries(selected.profile.components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
    modules: selected.modules,
  };
  await act(async () => { view = render(<ConsumerComponentProvider value={value}><Suspense>{node}</Suspense></ConsumerComponentProvider>); });
  return view!;
}
const need: SpecimenLeafProps["need"] = ({ leaf, reason }) => <components.SemanticContent as="p" role="status" data-ds-specimen-need="true">NEED {leaf}: {reason}</components.SemanticContent>;
const labels = { showAllVariants: (count: number) => `Show all ${count}` };
function tokenParts(selected: DesignerSpecimenContext): SpecimenTokenHostParts {
  return {
    "studio.specimen-swatch": input => renderSpecimenSwatchHostPart(selected, input),
    "studio.specimen-contrast": input => renderSpecimenContrastHostPart(selected, input),
  };
}
const leaves = ["themes.primary", "themes.primary", "themes.tracking-tight", "themes.spacing", "themes.radius", "themes.animate-marquee", "assets.favicon", "assets.icon-close"];
function itemsFor(index: number, selected: DesignerSpecimenContext): readonly SpecimenItem[] {
  const leaf = leaves[index]!;
  return index === 1 ? colorRampSpecimenItems(selected, leaf) : index > 5 ? assetSpecimenItems(selected, leaf) : tokenSpecimenItems(selected, leaf);
}
const repeated = (items: readonly SpecimenItem[], count: number) => Array.from({ length: count }, (_, index) => ({ ...items[index % items.length]!, id: `case-${index}`, label: `Case ${index}` }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { animate?: unknown }).animate; });

it.each(tokenAssetSpecimenLeaves.map((leaf, index) => ({ leaf, index })))("$leaf.id renders 1, a few, and many with its intrinsic native layout", async ({ leaf, index }) => {
  const selected = context(), native = itemsFor(index, selected);
  expect(native.length).toBeGreaterThan(0);
  for (const count of [1, 3, 15]) {
    const props = { items: repeated(native, count), context: selected, need, labels, renderParts: tokenParts(selected) };
    expect(leaf.validate(props)).toEqual([]);
    const view = await renderSelected(leaf.render(props), selected);
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
    const full = await renderSelected(leaf.render({ ...props, expanded: true }), selected);
    expect(full.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
    expect(screen.queryByRole("button", { name: `Show all ${count}` })).toBeNull();
    full.unmount();
  }
});

it.each(tokenAssetSpecimenLeaves)("$id rejects zero items and invalid member identities", async leaf => {
  const selected = context();
  const props = { context: selected, need, labels, renderParts: tokenParts(selected), items: [] };
  expect(leaf.validate(props)).toEqual([expect.objectContaining({ reason: expect.stringContaining("zero-items") })]);
  const empty = await renderSelected(leaf.render(props), selected);
  expect(screen.getByRole("status")).toHaveTextContent("zero-items");
  expect(empty.container.querySelector("[data-ds-specimen-item]")).toBeNull();
  empty.unmount();
  expect(leaf.validate({ ...props, items: [{ id: "invalid", label: "Invalid", value: { memberId: "themes.missing.value" } }] }).length).toBeGreaterThan(0);
});

it("applies actual native color, typography, spacing and radius values without mutating them", async () => {
  const selected = context(), before = JSON.stringify(selected.profile.values);
  for (const index of [0, 2, 3, 4]) {
    const item = itemsFor(index, selected)[0]!;
    const view = await renderSelected(tokenAssetSpecimenLeaves[index]!.render({ items: [item], context: selected, need, labels, renderParts: tokenParts(selected) }), selected);
    const id = typeof item.value === "object" && item.value && "memberId" in item.value && typeof item.value.memberId === "string" ? item.value.memberId : "";
    const value = selected.profile.values.members[id]!.css.light;
    const target = view.container.querySelector<HTMLElement>(index === 2 ? "[data-type-sample]" : "[role='img']")!;
    if (index === 0) {
      expect(target.style.background).toBe(`var(${selected.profile.values.members[id]!.emit})`);
      expect(view.container.querySelector("[data-contrast-pair]")).toBeTruthy();
      for (const [property, token] of [["inlineSize", "themes.spacing.default"], ["blockSize", "themes.spacing.default"]] as const) {
        const size = selected.profile.values.members[token]!;
        expect(size.$type).toBe("dimension");
        expect(target.style[property]).toBe(`var(${size.emit})`);
      }
    }
    if (index === 2) expect(target.style.letterSpacing).toBe(value);
    if (index === 3) expect(target.style.inlineSize).toBe(value);
    if (index === 4) expect(target.style.borderRadius).toBe(value);
    view.unmount();
  }
  expect(JSON.stringify(selected.profile.values)).toBe(before);
});

it.each([0, 1])("routes selected ink and surface member identities and modes to both registered parts for leaf %i", async index => {
  const selected = context(), before = JSON.stringify(selected.profile.values);
  const ids = ["themes.background.default", "themes.foreground.default"];
  const swatch = vi.fn(tokenParts(selected)["studio.specimen-swatch"]!);
  const contrast = vi.fn(tokenParts(selected)["studio.specimen-contrast"]!);
  const items = index === 0 ? ids.map(id => ({ id, label: id, value: { memberId: id } })) : [{ id: "ramp", label: "Ramp", value: { memberIds: ids } }];
  const props = { items, context: selected, need, labels, renderParts: { "studio.specimen-swatch": swatch, "studio.specimen-contrast": contrast } };
  const leaf = tokenAssetSpecimenLeaves[index]!;
  expect(leaf.validate(props)).toEqual([]);
  const view = await renderSelected(leaf.render(props), selected);
  for (const id of ids) for (const mode of ["light", "dark"] as const) {
    expect(swatch).toHaveBeenCalledWith({ memberId: id, mode });
    expect(contrast).toHaveBeenCalledWith({ backgroundMemberId: ids[0], colorMemberId: ids[1], pairMemberId: id === ids[0] ? ids[1] : ids[0], mode, children: specimenDataset.tokens.sampleText });
  }
  for (const input of swatch.mock.calls.map(([input]) => input)) expect(Object.keys(input).sort()).toEqual(["memberId", "mode"]);
  for (const mode of ["light", "dark"]) {
    const samples = [...view.container.querySelectorAll<HTMLElement>(`[data-specimen-mode='${mode}'] [role='img']`)];
    expect(samples.map(sample => sample.style.background)).toEqual(ids.map(id => `var(${selected.profile.values.members[id]!.emit})`));
    for (const sample of samples) {
      expect(sample.style.inlineSize).toBe("var(--spacing-5xl)");
      expect(sample.style.blockSize).toBe("var(--spacing-4xl)");
    }
    for (const sample of view.container.querySelectorAll<HTMLElement>(`[data-specimen-mode='${mode}'] [data-contrast-pair]`)) {
      expect(sample.style.background).toBe("var(--color-surface-base)");
      expect(sample.style.color).toBe("var(--color-ink-primary)");
      expect(sample.textContent).toBe(specimenDataset.tokens.sampleText);
    }
  }
  expect(JSON.stringify(selected.profile.values)).toBe(before);
});

it.each([0, 1])("refuses missing registered swatch and contrast parts before rendering leaf %i", async index => {
  const selected = context(), leaf = tokenAssetSpecimenLeaves[index]!;
  for (const part of ["studio.specimen-swatch", "studio.specimen-contrast"] as const) {
    const renderParts = { ...tokenParts(selected) };
    delete renderParts[part];
    const props = { items: itemsFor(index, selected).slice(0, 1), context: selected, need, labels, renderParts };
    expect(leaf.validate(props)).toEqual([expect.objectContaining({ reason: `The registered ${part} part is not wired.` })]);
    const view = await renderSelected(leaf.render(props), selected);
    expect(view.container.textContent).toContain(`The registered ${part} part is not wired.`);
    expect(view.container.querySelector("[data-ds-specimen-item],[role='img'],[data-contrast-pair]")).toBeNull();
    view.unmount();
  }
});

it("uses actual selected SVG logos and selected icon glyphs on both grounds", async () => {
  const selected = context();
  for (const index of [6, 7]) {
    const view = await renderSelected(tokenAssetSpecimenLeaves[index]!.render({ items: itemsFor(index, selected).slice(0, 1), context: selected, need, labels, renderParts: tokenParts(selected) }), selected);
    const grounds = [...view.container.querySelectorAll<HTMLElement>("[data-asset-ground]")];
    expect(grounds).toHaveLength(2);
    for (const [ground, surface, ink] of [[grounds[0]!, "themes.card.default", "themes.foreground.default"], [grounds[1]!, "themes.background.default", "themes.foreground.default"]] as const) {
      const background = selected.profile.values.members[surface]!, foreground = selected.profile.values.members[ink]!;
      expect(background.$type).toBe("color"); expect(foreground.$type).toBe("color");
      expect(ground.style.background).toBe(`var(${background.emit})`);
      expect(ground.style.color).toBe(`var(${foreground.emit})`);
    }
    if (index === 6) expect(view.container.querySelectorAll("img[src^='data:image/svg+xml,']")).toHaveLength(2);
    else expect(view.container.querySelectorAll("svg")).toHaveLength(2);
    view.unmount();
  }
});

it.each([
  { token: "themes.spacing.default", indices: [0, 1] },
  { token: "themes.spacing.default", indices: [0, 1, 5] },
  { token: "themes.card.default", indices: [6, 7] },
  { token: "themes.background.default", indices: [6, 7] },
  { token: "themes.foreground.default", indices: [6, 7] },
  { token: "themes.foreground.default", indices: [6, 7] },
])("refuses missing, mistyped and mis-emitted selected chrome token $token", async ({ token, indices }) => {
  for (const index of indices) for (const fault of ["missing", "type", "emit"] as const) {
    const selected = context(), items = itemsFor(index, selected).slice(0, 1);
    const members = { ...selected.profile.values.members }, member = members[token]!;
    if (fault === "missing") delete members[token];
    else members[token] = fault === "type" ? { ...member, $type: "duration" } : { ...member, emit: "--spacing-xs" };
    const invalid = { ...selected, profile: { ...selected.profile, values: { ...selected.profile.values, members } } };
    const leaf = tokenAssetSpecimenLeaves[index]!, props = { items, context: invalid, need, labels, renderParts: tokenParts(invalid) };
    expect(leaf.validate(props)).toContainEqual(expect.objectContaining({ reason: expect.stringContaining(`required-token: ${token}`) }));
    const view = await renderSelected(leaf.render(props), invalid);
    expect(view.container.textContent).toContain(`required-token: ${token}`);
    expect(view.container.querySelector("[data-ds-specimen-item],[data-asset-ground],[data-motion-specimen]")).toBeNull();
    view.unmount();
  }
});

it("refuses an unavailable native image capability and a missing selected component", () => {
  const selected = context();
  const images = assetSpecimenItems(selected, "assets.image");
  expect(images.length).toBeGreaterThan(0);
  expect(tokenAssetSpecimenLeaves[6]!.validate({ items: images, context: selected, need, labels, renderParts: tokenParts(selected) }).some(fault => fault.reason.includes("native image"))).toBe(true);
  const noPorts = { ...selected, modules: {} };
  expect(tokenAssetSpecimenLeaves[0]!.validate({ items: itemsFor(0, selected), context: noPorts, need, labels }).some(fault => fault.reason.includes("module-unavailable"))).toBe(true);
});

it("refuses the stale saved source disclosure's undeclared item instead of claiming source conformance", () => {
  const selected = context(), original = structuredClone(componentData) as unknown as CompositeResolved["components"];
  expect(original.components["components.disclosure"]!.impl.kind).toBe("source");
  const value = {
    profile: { components: original }, selectionHash: original.selectionHash, modules: selected.modules,
    descriptors: Object.fromEntries(Object.entries(original.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
  };
  expect(() => renderToStaticMarkup(<ConsumerComponentProvider value={value}><SelectedComponentLeaf leaf="components.disclosure" parts={["AccordionItem"]} componentProps={{}} /></ConsumerComponentProvider>))
    .toThrow(/undeclared components\.disclosure\.AccordionItem/);
});

it("executes the exact consumer source override and refuses to borrow a missing source module", async () => {
  const selected = context();
  const original = selected.profile.components.components["components.semantic-content"]!;
  const entry = "components/semantic-content/consumer.tsx";
  const source = readFileSync(resolvePath(import.meta.dirname, "../components/SemanticContent.tsx"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { SemanticContent?: typeof components.SemanticContent } = {};
  new Function("require", "exports", output)(createRequire(resolvePath(import.meta.dirname, "specimen-token-assets.test.tsx")), exports);
  const ConsumerContent = exports.SemanticContent!;
  expect(ConsumerContent).not.toBe(components.SemanticContent);
  const executed = vi.spyOn(ConsumerContent as unknown as { render: (...args: unknown[]) => unknown }, "render");
  const notice = "components/semantic-content/LICENSE.txt";
  const files = [{ path: entry, content: source }, { path: notice, content: readFileSync(resolvePath(import.meta.dirname, "../../LICENSE"), "utf8") }];
  const descriptor = {
    ...original.descriptor,
    impl: { kind: "source" as const, entry, export: "SemanticContent" },
    propMap: Object.fromEntries(original.descriptor.members.map(member => [member, `SemanticContent.as=${member.slice(3)}`])),
    notice, outputSha256: files.map(file => ({ path: file.path, sha256: sha256(file.content) })),
  };
  const origin = {
    kind: "adopted" as const, source: descriptor.source, fill: "foundry/components.semantic-content", pin: descriptor.pin,
    license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30",
    outputSha256: descriptor.outputSha256, notice,
  };
  const native = {
    ...selected,
    profile: { ...selected.profile, components: { ...selected.profile.components, selectionHash: componentDescriptorHash(descriptor), files: [...selected.profile.components.files, ...files], components: { ...selected.profile.components.components,
      "components.semantic-content": { ...original, descriptor, impl: descriptor.impl, propMap: descriptor.propMap, originKind: origin.kind, origin },
    } } },
    modules: { ...selected.modules, [entry]: { SemanticContent: ConsumerContent } },
  };
  const items = itemsFor(0, native).slice(0, 1), leaf = tokenAssetSpecimenLeaves[0]!;
  const view = await renderSelected(leaf.render({ items, context: native, need, labels, renderParts: tokenParts(native) }), native);
  expect(executed).toHaveBeenCalled();
  expect(view.container.querySelector("section[data-specimen-mode='light'] span[role='img']")).toBeTruthy();
  expect(view.container.querySelector<HTMLElement>("[role='img']")!.style.background).toBe(`var(${native.profile.values.members["themes.primary.default"]!.emit})`);
  view.unmount();
  const absent = { ...native, modules: selected.modules };
  expect(leaf.validate({ items, context: absent, need, labels, renderParts: tokenParts(absent) })).toEqual([expect.objectContaining({ reason: `module-unavailable: ${entry}` })]);
});
