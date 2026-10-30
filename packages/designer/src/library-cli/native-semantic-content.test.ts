/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as componentExports from "../components/index.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { installedHeadlessLibrary } from "../catalog-bundles.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { planComponentDefaults } from "../catalog-core/component-defaults.js";
import { componentOf, resolveComponents } from "../catalog-core/resolve-components.js";
import type { CompositeLibraryData } from "../catalog-core/types.js";
import { loadNativeCompositeCatalog } from "./native-catalog.js";

const slot = "components.semantic-content";
const catalog = loadNativeCompositeCatalog();
const empty = (): CompositeLibraryData => ({
  source: { id: "semantic-content-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" },
  adoptedAt: "2026-10-30",
  values: { fills: [] },
  components: { fills: [], files: [] },
});

describe("native SemanticContent candidate provenance", () => {
  it("offers the existing canonical package implementation as the eligible Foundry default", () => {
    const candidates = catalog.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.$extensions["com.clossys.fill"]).toMatchObject({
      id: "foundry/components.semantic-content", source: "foundry", author: "foundry", license: "MIT", mode: "implementation",
    });
    expect(componentOf(candidates[0]!).impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "SemanticContent" });
    expect(componentExports.SemanticContent).toBe(SemanticContent);
    const plan = planComponentDefaults({
      catalog: catalog.components, slots: [slot], tokens: {}, assets: [], bundles: [],
      installedRac: installedHeadlessLibrary(), preference: ["shadcn@aria", "foundry"], picks: {},
    });
    expect(plan.rows).toEqual([expect.objectContaining({ slot, status: "default", source: "foundry", fill: "foundry/components.semantic-content" })]);
    expect(plan.findings).toEqual([]);
  });

  it("adopts and reselects the same public package export without copying implementation bytes", () => {
    const initial = empty();
    const adopt = (library: CompositeLibraryData) => applyLibraryChange(catalog, library, {
      baseHash: libraryHash(library),
      changes: [{ portion: "components", change: { op: "adopt", slot, source: "foundry" } }],
    });
    const adopted = adopt(initial);
    const selected = adopted.components.fills[0]!.components["semantic-content"]!;
    expect(selected.origin).toMatchObject({ kind: "adopted", source: "foundry", fill: "foundry/components.semantic-content", license: "MIT" });
    expect(selected.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "SemanticContent" });
    expect(adopted.components.files).toEqual([]);
    expect(adopt(adopted)).toEqual(adopted);
    expect(initial).toEqual(empty());
    const resolved = resolveComponents({
      catalog: catalog.components,
      library: { ...adopted.components, source: adopted.source, adoptedAt: adopted.adoptedAt },
      values: { tokens: {}, assets: [] },
      evidence: { installedRac: installedHeadlessLibrary(), observations: {} },
      packageExports: { "@clossys/designer/components": Object.keys(componentExports) },
    });
    expect(resolved.components[slot]!.impl).toEqual(selected.impl);
    expect(resolved.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
  });

  it("refuses a shadcn source request instead of relabeling the canonical Foundry implementation", () => {
    const initial = empty();
    expect(catalog.components.fills.some(doc => {
      const meta = doc.$extensions["com.clossys.fill"];
      return meta.slot === slot && meta.source === "shadcn@aria";
    })).toBe(false);
    expect(() => applyLibraryChange(catalog, initial, {
      baseHash: libraryHash(initial),
      changes: [{ portion: "components", change: { op: "adopt", slot, source: "shadcn@aria" } }],
    })).toThrow("components: missing or ambiguous candidate");
    expect(initial).toEqual(empty());
  });
});
