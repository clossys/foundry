import { expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { SPECIMEN_KIND_MAP, resolveSpecimenLeafBinding } from "./specimen-kind-map.js";
import { studioSpecimenLeaves, enumerateRegisteredDesignerSpecimenCases } from "./specimen-registry.js";
import { collectSpecimenDomEvidence, validateSpecimenCoverage, type SpecimenCoverageCell } from "./specimen-coverage.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";

function nativeContext(): DesignerSpecimenContext {
  const catalog = loadCatalog();
  const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "registry-fixture", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
  return { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values, components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules } };
}
it("aggregates the fourteen actual definitions and every data default resolves compatibly", () => {
  expect(studioSpecimenLeaves).toHaveLength(14);
  expect(new Set(studioSpecimenLeaves.map(leaf => leaf.id)).size).toBe(14);
  for (const entry of SPECIMEN_KIND_MAP) {
    const binding = resolveSpecimenLeafBinding({ kind: entry.kind, layer: entry.layer ?? "content" }, studioSpecimenLeaves);
    expect("leaf" in binding && binding.leaf.id).toBe(entry.specimen);
    expect("leaf" in binding && typeof binding.leaf.render).toBe("function");
  }
});
it("declares a valid card span on every actual leaf with full content and third-width swatches and assets", () => {
  for (const leaf of studioSpecimenLeaves) expect(["full", "half", "third"], leaf.id).toContain(leaf.span);
  const thirds = ["sections.specimen-swatch", "sections.specimen-asset-grid", "sections.specimen-icon-grid"];
  for (const leaf of studioSpecimenLeaves) expect(leaf.span, leaf.id).toBe(thirds.includes(leaf.id) ? "third" : "full");
});
it("measures the complete actual native spacing registry and its expanded leaf DOM as fixture coverage", async () => {
  const context = nativeContext();
  const leaf = studioSpecimenLeaves.find(leaf => leaf.id === "sections.specimen-spacing-ladder")!;
  const expected = enumerateRegisteredDesignerSpecimenCases({ context, specimen: leaf.id, sourceLeaf: "themes.spacing" })!;
  // themes.spacing is the single shadcn `--spacing` base unit: one closed member.
  expect(expected.items).toHaveLength(1);
  const cell: SpecimenCoverageCell = { agent: "designer", id: "themes.spacing", kind: "spacing", layer: "themes", ...expected };
  const props = { ...expected, context, expanded: true, need: ({ reason }: { reason: string }) => <components.SemanticContent as="p">NEED {reason}</components.SemanticContent>, labels: { showAllVariants: (count: number) => `Show all ${count}` } };
  const selection = { profile: context.profile, selectionHash: context.profile.components.selectionHash, modules: context.modules, descriptors: Object.fromEntries(Object.entries(context.profile.components.components).map(([id, chosen]) => [id, componentDescriptorHash(chosen.descriptor)])) };
  const view = render(<ConsumerComponentProvider value={selection}><Suspense>{leaf.render(props)}</Suspense></ConsumerComponentProvider>);
  await waitFor(() => expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(expected.items.length));
  const evidence = collectSpecimenDomEvidence({ cell, root: view.container, surface: "linkout" });
  const report = validateSpecimenCoverage({ cells: [cell], registry: studioSpecimenLeaves, registeredCases: () => expected, leafProps: () => props, evidence: [evidence] });
  const designer = report.agents.find(agent => agent.agent === "designer")!;
  expect(report.findings.filter(finding => finding.agent === "designer")).toEqual([]);
  expect(designer).toMatchObject({ expectedCases: expected.items.length, registeredCases: expected.items.length, renderedCases: expected.items.length, pass: true });
  console.info(JSON.stringify({ scope: "FIXTURE native spacing only", agent: "designer", expected: designer.expectedCases, registered: designer.registeredCases, rendered: designer.renderedCases, productCoverage: "UNVERIFIED" }));
});
it("uses full native component registration rather than accepting cell-supplied default cases", () => {
  const context = nativeContext();
  const leaf = studioSpecimenLeaves.find(leaf => leaf.id === "sections.specimen-variant-matrix")!;
  const expected = enumerateRegisteredDesignerSpecimenCases({ context, specimen: leaf.id, sourceLeaf: "components.button" })!;
  expect(expected.items.length).toBeGreaterThan(1);
  const cell: SpecimenCoverageCell = { agent: "designer", id: "components.button", kind: "component", layer: "components", items: expected.items.slice(0, 1), axes: expected.axes };
  const props = { ...expected, context, expanded: true, need: () => null, labels: { showAllVariants: (count: number) => String(count) } };
  const report = validateSpecimenCoverage({ cells: [cell], registry: studioSpecimenLeaves, registeredCases: () => expected, leafProps: () => props, evidence: [] });
  expect(report.findings.some(finding => finding.code === "missing-cell-case")).toBe(true);
  expect(report.agents.find(agent => agent.agent === "designer")?.renderedCases).toBe(0);
  expect(report.exitCode).toBe(1);
});
