/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, loadSectionRegistry } from "./index.js";
import { selectedPackageClosure } from "./__fixtures__/surface-engine/selected-package-closure.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "./surface-library.js";
import type { CompositeEngineInput, FrameSlot } from "./types.js";

let selected: CompositeEngineInput;
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
}, 60_000);

it("accepts real package Frame and Section with their selected component and descendant value closure", () => {
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
