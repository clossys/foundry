import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, resolve } from "@clossys/designer/catalog";
import { prepareStudioSelection, STUDIO_REQUIRED_LEAVES } from "./selection-defaults.js";
import { resolveAgent } from "../agents.js";
import { designerRetired } from "../records/slot-model/foundry-ia.js";

describe("Studio missing selection defaults", () => {
  it("seats no retired Designer leaf as a required seat", () => {
    // Designer's retired-leaf list is the oracle; a required seat on a retired leaf fills a slot that is no longer offered.
    const retired = designerRetired(resolveAgent("designer").packageRoot);
    expect(retired.size).toBeGreaterThan(0);
    expect(STUDIO_REQUIRED_LEAVES.filter(leaf => retired.has(leaf))).toEqual([]);
  });

  it("uses Designer default preference and only the required dependency closure", async () => {
    const { input, leaves } = await defaultPrepare();
    const profile = resolve(input);
    const badge = Object.values(input.library.components.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.badge")!.components)[0]!;
    expect(badge.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
    expect(leaves.find(leaf => leaf.leaf === "sections.link-index")).toMatchObject({ source: "fallback", fill: "foundry/sections.link-index" });
    expect(leaves.find(leaf => leaf.leaf === "components.badge")).toMatchObject({ source: "fallback", fill: "shadcn@aria/components.badge" });
    expect(leaves.every(leaf => (leaf.source === "fallback" || leaf.source === "unavailable") && leaf.message?.startsWith("NEED:"))).toBe(true);
    expect(Object.keys(profile.components.components).length).toBeLessThan(input.catalog.components.slots.length);
    expect(profile.components.components["components.tooltip"]).toBeDefined();
    expect(profile.components.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
    expect(profile.surfaces?.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
  }, 30_000); // one full default-fill prepare: 9.5 s measured under load 2026-11-06 (11.3 s profiled)

  it("preserves a consumer's explicit fill instead of replacing it with a preferred default", async () => {
    const { input } = await defaultPrepare();
    const library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.badge", source: "foundry" } }] }, { surfaceOptions: input.surfaceOptions });
    const before = libraryHash(library);
    const prepared = await prepareStudioSelection({ catalog: input.catalog, library, activeIds: ["components.badge"], componentOptions: input.componentOptions });
    const badge = Object.values(prepared.input.library.components.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "components.badge")!.components)[0]!;
    expect(badge.origin).toMatchObject({ kind: "adopted", source: "foundry" });
    expect(prepared.leaves.find(leaf => leaf.leaf === "components.badge")).toMatchObject({ source: "consumer", fill: "foundry/components.badge" });
    expect(libraryHash(library)).toBe(before);
    expect(prepared.leaves.every(leaf => leaf.source === "consumer" || leaf.source === "unavailable")).toBe(true);
  }, 60_000); // two full default-fill prepares: 23.3 s measured under load 2026-11-06
});

it("plans the stock shadcn@aria fill for the overlays whose trigger mount props are fixture-only", async () => {
  const { leaves } = await defaultPrepare();
  // K1 reads contract.props only; children/defaultOpen are contract.fixtureProps, so the stock content parts stay eligible.
  for (const id of ["components.dialog", "components.popover", "components.tooltip"]) expect(leaves.find(row => row.leaf === id), id).toMatchObject({ source: "fallback", fill: `shadcn@aria/${id}` });
}, 30_000);

it("seats no retired native specimen", async () => {
  // Designer's retired-leaf list is the oracle: every native specimen section it retires is no longer offered.
  const retired = designerRetired(resolveAgent("designer").packageRoot);
  const prepared = await defaultPrepare();
  const specimenSlots = prepared.input.catalog.surfaces!.slots.map(slot => slot.id).filter(id => id.startsWith("sections.specimen-"));
  const retiredSpecimens = specimenSlots.filter(id => retired.has(id));
  expect(retiredSpecimens.length).toBeGreaterThan(0);
  const seated = (id: string) => prepared.leaves.some(row => row.leaf === id) || prepared.input.library.surfaces!.fills.some(doc => doc.$extensions["com.clossys.fill"].slot === id);
  expect(retiredSpecimens.filter(seated)).toEqual([]);
  expect(prepared.surfaceBundles.map(bundle => bundle.slot).filter(slot => retired.has(slot))).toEqual([]);
  // Live specimens (none retired) would still be seated; today every native specimen is retired.
  expect(specimenSlots.filter(id => !retired.has(id)).filter(id => !seated(id))).toEqual([]);
}, 30_000);

// The no-argument default prepare is deterministic and its result is only read, so the three tests share one run.
let shared: ReturnType<typeof prepareStudioSelection> | undefined;
function defaultPrepare() { return shared ??= prepareStudioSelection(); }
