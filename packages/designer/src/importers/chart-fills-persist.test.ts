// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { componentMemberBinding, emitComponents } from "../catalog-core/emit-components.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import type { ComponentCandidateDocument, ComponentFile, ResolvedComponent, ResolvedComponents } from "../catalog-core/resolve-components.js";
import { FOUNDRY_COMPONENT_MAP } from "./foundry-components.map.js";

/**
 * Foundry's chart fills go through the persist emitter (emitComponents, component-index target)
 * one at a time. Every chart member is a capability the chart root itself renders, so each pointer
 * is the bare root export and the generated adapter is a provenance-stamped identity forward of that export.
 */
const barrel = (subpath: string): string[] => [...readFileSync(resolve(import.meta.dirname, `../${subpath}/index.ts`), "utf8").matchAll(/export\s*\{([^}]+)\}/g)]
  .flatMap(match => match[1]!.split(",").map(binding => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!)).filter(Boolean);
const packageExports = Object.fromEntries(["components", "charts", "shell"].map(subpath => [`@clossys/designer/${subpath}`, barrel(subpath)]));
const fillId = (doc: ComponentCandidateDocument): string => doc.$extensions["com.clossys.fill"].id;
const charts = loadCatalogBundles().componentFills
  .filter(doc => doc.$extensions["com.clossys.fill"].source === "foundry" && Object.values(doc.components)[0]!.slot.startsWith("components.chart-"));

function persist(doc: ComponentCandidateDocument): ComponentFile[] {
  const descriptor = Object.values(doc.components)[0]!;
  const component: ResolvedComponent = {
    slot: descriptor.slot, originKind: "adopted",
    origin: { kind: "adopted", source: descriptor.source, fill: fillId(doc), pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
    impl: descriptor.impl, propMap: structuredClone(descriptor.propMap),
    reads: { themes: {}, assets: [], components: [] }, descriptor,
  };
  const profile: ResolvedComponents = {
    consumer: "chart-check", selectionHash: `sha256:${"0".repeat(64)}`,
    components: { [descriptor.slot]: component }, files: [],
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports,
  };
  return emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs: {} } });
}

describe("Foundry chart fills persist", () => {
  // planner:r2f-53: the six zero-caller chart fills were deleted with their charts (nine -> three).
  it("selects all three Foundry chart fills", () => {
    expect(charts.map(fillId).sort()).toEqual(["area", "bar", "line"].map(leaf => `foundry/components.chart-${leaf}`));
  });
  it("emitComponents (persist path) refuses no Foundry chart fill", () => {
    const refusals = charts.flatMap(doc => { try { persist(doc); return []; } catch (error) { return [`${fillId(doc)}: ${(error as Error).message}`]; } });
    expect(refusals).toEqual([]);
  });
  it.each(charts.map(doc => [fillId(doc), doc] as const))("%s: every member points at the chart root and persists as its alias", (_id, doc) => {
    const descriptor = Object.values(doc.components)[0]!;
    if (descriptor.impl.kind !== "package") throw new Error("package expected");
    const root = `./charts#${descriptor.impl.export}`;
    expect(Object.keys(descriptor.propMap).sort()).toEqual(["axes", "legend", "series", "tooltip"]);
    for (const [member, pointer] of Object.entries(descriptor.propMap)) {
      expect(pointer, member).toBe(root);
      expect(componentMemberBinding({ slot: descriptor.slot, impl: descriptor.impl, descriptor } as unknown as ResolvedComponent, member, pointer)).toEqual({ module: "@clossys/designer/charts", name: descriptor.impl.export });
    }
    // The committed fill a consumer adopts carries exactly these pointers (UPDATE_FOUNDRY_COMPONENT_FILLS=1 rewrites it).
    expect(descriptor.propMap).toEqual(FOUNDRY_COMPONENT_MAP[descriptor.slot.slice(11)]!.propMap);
    const committed = JSON.parse(readFileSync(resolve(import.meta.dirname, `../catalog/fills/foundry/${descriptor.slot}.json`), "utf8")) as ComponentCandidateDocument;
    expect(Object.values(committed.components)[0]!.propMap).toEqual(descriptor.propMap);
    const leaf = persist(doc).find(file => file.path === `components/${descriptor.slot.slice(11)}/index.ts`)!;
    const name = descriptor.slot.slice(11).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    // Since e742c97f6 (DOM provenance) the identity adapter stamps data-ds-* and forwards to the bare root
    // export unchanged: one import, the provenance stamp, and the root's own type on the stamped export.
    const lines = leaf.content.split("\n");
    expect(lines[0]).toBe('import { createElement, forwardRef, type ComponentType } from "react";');
    expect(lines[1]).toBe(`import { ${descriptor.impl.export} as Impl0 } from "@clossys/designer/charts";`);
    expect(lines[2]).toBe(`const stamp = ${JSON.stringify({ "data-ds-layer": "components", "data-ds-leaf": descriptor.slot, "data-ds-fill": fillId(doc) })} as const;`);
    expect(leaf.content.match(/^import /gm)).toHaveLength(2);
    expect(leaf.content).toContain("const target = Impl0 satisfies ((props: never) => unknown) | (new (props: never) => unknown);");
    expect(leaf.content).toContain("  return createElement(target as unknown as ComponentType<Record<string, unknown>>, { ...props, ...stamp, ref });");
    expect(leaf.content.endsWith(`export const ${name} = Object.assign(Stamped, statics(Impl0)) as unknown as typeof Impl0;\n`)).toBe(true);
  });
});
