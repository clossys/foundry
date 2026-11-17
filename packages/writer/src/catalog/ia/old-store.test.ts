/**
 * The old five-layer store is retired as live IA (foundry-build-0033; IA audit 2026-11-16 proposal 5). Its 137 ids
 * stay in the old ia files, flagged `status: "retired"`, and in `retired.json` (121) or the target trees (16). The
 * store still loads for record validation; the live catalog serves none of it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WRITER_LAYERS } from "../../catalog-core/ids.js";
import { loadWriterCatalog, loadWriterRetiredIds, loadWriterStore } from "./index.js";
import { leavesOf, loadWriterTrees, oldWriterLeafIds } from "./target.js";

const store = loadWriterStore();
const retired = loadWriterRetiredIds();
const target = new Set(loadWriterTrees().flatMap(leavesOf));

describe("old five-layer store", () => {
  it("keeps all 137 ids as storage, every layer flagged retired", () => {
    expect(store.placements.map(placement => [placement.layer, placement.status])).toEqual(WRITER_LAYERS.map(layer => [layer, "retired"]));
    expect(oldWriterLeafIds()).toHaveLength(137);
    for (const id of oldWriterLeafIds()) expect(retired.has(id) || target.has(id), id).toBe(true);
  });

  it("serves no old id live", () => {
    expect(loadWriterCatalog()).toEqual({ placements: [], slots: [] });
  });

  it("mutation: a layer that loses its retired flag serves only its ids with no retired row", () => {
    const unflagged = structuredClone(store);
    delete unflagged.placements.find(placement => placement.layer === "lexicon")!.status;
    const live = loadWriterCatalog(unflagged, retired);
    expect(live.placements.map(placement => placement.layer)).toEqual(["lexicon"]);
    expect(live.slots.map(slot => slot.id).sort()).toEqual([...target].filter(id => id.startsWith("lexicon.")).sort());
  });

  it("mutation: an unflagged layer with no retired rows serves every id again", () => {
    const unflagged = structuredClone(store);
    for (const placement of unflagged.placements) delete placement.status;
    expect(loadWriterCatalog(unflagged, new Set()).slots).toHaveLength(store.slots.length);
  });
});

/** slot-defaults.json keys must be exactly the target leaves: no retired store id, no missing leaf. */
const defaultsFindings = (keys: readonly string[], leaves: ReadonlySet<string>): string[] => [
  ...keys.filter(id => !leaves.has(id)).map(id => `${id} has a default but is not a target leaf`),
  ...[...leaves].filter(id => !keys.includes(id)).map(id => `${id} is a target leaf with no default`),
];

describe("slot-defaults.json", () => {
  const doc = JSON.parse(readFileSync(new URL("../slot-defaults.json", import.meta.url), "utf8")) as { schema: string; agent: string; slots: Record<string, { standard?: string }> };
  const keys = Object.keys(doc.slots);

  it("holds the 100 target leaves and no old-store id", () => {
    expect(doc).toMatchObject({ schema: "clossys.slot-defaults/1", agent: "writer" });
    expect(keys).toHaveLength(100);
    expect(defaultsFindings(keys, target)).toEqual([]);
    for (const id of keys) expect(typeof doc.slots[id]!.standard, id).toBe("string");
  });

  it("mutation: a retired store row or a dropped target leaf fails", () => {
    expect(defaultsFindings([...keys, "strings.actions"], target)).toEqual(["strings.actions has a default but is not a target leaf"]);
    expect(defaultsFindings(keys.filter(id => id !== "page.home.meta"), target)).toEqual(["page.home.meta is a target leaf with no default"]);
  });
});
