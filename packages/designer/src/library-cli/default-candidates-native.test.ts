// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { checkDefaultCandidates, type DefaultCandidatesInput } from "./default-candidates-gate.js";
import { loadNativeCompositeCatalog, loadNativeDefaultSources } from "./native-catalog.js";
import { nativeDefaultSources } from "./default-candidates-cli.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
function nativeInput(): DefaultCandidatesInput {
  const buildCatalog = loadBuildCatalog(), bundles = loadCatalogBundles();
  return { catalog: loadNativeCompositeCatalog(), buildCatalog, defaultSources: nativeDefaultSources(buildCatalog), componentBundles: bundles.sourceBundles,
    surfaceCoverage: [...bundles.foundryCoverage, ...importFoundrySections().coverage, ...importFoundryFrames().coverage],
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim(),
    sourceHash(path) { try { return createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"); } catch { return undefined; } },
  };
}

describe("native default candidate input integration", () => {
  it("reports measured native status without anticipating completion of unrelated repairs", () => {
    const result = checkDefaultCandidates(nativeInput());
    expect(result.exitCode).toBe(result.report.invalid.length ? 2 : result.report.missing.length ? 1 : 0);
    expect(result.report.status).toBe(result.exitCode === 2 ? "invalid-input" : result.exitCode === 1 ? "missing-candidates" : "complete");
    expect(result.report.sourceHead).toMatch(/^[a-f0-9]{40}$/);
    expect(result.report.counts.registeredSurfaces).toBeGreaterThan(1);
    expect(result.report.counts.checkedReads).toBeGreaterThan(1);
    expect(result.report.missing.map(row => row.slot)).toEqual([...result.report.missing.map(row => row.slot)].sort());
    expect(result.report.invalid).toEqual([...result.report.invalid].sort());
  });
  it("accepts the real verified Sheet implementation whose native contract has no member axes", () => {
    const input = nativeInput(), descriptor = input.catalog.components.fills.find(doc => doc.$extensions["com.clossys.fill"].id === "shadcn@aria/components.sheet")!;
    expect(Object.values(descriptor.components)[0]!.members).toEqual([]);
    expect(input.componentBundles!.some(bundle => bundle.slot === "components.sheet" && bundle.files.some(file => file.path === "components/sheet/sheet.tsx" && file.content.trim().length > 0))).toBe(true);
    expect(checkDefaultCandidates(input).report.missing.some(row => row.slot === "components.sheet")).toBe(false);
  });
  it("detects deletion of the native spacing default while retaining that source's other theme fills and restores the exact baseline", () => {
    const input = nativeInput(), original = input.catalog.values.fills, baseline = checkDefaultCandidates(input), slot = "themes.spacing", source = input.defaultSources[slot];
    const defaults = original.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].source === source);
    expect(defaults).toHaveLength(1);
    // Each themes leaf has exactly one shipped source; the mutation must leave that source's other theme fills in place.
    expect(original.some(doc => doc.$extensions["com.clossys.fill"].slot !== slot && doc.$extensions["com.clossys.fill"].slot.startsWith("themes.") && doc.$extensions["com.clossys.fill"].source === source)).toBe(true);
    input.catalog.values.fills = original.filter(doc => doc.$extensions["com.clossys.fill"].id !== defaults[0]!.$extensions["com.clossys.fill"].id);
    const mutated = checkDefaultCandidates(input);
    expect(mutated.exitCode).not.toBe(0);
    expect(mutated.report.missing.find(row => row.slot === slot)).toMatchObject({ source, reasons: ["no implementation candidate in the default source"] });
    expect(mutated.report.missing.find(row => row.slot === slot)!.surfaces.length).toBeGreaterThan(0);
    input.catalog.values.fills = original;
    expect(checkDefaultCandidates(input)).toEqual(baseline);
  });
  it("detects deletion of the native semantic default while retaining other native source offers and restores the exact baseline", () => {
    const input = nativeInput(), original = input.catalog.components.fills, baseline = checkDefaultCandidates(input), slot = "components.semantic-content", source = input.defaultSources[slot];
    const defaults = original.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].source === source);
    expect(defaults).toHaveLength(1);
    const otherSources = original.filter(doc => doc.$extensions["com.clossys.fill"].source !== source);
    expect(otherSources.length).toBeGreaterThan(0);
    input.catalog.components.fills = original.filter(doc => doc.$extensions["com.clossys.fill"].id !== defaults[0]!.$extensions["com.clossys.fill"].id);
    expect(input.catalog.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].source !== source)).toEqual(otherSources);
    const mutated = checkDefaultCandidates(input);
    expect(mutated.exitCode).not.toBe(0);
    expect(mutated.report.missing.find(row => row.slot === slot)).toMatchObject({ source, reasons: ["no implementation candidate in the default source"] });
    expect(mutated.report.missing.find(row => row.slot === slot)!.surfaces.length).toBeGreaterThan(0);
    input.catalog.components.fills = original;
    expect(checkDefaultCandidates(input)).toEqual(baseline);
  });
  it("exposes missing default policy as invalid input", () => {
    const input = nativeInput();
    input.defaultSources = { ...input.defaultSources, "themes.spacing": undefined };
    expect(checkDefaultCandidates(input)).toMatchObject({ exitCode: 2, report: { invalid: expect.arrayContaining(["MISSING_POLICY themes.spacing: default source definition is missing"]) } });
  });
  it("retains the explicit rich-text policy when its existing native candidate is removed", () => {
    const input = nativeInput(), original = input.catalog.components.fills, baseline = checkDefaultCandidates(input), slot = "components.rich-text";
    expect(input.defaultSources[slot]).toBe("shadcn@aria");
    expect(baseline.report.missing.some(row => row.slot === slot)).toBe(false);
    const defaults = original.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].source === input.defaultSources[slot]);
    expect(defaults).toHaveLength(1);
    expect(Object.values(defaults[0]!.components)[0]!.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "RichText" });
    const otherSources = original.filter(doc => doc.$extensions["com.clossys.fill"].source !== "shadcn@aria");
    expect(otherSources.length).toBeGreaterThan(0);
    input.catalog.components.fills = original.filter(doc => !defaults.includes(doc));
    expect(input.catalog.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].source !== "shadcn@aria")).toEqual(otherSources);
    expect(input.defaultSources[slot]).toBe("shadcn@aria");
    const deleted = checkDefaultCandidates(input);
    expect(deleted.exitCode).not.toBe(0);
    expect(deleted.report.missing.find(row => row.slot === slot)).toMatchObject({ source: "shadcn@aria", reasons: ["no implementation candidate in the default source"] });
    expect(deleted.report.missing).toHaveLength(baseline.report.missing.length + 1);
    input.catalog.components.fills = original;
    expect(checkDefaultCandidates(input)).toEqual(baseline);
  });
  it("returns the documented CLI usage error as JSON with exit 2", () => {
    const child = spawnSync(process.execPath, [resolve(root, "packages/designer/scripts/check-default-candidates.mjs"), "--unknown"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({ status: "invalid-input", invalid: ["Usage: check-default-candidates.mjs (no arguments)"] });
  });
});

const assetPolicies = {
  "assets.backdrop-graphic": "foundry",
  "assets.icon-check": "lucide",
  "assets.icon-chevron-down": "lucide",
  "assets.icon-chevron-left": "lucide",
  "assets.icon-chevron-right": "lucide",
  "assets.icon-chevron-up": "lucide",
  "assets.icon-close": "lucide",
  "assets.icon-date": "lucide",
  "assets.icon-search": "lucide",
  "assets.lockup": "foundry",
  "assets.mark": "foundry",
  "assets.video": "foundry",
} as const;

it("applies all twelve H3 asset policies without adopting missing candidates or identity seeds", () => {
  const input = nativeInput(), before = JSON.stringify(input.catalog.values.fills);
  expect(input.defaultSources).toMatchObject(assetPolicies);
  const result = checkDefaultCandidates(input);
  for (const slot of Object.keys(assetPolicies)) {
    expect(result.report.invalid.some(row => row.startsWith(`MISSING_POLICY ${slot}:`))).toBe(false);
    expect(result.report.checkedReads.some(row => row.slot === slot)).toBe(true);
  }
  // These are constructor rules, not consumer-authored positive identity seeds.
  for (const slot of ["assets.mark", "assets.lockup"]) {
    const fill = input.catalog.values.fills.find(doc => doc.$extensions["com.clossys.fill"].id === `foundry/${slot}`)!;
    expect(fill.$extensions["com.clossys.fill"].mode).toBe("derived");
    expect(result.report.missing.find(row => row.slot === slot)?.source).toBe("foundry");
  }
  expect(result.report.missing.find(row => row.slot === "assets.video")).toBeUndefined();
  expect(JSON.stringify(input.catalog.values.fills)).toBe(before);
});

it("keeps every decided source when all asset candidates are removed, and fails closed", () => {
  const input = nativeInput();
  input.catalog.values.fills = input.catalog.values.fills.filter(doc => !(doc.$extensions["com.clossys.fill"].slot in assetPolicies));
  expect(loadNativeDefaultSources(input.buildCatalog)).toMatchObject(assetPolicies);
  const result = checkDefaultCandidates(input);
  expect(result.exitCode).not.toBe(0);
  // Removing values can also remove their own reference reads. Only surviving
  // native surface reads require candidates; no artificial read is introduced.
  expect(result.report.missing.find(row => row.slot === "assets.icon-check")).toBeDefined();
  for (const [slot, source] of Object.entries(assetPolicies)) {
    if (!result.report.checkedReads.some(row => row.slot === slot)) continue;
    expect(result.report.missing.find(row => row.slot === slot)).toMatchObject({ source, reasons: ["no implementation candidate in the default source"] });
  }
});

it.each(Object.entries(assetPolicies))("rejects removal of the explicit %s policy without fallback", (slot, source) => {
  const input = nativeInput();
  expect(input.defaultSources[slot]).toBe(source);
  input.defaultSources = { ...input.defaultSources, [slot]: undefined };
  expect(checkDefaultCandidates(input).report.invalid).toContain(`MISSING_POLICY ${slot}: default source definition is missing`);
});
