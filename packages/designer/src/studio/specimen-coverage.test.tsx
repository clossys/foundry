import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as components from "../components/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import type { CompositeResolved } from "../catalog-core/types.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import componentData from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import { DesignerSpecimen, type DesignerSpecimenContext } from "./DesignerSpecimen.js";
import type { SpecimenItem, SpecimenLeafDefinition } from "./specimen-layouts.js";
import { resolveSpecimenLeafBinding } from "./specimen-kind-map.js";
import { collectSpecimenDomEvidence, validateSpecimenCoverage, type SpecimenCoverageCell, type RegisteredSpecimenCases, type SpecimenDomEvidence } from "./specimen-coverage.js";

// Counts below describe these fixtures only, never Product IA or live Publisher coverage.
const axes = [{ id: "variant", label: "Variant", values: [{ id: "primary", label: "Primary" }, { id: "secondary", label: "Secondary" }] }, { id: "state", label: "State", values: [{ id: "default", label: "Default" }, { id: "disabled", label: "Disabled" }] }];
const items: SpecimenItem[] = ["primary", "secondary"].flatMap(variant => ["default", "disabled"].map(state => ({ id: `${variant}-${state}`, label: `${variant} ${state}`, coordinates: { variant, state }, value: { variant, state } })));
const cell: SpecimenCoverageCell = { agent: "designer", id: "button", kind: "component", layer: "components", items, axes };
const leaf: SpecimenLeafDefinition = {
  id: "sections.specimen-variant-matrix", layout: "matrix", span: "full", compatible: [{ kind: "component", layer: "components" }],
  render: props => <components.SemanticContent as="div" data-ds-leaf="components.semantic-content" data-ds-specimen-region="" data-ds-specimen-section="sections.specimen-variant-matrix">
    {props.items.map(item => <components.SemanticContent as="div" key={item.id} data-ds-specimen-item={item.id}><components.Button isDisabled={(item.value as { state: string }).state === "disabled"}>Continue</components.Button></components.SemanticContent>)}
  </components.SemanticContent>,
};
const source: RegisteredSpecimenCases = { items, axes };
const fixtureContext = {} as DesignerSpecimenContext;
function mounted(itemsInput: readonly SpecimenItem[] = items, extra?: ReactNode, leafInput = leaf) {
  return render(<>{leafInput.render({ items: itemsInput, axes, context: fixtureContext, need: ({ reason }) => <components.SemanticContent as="p">NEED {reason}</components.SemanticContent>, labels: { showAllVariants: count => `Show all ${count}` } })}{extra}</>);
}
function check(leafInput: SpecimenLeafDefinition = leaf, evidence: readonly SpecimenDomEvidence[] = [], cellInput = cell, registered: RegisteredSpecimenCases = source) {
  return validateSpecimenCoverage({ cells: [cellInput], registry: [leafInput], registeredCases: () => registered, evidence });
}
const codes = (report: ReturnType<typeof check>) => report.findings.map(finding => finding.code);

it("counts registry cases separately from rendered DOM and fails absent agent inputs", () => {
  const view = mounted();
  const evidence = collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" });
  const report = check(leaf, [evidence]);
  expect(report.agents.find(summary => summary.agent === "designer")).toEqual({ agent: "designer", cells: 1, expectedCases: 4, registeredCases: 4, renderedCases: 4, pass: true });
  expect(report.exitCode).toBe(1);
  expect(report.agents.filter(summary => summary.agent !== "designer").every(summary => !summary.pass)).toBe(true);
  expect(check().agents.find(summary => summary.agent === "designer")).toMatchObject({ registeredCases: 4, renderedCases: 0 });
});

it("binds exactly one registered compatible leaf from kind data or explicit override", () => {
  expect(resolveSpecimenLeafBinding(cell, [leaf])).toEqual({ leaf });
  expect(resolveSpecimenLeafBinding({ ...cell, specimen: leaf.id }, [leaf])).toEqual({ leaf });
  expect(resolveSpecimenLeafBinding({ ...cell, kind: "unknown" }, [leaf])).toEqual({ error: "unbound-specimen" });
  expect(resolveSpecimenLeafBinding(cell, [])).toEqual({ error: "unregistered-specimen" });
  expect(resolveSpecimenLeafBinding(cell, [leaf, leaf])).toEqual({ error: "duplicate-specimen-registration" });
  expect(resolveSpecimenLeafBinding({ ...cell, layer: "assets", specimen: leaf.id }, [leaf])).toEqual({ error: "incompatible-specimen" });
});

it("fails invalid layout, axes, zero items and missing source enumeration instead of green zero coverage", () => {
  expect(codes(check({ ...leaf, layout: undefined } as unknown as SpecimenLeafDefinition))).toContain("missing-or-invalid-layout");
  for (const span of [undefined, "wide"]) expect(codes(check({ ...leaf, span } as unknown as SpecimenLeafDefinition))).toContain("missing-or-invalid-span");
  expect(codes(check(leaf, [], { ...cell, axes: [] }))).toContain("cell-registry-axes-mismatch");
  expect(codes(check(leaf, [], { ...cell, items: [] }))).toContain("empty-specimen-items");
  expect(codes(check(leaf, [], cell, { items: [] }))).toContain("missing-registered-cases");
  const empty = validateSpecimenCoverage({ cells: [], registry: [leaf], registeredCases: () => source, evidence: [] });
  expect(empty.pass).toBe(false);
  expect(empty.findings).toHaveLength(4);
});

it("requires all native variants and states even when cell data supplies only a default", () => {
  for (const partial of [items.slice(1), [items[0]!]]) expect(codes(check(leaf, [], { ...cell, items: partial }))).toContain("missing-cell-case");
  expect(codes(check(leaf, [], { ...cell, items: [...items, items[0]!] }))).toContain("invalid-or-duplicate-case");
  const invalid = [{ ...items[0]!, coordinates: { variant: "unknown", state: "default" } }, ...items.slice(1)];
  expect(codes(check(leaf, [], { ...cell, items: invalid }))).toContain("invalid-or-duplicate-case");
  expect(codes(check(leaf, [], cell, { items: items.slice(1), axes }))).toContain("missing-registered-case");
  const thirdAxis = [...axes, { id: "size", label: "Size", values: [{ id: "small", label: "Small" }, { id: "large", label: "Large" }] }];
  expect(codes(check(leaf, [], { ...cell, axes: thirdAxis }, { items: items.map(item => ({ ...item, coordinates: { ...item.coordinates, size: "small" } })), axes: thirdAxis }))).toContain("missing-registered-case");
});

it("accepts one item on every intrinsic layout without artificial axes", () => {
  const single = [{ ...items[0]!, coordinates: undefined }];
  for (const layout of ["single", "ladder", "grid", "matrix"] as const) {
    const fixtureLeaf = { ...leaf, layout };
    const view = mounted(single, undefined, fixtureLeaf);
    const singleCell = { ...cell, items: single, axes: undefined };
    const proof = collectSpecimenDomEvidence({ cell: singleCell, root: view.container, surface: "linkout" });
    expect(check(fixtureLeaf, [proof], singleCell, { items: single }).agents.find(summary => summary.agent === "designer")?.pass).toBe(true);
    view.unmount();
  }
});

it("requires expanded or full link-out DOM proof of collapsed cases", () => {
  const view = mounted();
  const last = view.container.querySelector<HTMLElement>(`[data-ds-specimen-item='${items.at(-1)!.id}']`)!;
  last.hidden = true;
  const row = collectSpecimenDomEvidence({ cell, root: view.container, surface: "row" });
  expect(check(leaf, [row]).agents.find(summary => summary.agent === "designer")?.renderedCases).toBe(3);
  last.hidden = false;
  const expanded = collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" });
  expect(check(leaf, [row, expanded]).agents.find(summary => summary.agent === "designer")?.renderedCases).toBe(4);
});

it("rejects raw front-matter, file text, nested NEED, fallback, excerpt and pending output", () => {
  for (const text of ["---\nstatus: active\n---\nFile body", "originKinds: configured", "NEED missing selected implementation", "pending", "text fallback", "excerpt", "placeholder"]) {
    const view = mounted();
    view.container.querySelector("[data-ds-specimen-item]")!.append(text);
    const evidence = collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" });
    expect(evidence.issues.length).toBeGreaterThan(0);
    expect(check(leaf, [evidence]).agents.find(summary => summary.agent === "designer")?.renderedCases).toBe(0);
    view.unmount();
  }
  const sourceText = "export const configuration = selectedImplementation;";
  const view = mounted();
  view.container.querySelector("[data-ds-specimen-item]")!.append(sourceText);
  expect(collectSpecimenDomEvidence({ cell: { ...cell, sourceText }, root: view.container, surface: "expanded" }).issues).toContain("raw-source-in-specimen");
});

it("allows secondary Source outside proper region and rejects missing ancestry, empty or absent DOM", () => {
  const view = mounted(undefined, <pre>{"---\nstatus: draft\n---"}</pre>);
  expect(collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" }).issues).toEqual([]);
  const native = view.container.querySelector("[data-ds-leaf]")!;
  native.removeAttribute("data-ds-leaf");
  expect(collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" }).issues).toContain("outside-native-leaf");
  native.replaceChildren();
  expect(collectSpecimenDomEvidence({ cell, root: view.container, surface: "expanded" }).issues).toContain("empty-specimen");
  expect(collectSpecimenDomEvidence({ cell, root: document.createElement("div"), surface: "row" }).issues).toContain("missing-specimen-region");
});

it("collects actual native Designer selection DOM and rejects a nested runtime NEED", () => {
  const catalog = loadCatalog();
  const values = resolve({ catalog, library: completedCatalogLibrary(catalog, { id: "coverage-fixture", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29") });
  const context = { profile: { consumer: values.consumer, selectionHash: values.selectionHash, values, components: structuredClone(componentData) } as CompositeResolved, modules: { "@clossys/designer/components": components, ...defaultSourceModules } };
  const single = [{ id: "actual", label: "Actual", value: { leaf: "components.button" } }];
  const actual: SpecimenLeafDefinition = { ...leaf, render: props => <components.SemanticContent as="div" data-ds-leaf="components.semantic-content" data-ds-specimen-region="" data-ds-specimen-section={leaf.id} data-ds-specimen-item={props.items[0]!.id}><DesignerSpecimen leaf="components.button" context={context} need={({ reason }) => <components.SemanticContent as="p">NEED {reason}</components.SemanticContent>} /></components.SemanticContent> };
  const singleCell = { ...cell, items: single, axes: undefined };
  const view = mounted(single, undefined, actual);
  expect(view.container.querySelector("[data-component-specimen]")).toBeTruthy();
  const proof = collectSpecimenDomEvidence({ cell: singleCell, root: view.container, surface: "linkout" });
  expect(check(actual, [proof], singleCell, { items: single }).agents.find(summary => summary.agent === "designer")?.pass).toBe(true);
  view.unmount();
  context.modules = {};
  const missing = mounted(single, undefined, actual);
  const failed = collectSpecimenDomEvidence({ cell: singleCell, root: missing.container, surface: "linkout" });
  expect(failed.issues).toContain("unresolved-specimen");
  expect(check(actual, [failed], singleCell, { items: single }).agents.find(summary => summary.agent === "designer")?.pass).toBe(false);
});

it("takes four agent inputs, rejects wrong-agent leaves and refuses blank Publisher metadata as live proof", () => {
  const pageItems = [{ id: "page", label: "Page", value: { route: "/" } }];
  const publisher = { ...cell, agent: "publisher" as const, kind: "page", layer: "publication", items: pageItems, axes: undefined };
  const pageLeaf: SpecimenLeafDefinition = { id: "sections.specimen-page-viewports", layout: "matrix", span: "full", compatible: [{ kind: "page" }], render: () => <components.SemanticContent as="div" data-ds-leaf="components.semantic-content" data-ds-specimen-region="" data-ds-specimen-section="sections.specimen-page-viewports" data-ds-specimen-item="page"><iframe title="Page" src="about:blank" sandbox="" /></components.SemanticContent> };
  const view = mounted(pageItems, undefined, pageLeaf);
  const proof = collectSpecimenDomEvidence({ cell: publisher, root: view.container, surface: "linkout" });
  expect(proof.cases[0]?.livePage).toBe(false);
  const cells: SpecimenCoverageCell[] = ["director", "writer", "designer"].map(agent => ({ ...cell, agent: agent as SpecimenCoverageCell["agent"] }));
  cells.push(publisher);
  const report = validateSpecimenCoverage({ cells, registry: [leaf, pageLeaf], registeredCases: entry => entry.agent === "publisher" ? { items: pageItems } : source, evidence: [proof] });
  expect(report.agents.map(summary => [summary.agent, summary.expectedCases, summary.registeredCases, summary.renderedCases])).toEqual([["director", 4, 0, 0], ["writer", 4, 0, 0], ["designer", 4, 4, 0], ["publisher", 1, 1, 0]]);
  expect(report.findings.filter(finding => finding.code === "agent-specimen-mismatch")).toHaveLength(2);
  expect(report.findings.map(finding => finding.code)).toContain("missing-live-emitted-page");
  expect(report.exitCode).toBe(1);
});
