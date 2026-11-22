// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBuildCatalog } from "./index.js";
import bundleData from "../catalog-bundles.data.json" with { type: "json" };
import { generatedShadcnComponentFiles, type ShadcnComponentInput } from "../importers/shadcn-aria-components.js";
import { importShadcnAriaRail } from "../importers/shadcn-aria-rail.js";

// Target-state invariants: every expectation is computed at run time from the slot files, the build catalog,
// the committed shadcn@aria fills and the importers' own output. No id list, count or hash is recorded here.
const slotDirectory = join(import.meta.dirname, "../catalog/slots");
const fillDirectory = join(import.meta.dirname, "../catalog/fills/shadcn@aria");
const layerFiles = readdirSync(slotDirectory).filter(name => name.endsWith(".json")).sort();
const slotRows = (layer: string) => JSON.parse(readFileSync(join(slotDirectory, `${layer}.json`), "utf8")) as { id: string; layer: string }[];
// Importer output is computed inside each test, so a source defect fails the invariant that names it.
type Rail = ReturnType<typeof importShadcnAriaRail>;
let railOutput: Rail | undefined;
const importRail = (): Rail => railOutput ??= importShadcnAriaRail();
const railSlot = (doc: Rail["fills"][number]) => doc.$extensions["com.clossys.fill"].slot;
const railDescriptor = (doc: Rail["fills"][number]) => Object.values(doc.components)[0]!;
const canonicalFiles = () => generatedShadcnComponentFiles(structuredClone(bundleData.shadcn) as unknown as ShadcnComponentInput);
const filledSlots = (files: Readonly<Record<string, string>>) => new Set(Object.values(files).map(bytes => JSON.parse(bytes)).filter(doc => doc.$extensions).map(doc => doc.$extensions["com.clossys.fill"].slot as string));
const count = (values: readonly string[], value: string) => values.filter(entry => entry === value).length;

describe("rail registrations join the registered catalog", () => {
  it("every rail registration joins exactly one registered slot, and the build catalog keeps every slot file row in source order", () => {
    const current = loadBuildCatalog().slots, rail = importRail();
    const ids = current.map(slot => slot.id);
    // Every slot file row joins the build catalog unchanged and in source order; the catalog holds no other slot.
    for (const name of layerFiles) {
      const layer = name.replace(/\.json$/, "");
      expect(current.filter(slot => slot.layer === layer), layer).toEqual(slotRows(layer));
    }
    expect(current.filter(slot => !layerFiles.includes(`${slot.layer}.json`)).map(slot => slot.id)).toEqual([]);
    expect(ids.filter(id => count(ids, id) !== 1)).toEqual([]);
    // Each component the rail importer offers and each asset it reads is one registered slot of its own layer.
    const components = slotRows("components").map(slot => slot.id), assets = slotRows("assets").map(slot => slot.id);
    for (const doc of rail.fills) {
      const slot = railSlot(doc), descriptor = railDescriptor(doc);
      expect(count(components, slot), slot).toBe(1);
      expect(current.find(row => row.id === slot)?.layer, slot).toBe("components");
      expect(descriptor.slot, slot).toBe(slot);
      expect(descriptor.root, slot).toBe((current.find(row => row.id === slot) as { contract: { root: string } }).contract.root);
      for (const asset of descriptor.reads.assets) expect(count(assets, asset), `${slot} reads ${asset}`).toBe(1);
      for (const component of descriptor.reads.components) expect(count(components, component), `${slot} reads ${component}`).toBe(1);
    }
  });

  it("every committed shadcn@aria component file is the exact output of one importer, and every importer output is committed", () => {
    const rail = importRail(), canonical = canonicalFiles(), canonicalSlots = filledSlots(canonical);
    // A slot the components importer fills is its file; the rail importer owns only the slots it fills alone.
    const railOwned = rail.fills.filter(doc => !canonicalSlots.has(railSlot(doc)));
    const expected = new Map<string, string>(Object.entries(canonical));
    for (const doc of railOwned) {
      const name = `${railSlot(doc)}.json`;
      expect(expected.has(name), name).toBe(false);
      expected.set(name, JSON.stringify(doc, null, 2) + "\n");
    }
    const committed = readdirSync(fillDirectory).filter(name => /^components\..*\.json$/.test(name)).sort();
    expect(committed).toEqual([...expected.keys()].sort());
    for (const name of committed) expect(readFileSync(join(fillDirectory, name), "utf8") === expected.get(name), `${name} differs from its importer output`).toBe(true);
    // A rail offer that the components importer also fills reuses that adoption only over byte-identical upstream source.
    for (const doc of rail.fills.filter(row => canonicalSlots.has(railSlot(row)))) {
      const owner = JSON.parse(canonical[`${railSlot(doc)}.json`]!);
      expect(doc.$extensions["com.clossys.fill"].pin.sha256, railSlot(doc)).toBe(owner.$extensions["com.clossys.fill"].pin.sha256);
    }
  });

  it("a rail offer is blocked exactly while its rewrite carries a blocker, and only unblocked offers ship a source bundle", () => {
    const rail = importRail();
    for (const candidate of rail.candidates) {
      const descriptor = railDescriptor(rail.fills.find(doc => railSlot(doc) === candidate.slot)!);
      expect(candidate.status, candidate.slot).toBe(candidate.blockers.length ? "blocked" : "ready");
      expect(descriptor.blockers, candidate.slot).toEqual(candidate.blockers);
    }
    expect(rail.sourceBundles.map(bundle => bundle.slot)).toEqual(rail.candidates.filter(row => row.status === "ready").map(row => row.slot));
  });
});
