import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { render } from "./__fixtures__/frame.js";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { loadBuildCatalog, loadComponentCompositionRules } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import * as content from "./component-specimen-sample-content.js";
import { COMPONENT_SPECIMEN_PROBE_STATES, componentSpecimenPreview } from "./index.js";
import { SPECIMEN_ANCHOR_DATE, SPECIMEN_DATASET_SEED, specimenDataset } from "./specimen-dataset.js";

const hostModules = { "@clossys/designer/components": components, "@clossys/designer/charts": charts, "@clossys/designer/shell": shell };
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
afterEach(cleanup);

/** Every object and array node of the dataset, and every primitive value in it. */
function datasetIndex() {
  const nodes = new Set<unknown>(), primitives = new Set<unknown>();
  const walk = (value: unknown) => {
    if (value !== null && typeof value === "object") {
      if (nodes.has(value)) return;
      nodes.add(value);
      for (const child of Object.values(value)) walk(child);
    } else primitives.add(value);
  };
  walk(specimenDataset);
  return { nodes, primitives };
}

/**
 * Paths in a sample-content export not fed from the dataset: an array that is not a dataset array (an inline
 * per-specimen list) or a primitive that is not a dataset value (an inline literal). A dataset node is fed whole.
 */
function unfed(value: unknown, path: string, index = datasetIndex()): string[] {
  if (index.nodes.has(value)) return [];
  if (Array.isArray(value)) return [`${path}: inline array`];
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => unfed(child, `${path}.${key}`, index));
  return index.primitives.has(value) ? [] : [`${path}: inline ${JSON.stringify(value)}`];
}

/** The sample key a fill's specimen looks its content up by: `./components#Meter`, or a source fill's `entry#export`. */
const keyOf = (fill: ResolvedComponent["descriptor"]) => fill.impl.kind === "package"
  ? `./${fill.impl.module.split("/").slice(2).join("/")}#${fill.impl.export}`
  : `${fill.impl.entry}#${fill.impl.export}`;

/** Keys that have sample content in the dataset-addressing module. */
function fedKeys(): Set<string> {
  const { componentSpecimenProps, componentSpecimenText, componentSpecimenCollections, componentSpecimenOverlays, componentSpecimenSourceSamples } = content;
  return new Set([
    ...[componentSpecimenProps, componentSpecimenText, componentSpecimenCollections, componentSpecimenOverlays, componentSpecimenSourceSamples].flatMap(map => Object.keys(map)),
    // Drawn from the dataset's table, field, card, color and action records.
    "./components#Table", "./components#Field", "./components#Card", "./components#ColorPicker", "./components#FileTrigger", "./components#Form", "./components#Link",
    // The contained toast region takes the cell's own queue, seeded from the dataset's toasts.
    "./shell#Toaster",
  ]);
}

function leafProfile(fill: ResolvedComponent["descriptor"]) {
  const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: fill } as unknown as ResolvedComponent;
  return { selectionHash: `selection-${fill.slot}`, components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved;
}

it("is deterministic: a fixed seed and anchor date, and no clock or random source", async () => {
  expect(SPECIMEN_DATASET_SEED).toBe(20260115);
  expect(SPECIMEN_ANCHOR_DATE.toString()).toBe("2026-01-15");
  const text = source("./specimen-dataset.ts");
  expect(text).not.toMatch(/Date\.now|new Date\(|Math\.random|today\(|now\(/);
  vi.resetModules();
  const again = await import("./specimen-dataset.js");
  expect(JSON.stringify(again.specimenDataset)).toBe(JSON.stringify(specimenDataset));
  expect(again.specimenDataset).not.toBe(specimenDataset);
});

it("carries every kind of sample the specimens need, in each component's own shape", () => {
  const d = specimenDataset;
  expect(d.dates.range.end.compare(d.dates.range.start)).toBe(6);
  expect(d.table.rows).toHaveLength(8);
  expect(d.table.columns.every(column => column.allowsSorting)).toBe(true);
  // Mixed types: text, a whole number, a currency amount and an ISO date per row.
  expect(d.table.rows.every(row => /^\d+$/.test(row.items) && /^\$\d+\.\d\d$/.test(row.total) && /^2026-01-\d\d$|^2025-12-\d\d$/.test(row.placed))).toBe(true);
  expect(Object.keys(d.toasts)).toEqual(["info", "success", "warning", "danger"]);
  expect(d.dialog.actions.length).toBeGreaterThan(1);
  expect(d.select.options.length).toBeGreaterThan(2);
  expect(d.combobox.options.length).toBeGreaterThan(2);
  expect(d.tree.items.every(item => item.children.length > 0)).toBe(true);
  expect(d.charts.area.series.every(entry => entry.values.length === d.charts.area.x.length)).toBe(true);
  expect(d.assets.mark).toMatchObject({ slot: "assets.mark", member: "positive" });
  expect(d.assets.mark.svg).toMatch(/^\s*<svg\b/);
  expect(d.logo.src).toBe(d.assets.mark.src);
  expect(d.assets.glyph.slot).toBe("assets.icon-file-text");
});

it("feeds every sample from the dataset: no inline per-specimen arrays or literals", () => {
  const { componentSpecimenProps, componentSpecimenText, componentSpecimenCollections, componentSpecimenOverlays, componentSpecimenSourceSamples, componentSpecimenTable, componentSpecimenField, componentSpecimenCard, componentSpecimenActions, componentSpecimenColor, componentSpecimenToast } = content;
  const exportsFed = { componentSpecimenProps, componentSpecimenText, componentSpecimenCollections, componentSpecimenOverlays, componentSpecimenSourceSamples, componentSpecimenTable, componentSpecimenField, componentSpecimenCard, componentSpecimenActions, componentSpecimenColor, componentSpecimenToast };
  expect(Object.entries(exportsFed).flatMap(([name, value]) => unfed(value, name))).toEqual([]);
});

it("feeds all 59 registered component slots from the dataset", () => {
  const slots = loadBuildCatalog().slots.filter(slot => slot.id.startsWith("components.")).map(slot => slot.id);
  expect(slots).toHaveLength(59);
  // The date picker has no registered implementation fill; its composition rule's template is what draws.
  const fills = [...loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components)), ...loadComponentCompositionRules().map(rule => rule.template)];
  const keys = fedKeys();
  const fed = slots.filter(slot => fills.some(fill => fill.slot === slot && keys.has(keyOf(fill))));
  const exceptions = Object.fromEntries(slots.filter(slot => !fed.includes(slot)).map(slot => [slot, fills.filter(fill => fill.slot === slot).map(keyOf)]));
  expect(exceptions).toEqual({});
  console.info(`specimen dataset: slots fed ${fed.length}/${slots.length}`);
  expect(fed).toHaveLength(59);
});

it("draws every fed Foundry component with dataset content, never its leaf label", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const strings = [...datasetIndex().primitives].filter((value): value is string => typeof value === "string" && value.length > 2)
    .map(value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"));
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const fills = loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components))
    .filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && fedKeys().has(keyOf(fill)));
  expect(fills.length).toBeGreaterThan(50);
  const blank = fills.filter(fill => {
    const html = renderToString(<>{specimens.preview(fill.slot, leafProfile(fill))}</>);
    // The base row is labelled with the leaf only when nothing fed it.
    return !strings.some(value => html.includes(value)) || html.includes(`>${fill.slot}<`);
  }).map(fill => fill.slot);
  expect(blank).toEqual([]);
  errors.mockRestore();
});

it("draws no raw interactive element in a specimen file without an override reason code", () => {
  const offenders = ["./component-specimen-samples.tsx", "./component-specimen-contained.tsx", "./component-specimens.tsx"].flatMap(file => {
    const lines = source(file).split("\n");
    return lines.flatMap((line, index) => /<(input|button|select|textarea|a)\b/.test(line) && !lines.slice(Math.max(0, index - 3), index + 1).some(near => near.includes("override:")) ? [`${file}:${index + 1}`] : []);
  });
  expect(offenders).toEqual([]);
});

it("forces a probe's states through the component's own props and sets its content, listing what no prop can force", () => {
  expect(COMPONENT_SPECIMEN_PROBE_STATES).toEqual(["hover", "focus-visible", "pressed", "disabled", "invalid", "selected", "open", "read-only"]);
  const fills = loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components)).filter(fill => fill.source === "foundry");
  const checkbox = fills.find(fill => fill.slot === "components.checkbox")!;
  const specimens = componentSpecimenPreview({ modules: hostModules, probes: { "components.checkbox": { states: ["disabled", "selected", "hover"], children: "Probe label" } } });
  render(<>{specimens.preview(checkbox.slot, leafProfile(checkbox))}</>);
  const set = document.querySelector<HTMLElement>("[data-component-specimens='components.checkbox']")!;
  expect(set).toHaveAttribute("data-specimen-probe-states", "disabled selected");
  expect(set).toHaveAttribute("data-specimen-probe-unsupported", "hover");
  const [first] = screen.getAllByRole("checkbox", { name: "Probe label" });
  expect(first).toBeDisabled();
  expect(first).toBeChecked();
  cleanup();
  const disclosure = fills.find(fill => fill.slot === "components.disclosure")!;
  render(<>{componentSpecimenPreview({ modules: hostModules, probes: { "components.disclosure": { states: ["open"] } } }).preview(disclosure.slot, leafProfile(disclosure))}</>);
  expect(screen.getAllByRole("button", { name: specimenDataset.disclosure.items[0].label })[0]).toHaveAttribute("aria-expanded", "true");
  cleanup();
  // Without a probe nothing is forced and no probe attribute is drawn.
  render(<>{componentSpecimenPreview({ modules: hostModules }).preview(checkbox.slot, leafProfile(checkbox))}</>);
  expect(document.querySelector("[data-specimen-probe-states]")).toBeNull();
  expect(screen.getAllByRole("checkbox", { name: specimenDataset.text.checkbox })[0]).not.toBeChecked();
});
