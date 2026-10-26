import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import componentFreeze from "../catalog/ia/components.leaf-freeze.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot } from "../catalog-core/types.js";
import { checkComponentProfile, isObservationPending } from "../catalog-core/check-components.js";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { FOUNDRY_COMPONENT_MAP } from "./foundry-components.map.js";
import type { FoundryComponentMapping, FoundryComponentSubpath } from "./foundry-components.map.js";
import { generatedFoundryComponentFiles, importFoundryComponents } from "./foundry-components.js";

const here = dirname(fileURLToPath(import.meta.url));
const fillsDirectory = resolve(here, "../catalog/fills/foundry");
const slots = componentSlots as unknown as readonly ComponentSlot[];
const signedSlots = slots.filter(slot => componentFreeze.leafIds.includes(slot.id));
const exports = Object.fromEntries((["components", "charts", "shell"] as const).map(subpath => {
  const barrel = readFileSync(resolve(here, `../${subpath}/index.ts`), "utf8");
  const names = [...barrel.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(binding => binding.trim().split(/\s+as\s+/).at(-1)!));
  return [subpath, names];
})) as Record<FoundryComponentSubpath, string[]>;
const imported = () => importFoundryComponents({ exports });
// I1 retains no blocked candidates in its dynamic bundle: color-picker and number-field left it once their
// source-derived reads proved covered (no K11); toolbar, tag-group and tree pass their measured K5 craft comparison.
const dynamicBlockedLeaves: string[] = [];
const storedMappings = Object.fromEntries(Object.entries(FOUNDRY_COMPONENT_MAP).filter(([leaf]) => !dynamicBlockedLeaves.includes(leaf) && !["semantic-content", "native-action"].includes(leaf)));
const changedMap = (leaf: string, change: Partial<FoundryComponentMapping>) => ({ ...FOUNDRY_COMPONENT_MAP, [leaf]: { ...FOUNDRY_COMPONENT_MAP[leaf]!, ...change } });

describe("Foundry component package descriptors", () => {
  it("regenerates 55 stored package descriptors and keeps no dynamic blocked candidates", () => {
    const files = generatedFoundryComponentFiles({ exports, mappings: storedMappings, slots: signedSlots });
    // Explicit local regeneration writes only this generator's enumerated component artifacts.
    if (process.env.UPDATE_FOUNDRY_COMPONENT_FILLS === "1") for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(fillsDirectory, name), bytes);
    const committed = readdirSync(fillsDirectory).filter(name => name.startsWith("components.") && name.endsWith(".json")).sort();
    expect(committed).toEqual([...Object.keys(files), ...loadComponentCompositionRules().filter(rule => rule.template.source === "foundry").map(rule => `${rule.slot}.json`), "components.native-action.json"].sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(fillsDirectory, name), "utf8"), name).toBe(bytes);
    expect(imported().coverage.map(row => row.slot)).toEqual(slots.map(slot => slot.id).sort());
    expect(imported().coverage).toHaveLength(59);
    expect(signedSlots).toHaveLength(57);
    expect(importFoundryComponents({ exports, mappings: storedMappings, slots: signedSlots }).fills).toHaveLength(55);
    expect(imported().fills).toHaveLength(57);
    expect(imported().fills.filter(doc => !["components.semantic-content", "components.native-action"].includes(doc.$extensions["com.clossys.fill"].slot))).toHaveLength(55);
    const blocked = imported().fills.filter(doc => Object.values(doc.components)[0]!.blockers?.length);
    expect(blocked.map(doc => doc.$extensions["com.clossys.fill"].id)).toEqual(dynamicBlockedLeaves.map(leaf => `foundry/components.${leaf}`));
    for (const doc of blocked) {
      const meta = doc.$extensions["com.clossys.fill"];
      expect(meta.status).toBe("draft");
      expect(meta.conforms).toEqual([]);
      expect(meta.evidence).toEqual([]);
      expect(committed).not.toContain(`${meta.slot}.json`);
      expect(imported().coverage.find(row => row.slot === meta.slot)!.status).toBe("blocked");
    }
    const storedCoverage = importFoundryComponents({ exports, mappings: storedMappings, slots: signedSlots }).coverage;
    const baselineRows = (rows: typeof storedCoverage) => rows.filter(row => !["components.semantic-content", "components.native-action"].includes(row.slot) && !dynamicBlockedLeaves.some(leaf => row.slot === `components.${leaf}`));
    expect(baselineRows(imported().coverage)).toEqual(baselineRows(storedCoverage));
    expect(loadComponentCompositionRules().map(rule => rule.slot)).toEqual(["components.date-picker", "components.file-trigger"]);
  });

  it("pins real primary and member-dispatched package exports without copied source", () => {
    const result = imported();
    const descriptors = result.fills.flatMap(doc => Object.values(doc.components));
    for (const [index, fill] of descriptors.entries()) {
      expect(fill.impl.kind).toBe("package");
      if (fill.impl.kind !== "package") throw new Error("package expected");
      expect(fill.pin).toEqual({ package: "@clossys/designer", version: "0.12.0", export: `./${fill.impl.module.split("/").at(-1)}#${fill.impl.export}` });
      expect(result.fills[index]!.$extensions["com.clossys.fill"].evidence).toEqual([]);
      expect(result.fills[index]!.$extensions["com.clossys.fill"].conforms).toEqual([]);
      expect(fill).not.toHaveProperty("files");
      expect(fill).not.toHaveProperty("measurements");
      expect(fill).not.toHaveProperty("rac");
    }
    const bySlot = new Map(descriptors.map(fill => [fill.slot, fill]));
    expect(bySlot.get("components.button")!.propMap["shape.icon-only"]).toBe("./components#IconButton");
    expect(bySlot.get("components.text-field")!.propMap["line.multiline"]).toBe("./components#Textarea");
    expect(bySlot.get("components.logo")!.propMap["content.lockup"]).toBe("./shell#Brandmark.variant=lockup");
    expect(bySlot.get("components.toast")!.impl).toMatchObject({ module: "@clossys/designer/shell", export: "Toaster" });
    expect(descriptors.filter(fill => fill.slot.startsWith("components.chart-"))).toHaveLength(9);
  });

  it("accounts for every closed member as supported or missing, with no invented support", () => {
    for (const row of imported().coverage) {
      const slot = slots.find(slot => slot.id === row.slot)!;
      if (slot.contract.members.mode !== "closed") throw new Error("closed expected");
      expect([...row.supported, ...row.missing].sort()).toEqual([...slot.contract.members.names].sort());
      expect(row.supported.some(member => row.missing.includes(member))).toBe(false);
      const doc = imported().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === row.slot);
      if (doc) {
        const fill = Object.values(doc.components)[0]!;
        expect(Object.keys(fill.propMap).sort()).toEqual(row.supported);
        expect(fill.members).toEqual(row.supported);
        expect(doc.$extensions["com.clossys.fill"].unmapped ?? []).toEqual(row.missing);
        expect(doc.$extensions["com.clossys.fill"].relation).toBe(row.missing.length ? "subset" : "same-contract");
      } else expect(row.status).toBe("unavailable");
    }
    const rows = new Map(imported().coverage.map(row => [row.slot, row]));
    for (const leaf of dynamicBlockedLeaves) expect(rows.get(`components.${leaf}`)!.status).toBe("blocked");
    for (const leaf of ["keyboard", "date-picker"]) expect(rows.get(`components.${leaf}`)!.status).toBe("unavailable");
    // Foundry ships ToggleGroup; the controls group no longer needs a second source for it.
    expect(rows.get("components.toggle-group")).toMatchObject({ status: "candidate", missing: [] });
    expect(rows.get("components.slider")).toMatchObject({ status: "candidate", missing: [], supported: ["orientation.horizontal", "orientation.vertical", "selection.range", "selection.single"] });
    expect(rows.get("components.toggle-button")).toMatchObject({ status: "candidate", missing: [] });
    expect(rows.get("components.calendar")).toMatchObject({ status: "candidate", missing: [] });
    expect(rows.get("components.checkbox")!.supported).toContain("scope.single");
    expect(rows.get("components.disclosure")!.supported).toContain("scope.group");
    expect(rows.get("components.breadcrumbs")!.missing).toContain("collapsed");
    expect(rows.get("components.dialog")!.supported).toEqual(["dismissable", "role.modal"]);
    expect(rows.get("components.popover")!.supported).toEqual(["placement"]);
    for (const leaf of ["checkbox", "disclosure", "select", "tabs", "form", "navigation-tree", "field", "text-field", "date-field", "grid-list", "toast", "chart-area", "chart-heatmap", "chart-range", "chart-scatter", "chart-status-strip", "chart-waterfall"]) {
      expect(rows.get(`components.${leaf}`)!.missing).toEqual([]);
      expect(rows.get(`components.${leaf}`)!.status).toBe("candidate");
    }
    expect(rows.get("components.chart-sparkline")!.supported).toEqual(["axes", "legend", "series", "tooltip"]);
  });

  it("maps the package Menu popup, its inline presentation and root selection to real exports", () => {
    const result = imported(), coverage = result.coverage.find(row => row.slot === "components.menu")!;
    const fill = result.fills.find(doc => doc.components.menu)!.components.menu!;
    expect(fill.propMap).toEqual({
      "presentation.inline": "./components#Menu.Inline", "presentation.popup": "./components#Menu",
      "selection.multiple": "./components#Menu.selectionMode=multiple", "selection.none": "./components#Menu.selectionMode=none", "selection.single": "./components#Menu.selectionMode=single",
    });
    expect(coverage.status).toBe("candidate");
    expect(coverage.missing).toEqual([]);
    expect(fill.props).toContain("selectionMode");
    expect(fill.reads.assets).toEqual(["assets.icon-check"]);
  });

  it("rejects nonexistent primary and alternate exports", () => {
    expect(() => importFoundryComponents({ exports, mappings: changedMap("button", { export: "AbsentButton" }) })).toThrow("unavailable package export");
    expect(() => importFoundryComponents({ exports: { ...exports, components: exports.components.filter(name => name !== "Textarea") } })).toThrow("unavailable package export");
    expect(() => importFoundryComponents({ exports: { ...exports, shell: exports.shell.filter(name => name !== "Brandmark") } })).toThrow("unavailable package export");
  });

  it("rejects invented, blank or orphaned member mappings", () => {
    expect(() => importFoundryComponents({ mappings: changedMap("button", { propMap: { ...FOUNDRY_COMPONENT_MAP.button!.propMap, "variant.invented": "./components#Button" } }) })).toThrow("unknown or empty member");
    expect(() => importFoundryComponents({ mappings: changedMap("button", { propMap: { "variant.primary": "" } }) })).toThrow("unknown or empty member");
    expect(() => importFoundryComponents({ mappings: { ...FOUNDRY_COMPONENT_MAP, invented: FOUNDRY_COMPONENT_MAP.button! } })).toThrow("mapping has no contract");
  });

  it("does not turn a missing member or runtime observation into conformance", () => {
    const fills = imported().fills.flatMap(doc => Object.values(doc.components));
    const result = checkComponentProfile({ slots, fills, observations: {}, tokens: {}, assets: [], installedRac: { version: "1.21.1", instance: "consumer" } });
    const consumerSubset = checkComponentProfile({ slots, fills, observations: {}, tokens: {}, assets: [], installedRac: { version: "1.21.1", instance: "consumer" }, requiredMembers: Object.fromEntries(fills.map(fill => [fill.slot, fill.members])) });
    // Menu now supports presentation.inline, so its root mapping names only supported members.
    expect(consumerSubset.findings.filter(finding => finding.code === "K1")).toEqual([]);
    expect(consumerSubset.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "K1", subject: "components.breadcrumbs", message: "Required member collapsed is not mapped" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "K5", subject: "components.button", severity: "notice", message: "Source and runtime observations are unavailable" }));
  });
});

it("offers the exact new SemanticContent package binding as a draft without adoption or runtime claims", () => {
  const result = imported();
  const doc = result.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "components.semantic-content");
  expect(doc).toBeDefined();
  const fill = doc!.components["semantic-content"]!;
  const slot = slots.find(slot => slot.id === fill.slot)!;
  expect(fill.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "SemanticContent" });
  expect(fill.pin).toEqual({ package: "@clossys/designer", version: "0.12.0", export: "./components#SemanticContent" });
  expect(fill.root).toBe("presentational");
  expect(fill.reads).toEqual({ tokens: [], assets: [], components: [] });
  expect(fill.props).toEqual(["as"]);
  if (slot.contract.members.mode !== "closed") throw new Error("closed expected");
  expect(fill.propMap).toEqual(Object.fromEntries(slot.contract.members.names.map(member => [member, `./components#SemanticContent.as=${member.slice(3)}`])));
  expect(result.coverage.find(row => row.slot === fill.slot)).toMatchObject({ status: "candidate", missing: [] });
  expect(doc!.$extensions["com.clossys.fill"]).toMatchObject({ status: "draft", conforms: [], evidence: [] });
  expect(() => importFoundryComponents({ exports: { ...exports, components: exports.components.filter(name => name !== "SemanticContent") } })).toThrow("unavailable package export");
  const profile = checkComponentProfile({ slots, fills: [fill], observations: {}, tokens: {}, assets: [], installedRac: { version: "1.21.1", instance: "consumer" } });
  // Adoptable, never runtime-qualified: every finding is a runtime-pending notice.
  expect(profile.ok).toBe(true);
  expect(profile.findings).toContainEqual(expect.objectContaining({ subject: fill.slot, severity: "notice", message: "Source and runtime observations are unavailable" }));
  expect(profile.findings.every(isObservationPending)).toBe(true);
});

it("stores the exact pending NativeAction draft with real exports, native states and no invented RAC dependency", () => {
  const result = imported(), doc = result.fills.find(doc => doc.components["native-action"])!;
  expect(doc).toBeDefined();
  const fill = doc.components["native-action"]!;
  expect(fill.root).toBe("engine:none");
  expect(fill.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "NativeAction" });
  expect(fill.members).toEqual(["appearance.primary", "ground.base", "size.md", "state.disabled", "state.focus-visible", "state.hover", "state.pressed"]);
  expect(fill.deps.map(dep => dep.name)).toEqual(["react", "tailwind-merge"]);
  expect(fill.reads.assets).toEqual([]); expect(fill.reads.components).toEqual([]);
  expect(fill.reads.tokens).toEqual(["tokens.action-color", "tokens.body-size", "tokens.control-radius", "tokens.duration", "tokens.easing", "tokens.focus-color", "tokens.focus-outline", "tokens.spacing", "tokens.state-opacity", "tokens.text-color", "tokens.typeface"]);
  expect(doc.$extensions["com.clossys.fill"]).toMatchObject({ status: "draft", conforms: [], evidence: [] });
  const files = generatedFoundryComponentFiles({ exports });
  expect(readFileSync(resolve(fillsDirectory, "components.native-action.json"), "utf8")).toBe(files["components.native-action.json"]);
  expect(() => importFoundryComponents({ exports: { ...exports, components: exports.components.filter(name => name !== "NativeAction") } })).toThrow("unavailable package export");
  const profile = checkComponentProfile({ slots, fills: [fill], observations: {}, tokens: {}, assets: [], installedRac: { version: "1.21.1", instance: "consumer" } });
  expect(profile.ok).toBe(false);
  expect(profile.findings).toContainEqual(expect.objectContaining({ subject: fill.slot, code: "K5", message: "Source and runtime observations are unavailable" }));
});
