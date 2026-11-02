/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, loadFoundrySurfaceHistory, loadSectionRegistry } from "./index.js";
import { selectedPackageClosure } from "./__fixtures__/surface-engine/selected-package-closure.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfacePackageDescriptorHash } from "./surface-library.js";
import { runtimeHash, runtimeSnapshot } from "./runtime-ports.js";
import { migrateReads } from "./themes-migration.js";
import type { SurfaceCandidateDocument, SurfacePackageEntry } from "./surface-types.js";
import type { CompositeEngineInput, FrameSlot } from "./types.js";

let selected: CompositeEngineInput;
let historical: CompositeEngineInput;
const historicalHolds = [
  ["frames.app-shell", "sha256:6e1d05c03a31919afbd1a644c8f6521672090321ba730195dc2fd7c85721270a"],
  ["sections.hero", "sha256:e891cbf660bfd5461f23cbacd162bab907869c9883f1090a40e89b1d002ec6f6"],
] as const;
beforeAll(async () => {
  const frames = importFoundryFrames().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell");
  const sections = importFoundrySections().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.pagination");
  const catalog = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces: {
    slots: [...loadSectionRegistry().slots.filter(slot => slot.id === "sections.pagination"), ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames" && slot.id === "frames.app-shell")],
    fills: [...frames, ...sections], transforms: [], rules: [], materializations: [],
  } };
  const { library, componentOptions } = selectedPackageClosure(catalog);
  const surfaceOptions = { packages: await readSurfacePackageEvidence(catalog.surfaces.fills), measurements: [] };
  selected = { catalog, componentOptions, surfaceOptions, library: applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [
    { portion: "surfaces", change: { op: "adopt", slot: "frames.app-shell", source: "foundry" } },
    { portion: "surfaces", change: { op: "adopt", slot: "sections.pagination", source: "foundry" } },
  ] }, { componentOptions, surfaceOptions }) };
  const packageHistory = loadFoundrySurfaceHistory();
  const registrations = historicalHolds.map(([, hash]) => packageHistory[hash]![0]!);
  const priorCatalog = { ...catalog, surfaces: { ...catalog.surfaces, packageHistory,
    fills: registrations.map(row => row.document) as unknown as SurfaceCandidateDocument[], slots: registrations.map(row => row.contract),
  } };
  const prior = selectedPackageClosure(priorCatalog);
  const held = applyLibraryChange(priorCatalog, prior.library, { baseHash: libraryHash(prior.library), changes:
    historicalHolds.map(([slot]) => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot, source: "foundry" } })),
  }, { componentOptions: prior.componentOptions, surfaceOptions });
  historical = runtimeSnapshot({ catalog: { ...catalog, surfaces: { ...catalog.surfaces, packageHistory,
    fills: [...frames, ...importFoundrySections().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.hero")],
    slots: [...catalog.surfaces.slots.filter(slot => slot.layer === "frames"), ...loadSectionRegistry().slots.filter(slot => slot.id === "sections.hero")],
  } }, library: held, componentOptions: prior.componentOptions, surfaceOptions });
}, 60_000);

it("accepts real package Frame and Section with their selected component and descendant value closure", () => {
  const before = runtimeHash(selected), beforeLibrary = libraryHash(selected.library);
  const profile = resolve(selected);
  expect(profile.surfaces!.check).toMatchObject({ ok: true });
  expect(profile.surfaces!.check.findings.filter(row => row.severity === "error")).toEqual([]);
  const frame = surfaceEntryOf(profile.surfaces!.fills["frames.app-shell"]!.document);
  expect(isSurfacePackageEntry(frame)).toBe(true);
  expect(frame.composes).toContain("components.avatar");
  expect(frame.composes).toContain("frames.sheet");
  expect(frame.reads?.themes).toContain("themes.spacing");
  expect(frame.consumption?.scannedComposes).toEqual(frame.composes);
  expect(profile.components.components["components.avatar"]?.origin.kind).toBe("adopted");
  expect(profile.values.members["themes.spacing"]).toBeUndefined();
  expect(profile.values.members["themes.spacing.default"]?.slot).toBe("themes.spacing");
  expect(Object.values(profile.values.members).some(member => member.slot === "assets.icon-chevron-left")).toBe(true);
  expect(runtimeHash(selected)).toBe(before);
  expect(libraryHash(selected.library)).toBe(beforeLibrary);
});

function withoutComponent(id: string) {
  const library = { ...selected.library, components: { ...selected.library.components, fills: selected.library.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== id) } };
  return resolve({ ...selected, library });
}
function withoutValue(id: string) {
  const library = { ...selected.library, values: { ...selected.library.values, fills: selected.library.values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== id) } };
  return resolve({ ...selected, library });
}

it("refuses a real package Frame when a measured composed component is not selected", () => {
  const profile = withoutComponent("components.avatar");
  expect(profile.components.components["components.avatar"]).toBeUndefined();
  expect(profile.surfaces!.check.ok).toBe(false);
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S4", rule: "surfaces", severity: "error", subject: "frames.app-shell", message: "selected component missing components.avatar" });
});

it("refuses a real package Section when a measured composed component is not selected", () => {
  const profile = withoutComponent("components.button");
  expect(profile.components.components["components.button"]).toBeUndefined();
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S4", rule: "surfaces", severity: "error", subject: "sections.pagination", message: "selected component missing components.button" });
});

it("refuses measured token reads when the selected consumer has no member of that slot", () => {
  // The sidebar border is a real Frame read with no selected component dependency, so the
  // component resolver does not refuse before the surface gate can inspect it.
  const profile = withoutValue("themes.sidebar-border");
  expect(Object.keys(profile.values.members).some(id => id === "themes.sidebar-border" || id.startsWith("themes.sidebar-border."))).toBe(false);
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S5", rule: "surfaces", severity: "error", subject: "frames.app-shell", message: "consumer read missing themes.sidebar-border" });
});

it("refuses measured asset reads even when the catalog still offers the missing consumer value", () => {
  const profile = withoutValue("assets.icon-chevron-left");
  expect(Object.values(profile.values.members).some(member => member.slot === "assets.icon-chevron-left")).toBe(false);
  expect(selected.catalog.values.slots.some(slot => slot.id === "assets.icon-chevron-left")).toBe(true);
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S5", rule: "surfaces", severity: "error", subject: "sections.pagination", message: "consumer read missing assets.icon-chevron-left" });
});

it("reads frozen authentic legacy descriptors without TypeError or changing their identities", () => {
  const before = runtimeHash(historical), beforeLibrary = libraryHash(historical.library);
  expect(Object.isFrozen(historical.library)).toBe(true);
  for (const [slot, hash] of historicalHolds) {
    const document = historical.library.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!;
    const entry = surfaceEntryOf(document) as SurfacePackageEntry;
    expect(entry.reads).toHaveProperty("tokens");
    expect(entry.reads).not.toHaveProperty("themes");
    expect(surfacePackageDescriptorHash(entry)).toBe(hash);
  }
  expect(() => resolve(historical)).not.toThrow();
  const profile = resolve(historical);
  // Later contract/evidence findings remain visible; selected closure itself is complete.
  expect(profile.surfaces!.check.findings.filter(row => row.code === "S4" && row.message.startsWith("selected component missing"))).toEqual([]);
  expect(profile.surfaces!.check.findings.filter(row => row.code === "S5" && row.message.startsWith("consumer read missing"))).toEqual([]);
  for (const [slot, hash] of historicalHolds) {
    const entry = surfaceEntryOf(profile.surfaces!.fills[slot]!.document) as SurfacePackageEntry;
    expect(entry.reads).toHaveProperty("tokens");
    expect(entry.reads).not.toHaveProperty("themes");
    expect(surfacePackageDescriptorHash(entry)).toBe(hash);
    expect(profile.surfaces!.fills[slot]!.descriptorHash).toBe(hash);
    expect(profile.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", subject: slot, actualHash: hash, nextOperation: { op: "refresh", slot, source: "foundry" } }));
  }
  expect(runtimeHash(historical)).toBe(before);
  expect(libraryHash(historical.library)).toBe(beforeLibrary);
});

it.each([
  ["themes.spacing", "sections.hero"],
  ["assets.backdrop-graphic", "sections.hero"],
] as const)("requires the selected legacy read %s after read-only normalization", (id, subject) => {
  // Authentic historical Hero composes no components. Select it alone so removing
  // a shared theme reaches S5 rather than a component's earlier dependency check.
  const input = { ...historical, library: { ...historical.library,
    components: { fills: [], files: [] },
    surfaces: { ...historical.library.surfaces!, fills: historical.library.surfaces!.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === subject) },
    values: { ...historical.library.values,
    fills: historical.library.values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== id),
  } } };
  const before = runtimeHash(input), beforeLibrary = libraryHash(input.library);
  const profile = resolve(input);
  expect(Object.keys(profile.values.members).some(member => member === id || member.startsWith(id + "."))).toBe(false);
  expect(historical.catalog.values.slots.some(slot => slot.id === id)).toBe(true);
  expect(profile.surfaces!.check.ok).toBe(false);
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S5", rule: "surfaces", severity: "error", subject, message: `consumer read missing ${id}` });
  expect(runtimeHash(input)).toBe(before);
  expect(libraryHash(input.library)).toBe(beforeLibrary);
});

it("retains S4 composition checks while reading legacy dependencies", () => {
  const library = { ...historical.library, components: { ...historical.library.components,
    fills: historical.library.components.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== "components.avatar"),
  } };
  const profile = resolve({ ...historical, library });
  expect(profile.surfaces!.check.findings).toContainEqual({ code: "S4", rule: "surfaces", severity: "error", subject: "frames.app-shell", message: "selected component missing components.avatar" });
});

it("keeps modern reads unchanged and normalizes frozen legacy reads without mutation", () => {
  const modern = runtimeSnapshot({ themes: ["themes.spacing"], assets: ["assets.backdrop-graphic"] });
  const legacy = runtimeSnapshot({ tokens: ["tokens.spacing"], assets: ["assets.backdrop-graphic"] });
  const before = runtimeHash(legacy);
  expect(migrateReads(modern)).toBe(modern);
  expect(migrateReads(legacy)).toEqual(modern);
  expect(legacy).toEqual({ tokens: ["tokens.spacing"], assets: ["assets.backdrop-graphic"] });
  expect(runtimeHash(legacy)).toBe(before);
});
