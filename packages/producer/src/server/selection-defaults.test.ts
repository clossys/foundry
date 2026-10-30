import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, resolve } from "@clossys/designer/catalog";
import { prepareStudioSelection } from "./selection-defaults.js";

describe("Studio missing selection defaults", () => {
  it("uses Designer default preference and only the required dependency closure", async () => {
    const { input, leaves } = await prepareStudioSelection();
    const profile = resolve(input);
    const badge = Object.values(input.library.components.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.badge")!.components)[0]!;
    expect(badge.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
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
