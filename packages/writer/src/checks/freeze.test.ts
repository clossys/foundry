import { describe, expect, it } from "vitest";
import { loadWriterCatalog } from "../catalog/ia/index.js";
import { loadWriterLeafFreezeSnapshots } from "../catalog-core/leaf-freeze.js";
import type { WriterLibrary } from "../model/types.js";
import { checkWriterFreeze } from "./freeze.js";

const library = (): WriterLibrary => ({
  manifest: { consumer: "example", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records: [], documents: [] } },
});

const unsignedSnapshots = () => loadWriterLeafFreezeSnapshots().map(snapshot => ({
  ...snapshot, signedHead: null, ownerSignoffComment: null,
}));

describe("WR2 Writer leaf membership", () => {
  it("accepts the shipped owner-signed snapshots with empty heads, without modifying evidence", () => {
    const value = library();
    const catalog = loadWriterCatalog();
    const snapshots = loadWriterLeafFreezeSnapshots();
    const before = JSON.stringify({ value, catalog, snapshots });
    expect(checkWriterFreeze(value, { catalog, freeze: { snapshots } })).toEqual([]);
    expect(checkWriterFreeze(value)).toEqual([]);
    expect(JSON.stringify({ value, catalog, snapshots })).toBe(before);
    expect(snapshots.map(({ layer, signedHead, ownerSignoffComment }) => ({ layer, signedHead, ownerSignoffComment }))).toEqual(
      ["lexicon", "strings", "patterns"].map(layer => ({
        layer, signedHead: "0b06a262bc9447787b9e79393125f1369bfb3470", ownerSignoffComment: "clossys/workspace#45 comment 6460620037",
      })),
    );
    for (const snapshot of snapshots) value.manifest.leafFreeze[snapshot.layer] = snapshot.signedHead!;
    expect(checkWriterFreeze(value)).toEqual([]);
  });

  it("permits L1/L2 regrouping, labels, order and metadata while preserving membership", () => {
    const catalog = loadWriterCatalog();
    const snapshots = loadWriterLeafFreezeSnapshots();
    for (const snapshot of snapshots) {
      catalog.placements.find(placement => placement.layer === snapshot.layer)!.nodes = [{
        id: "new-group", label: "New grouping", children: [{ id: "new-subgroup", label: "New label", leaves: [...snapshot.leafIds].reverse() }],
      }];
    }
    catalog.slots.reverse();
    catalog.slots[0]!.status = "unrelated-status";
    expect(checkWriterFreeze(library(), { catalog })).toEqual([]);
  });

  it("rejects coordinated new membership against an unsigned baseline", () => {
    const catalog = loadWriterCatalog();
    const snapshots = unsignedSnapshots();
    const snapshot = snapshots.find(value => value.layer === "lexicon")!;
    catalog.slots.push({ id: "lexicon.new-unsigned", layer: "lexicon", status: "draft", requires: [], contract: {} });
    catalog.placements.find(value => value.layer === "lexicon")!.nodes = [{ id: "group", label: "Group", leaves: [...snapshot.leafIds, "lexicon.new-unsigned"] }];
    const findings = checkWriterFreeze(library(), { catalog, freeze: { snapshots } });
    expect(findings).toHaveLength(2);
    expect(findings.map(finding => finding.path)).toEqual(["catalog.slots.lexicon", "catalog.ia.lexicon"]);
    for (const finding of findings) {
      expect(finding).toMatchObject({ code: "WR2", severity: "error" });
      expect(finding.message).toContain("unsigned candidate");
      expect(finding.message).toContain("lexicon.new-unsigned");
    }
  });

  it("requires a nonempty manifest head to match a signed snapshot", () => {
    const value = library();
    const head = "a".repeat(40);
    const unsigned = unsignedSnapshots();
    expect(checkWriterFreeze(value, { freeze: { snapshots: unsigned } })).toEqual([]);
    value.manifest.leafFreeze.lexicon = head;
    expect(checkWriterFreeze(value, { freeze: { snapshots: unsigned } })).toContainEqual(expect.objectContaining({ code: "WR2", path: "writer.json.leafFreeze.lexicon", message: expect.stringContaining("unsigned candidate") }));
    const snapshots = loadWriterLeafFreezeSnapshots().map(snapshot => snapshot.layer === "lexicon"
      ? { ...snapshot, signedHead: head, ownerSignoffComment: "Owner approved this membership." } : snapshot);
    expect(checkWriterFreeze(value, { freeze: { snapshots } })).toEqual([]);
    value.manifest.leafFreeze.lexicon = "b".repeat(40);
    expect(checkWriterFreeze(value, { freeze: { snapshots } })).toContainEqual(expect.objectContaining({ code: "WR2", path: "writer.json.leafFreeze.lexicon" }));
  });

  it("leaves passage and narrative membership unfrozen", () => {
    const catalog = loadWriterCatalog();
    catalog.placements = catalog.placements.filter(value => value.layer !== "passages" && value.layer !== "narratives");
    catalog.slots = catalog.slots.filter(value => value.layer !== "passages" && value.layer !== "narratives");
    expect(checkWriterFreeze(library(), { catalog })).toEqual([]);
  });

  it("accepts empty unfrozen heads and rejects claimed passage or narrative freezes", () => {
    const value = library();
    expect(checkWriterFreeze(value)).toEqual([]);
    for (const layer of ["passages", "narratives"] as const) value.manifest.leafFreeze[layer] = "a".repeat(40);
    const findings = checkWriterFreeze(value);
    expect(findings).toHaveLength(2);
    expect(findings.map(finding => finding.path)).toEqual(["writer.json.leafFreeze.passages", "writer.json.leafFreeze.narratives"]);
    for (const finding of findings) expect(finding).toMatchObject({ code: "WR2", severity: "error", message: expect.stringContaining("owner approval pending") });
  });

  it("reports invalid evidence as a WR2 error", () => {
    expect(checkWriterFreeze(library(), { freeze: { snapshots: [] } })).toEqual([
      expect.objectContaining({ code: "WR2", severity: "error", path: "catalog.leafFreeze" }),
    ]);
  });
});
