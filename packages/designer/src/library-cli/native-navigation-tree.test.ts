/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as componentExports from "../components/index.js";
import { NavigationTree, NavigationTreeItem, NavigationTreeItemContent } from "../components/NavigationTree.js";
import { installedHeadlessLibrary, loadCatalogBundles } from "../catalog-bundles.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/index.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { componentMemberBinding, emitComponents } from "../catalog-core/emit-components.js";
import { componentSpecimenPreview } from "../studio/component-specimens.js";
import type { CompositeLibraryData } from "../catalog-core/types.js";
import { loadNativeCompositeCatalog } from "./native-catalog.js";
import { generatedFoundryComponentFiles } from "../importers/foundry-components.js";

const slot = "components.navigation-tree";
const catalog = loadNativeCompositeCatalog();
const empty = (): CompositeLibraryData => ({
  source: { id: "navigation-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" },
  adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] },
});

describe("native NavigationTree part adoption", () => {
  it("regenerates the stored descriptor and complete coverage with the current native importer", () => {
    const files = generatedFoundryComponentFiles();
    for (const name of ["components.navigation-tree.json", "components.coverage.json"]) {
      expect(readFileSync(new URL(`../catalog/fills/foundry/${name}`, import.meta.url), "utf8")).toBe(files[name]);
    }
  });

  it("selects the existing Foundry root and binds both real collection parts", () => {
    const initial = empty();
    const values = catalog.values.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
      const offers = catalog.values.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot === slot.id && fill.$extensions["com.clossys.fill"].mode !== "reference");
      const fill = ["foundry", "tailwind-default"].map(source => offers.find(fill => fill.$extensions["com.clossys.fill"].source === source)).find(Boolean) ?? offers[0];
      return fill ? [{ portion: "values" as const, change: { op: "adopt" as const, slot: slot.id, source: fill.$extensions["com.clossys.fill"].source } }] : [];
    });
    const adopted = applyLibraryChange(catalog, initial, {
      baseHash: libraryHash(initial), changes: [...values, { portion: "components", change: { op: "adopt", slot, source: "foundry" } }],
    });
    const selected = componentOf(adopted.components.fills[0]!);
    expect(selected.origin).toMatchObject({ kind: "adopted", source: "foundry", fill: "foundry/components.navigation-tree" });
    expect(selected.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "NavigationTree" });
    expect(adopted.components.files).toEqual([]);
    const componentOptions = { installedRac: installedHeadlessLibrary(), packageExports: { "@clossys/designer/components": Object.keys(componentExports) } };
    const profile = resolve({ catalog, library: adopted, componentOptions });
    const { components } = profile;
    expect(components.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
    const resolved = components.components[slot]!;
    expect(componentMemberBinding(resolved, "part.item", resolved.propMap["part.item"]!)).toEqual({ module: "@clossys/designer/components", name: "NavigationTree", part: "Item" });
    expect(componentMemberBinding(resolved, "part.item-content", resolved.propMap["part.item-content"]!)).toEqual({ module: "@clossys/designer/components", name: "NavigationTree", part: "ItemContent" });
    expect(componentExports.NavigationTree).toBe(NavigationTree);
    expect(NavigationTree.Item).toBe(NavigationTreeItem);
    expect(NavigationTree.ItemContent).toBe(NavigationTreeItemContent);
    const binding = componentSpecimenPreview({ modules: { "@clossys/designer/components": componentExports } }).bind(slot, profile);
    if ("refusal" in binding) throw new Error(binding.refusal.detail);
    expect(binding.binding.Component).toBe(NavigationTree);
    expect(binding.binding.members.find(member => member.member === "part.item")!.Component).toBe(NavigationTreeItem);
    expect(binding.binding.members.find(member => member.member === "part.item-content")!.Component).toBe(NavigationTreeItemContent);
    const entry = emitComponents(components, ["component-index"]).find(file => file.path === "components/navigation-tree/index.ts")!;
    expect(entry.content).toContain("Impl0.Item");
    expect(entry.content).toContain("Impl0.ItemContent");
    expect(initial).toEqual(empty());
  });

  it("retains the real starter blockers and supplies no adoption bundle for it", () => {
    const bundle = loadCatalogBundles();
    const starter = bundle.componentFills.find(doc => doc.$extensions["com.clossys.fill"].id === "rac-starter/components.navigation-tree")!;
    const descriptor = componentOf(starter);
    expect(descriptor.blockers?.some(finding => finding.code === "K4")).toBe(true);
    expect(bundle.sourceCandidates.find(row => row.fill === "rac-starter/components.navigation-tree")!.status).toBe("blocked");
    expect(bundle.sourceBundles.some(row => row.slot === slot)).toBe(false);
  });
});
