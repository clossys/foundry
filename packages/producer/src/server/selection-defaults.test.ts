import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, resolve } from "@clossys/designer/catalog";
import { prepareStudioSelection } from "./selection-defaults.js";

describe("Studio missing selection defaults", () => {
  it("uses Designer default preference and only the required dependency closure", async () => {
    const { input, leaves } = await prepareStudioSelection();
    const profile = resolve(input);
    const badge = Object.values(input.library.components.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.badge")!.components)[0]!;
    expect(badge.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
    expect(leaves.find(leaf => leaf.leaf === "sections.cards")).toMatchObject({ source: "fallback", fill: "foundry/sections.cards" });
    expect(leaves.find(leaf => leaf.leaf === "components.badge")).toMatchObject({ source: "fallback", fill: "shadcn@aria/components.badge" });
    expect(leaves.every(leaf => (leaf.source === "fallback" || leaf.source === "unavailable") && leaf.message?.startsWith("NEED:"))).toBe(true);
    expect(Object.keys(profile.components.components).length).toBeLessThan(input.catalog.components.slots.length);
    expect(profile.components.components["components.tooltip"]).toBeDefined();
    expect(profile.components.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
    expect(profile.surfaces?.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
  });

  it("preserves a consumer's explicit fill instead of replacing it with a preferred default", async () => {
    const { input } = await prepareStudioSelection();
    const library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.badge", source: "foundry" } }] }, { surfaceOptions: input.surfaceOptions });
    const before = libraryHash(library);
    const prepared = await prepareStudioSelection({ catalog: input.catalog, library, activeIds: ["components.badge"], componentOptions: input.componentOptions });
    const badge = Object.values(prepared.input.library.components.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.badge")!.components)[0]!;
    expect(badge.origin).toMatchObject({ kind: "adopted", source: "foundry" });
    expect(prepared.leaves.find(leaf => leaf.leaf === "components.badge")).toMatchObject({ source: "consumer", fill: "foundry/components.badge" });
    expect(libraryHash(library)).toBe(before);
    expect(prepared.leaves.every(leaf => leaf.source === "consumer" || leaf.source === "unavailable")).toBe(true);
  });
});

it("ships all14 native specimen bundles with prepared receipts and preserves explicit surface selections", async () => {
  const prepared = await prepareStudioSelection();
  expect(prepared.surfaceBundles).toHaveLength(14);
  expect(prepared.input.catalog.surfaces!.materializations).toHaveLength(14);
  const native = prepared.input.library.surfaces!.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot.startsWith("sections.specimen-"));
  expect(native).toHaveLength(14);
  for (const bundle of prepared.surfaceBundles) {
    const selected = native.find(doc => doc.$extensions["com.clossys.fill"].slot === bundle.slot)!;
    expect(Object.values(selected.sections!)[0]!.origin).toEqual(Object.values(bundle.document.sections!)[0]!.origin);
    for (const file of bundle.files) expect(prepared.input.library.surfaces!.files).toContainEqual(file);
  }
  const before = libraryHash(prepared.input.library);
  const explicit = await prepareStudioSelection({ catalog: prepared.input.catalog, library: prepared.input.library, activeIds: native.map(doc => doc.$extensions["com.clossys.fill"].slot), componentOptions: prepared.input.componentOptions });
  expect(libraryHash(explicit.input.library)).toBe(before);
  expect(explicit.surfaceBundles).toHaveLength(0);
  expect(explicit.input.catalog.surfaces).toBe(prepared.input.catalog.surfaces);
  for (const doc of native) expect(explicit.leaves.find(row => row.leaf === doc.$extensions["com.clossys.fill"].slot)?.source).toBe("consumer");
}, 30_000);
