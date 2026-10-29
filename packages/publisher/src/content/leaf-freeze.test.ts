import { describe, expect, it } from "vitest";
import freeze from "./slots.leaf-freeze.json" with { type: "json" };
import { leafRegistryFixture, reviewFixture } from "./__fixtures__/review.js";
import { checkSlotLeafFreeze } from "./leaf-freeze.js";
import { loadContentTree } from "./taxonomy.js";
import treeData from "./tree.json" with { type: "json" };

describe("slot leaf membership freeze", () => {
  it("records the exact eighteen reviewed identities independently of placement", () => {
    const slots = leafRegistryFixture().slots;
    expect(freeze).toEqual({
      schemaVersion: 1, layer: "slots", scope: "leaf-membership-only",
      policy: "regrouping is not membership", signedHead: null,
      ownerSignoffComment: "owner sign-off 2026-10-28",
      leafIds: slots.map(slot => slot.id).sort(),
    });
    expect(freeze.leafIds).toHaveLength(18);
    expect(checkSlotLeafFreeze(slots)).toEqual([]);
  });

  it("allows slot movement, label and address changes, and reordering", () => {
    const slots = [...leafRegistryFixture().slots].reverse().map((slot, index) => ({
      ...slot, l1: "custom", l2: "landing", name: `Label ${index}`,
      position: { order: index, name: "renamed" }, aliases: ["custom/landing/new"],
    }));
    const editable = structuredClone(treeData);
    editable.nodes[0]!.id = "custom";
    editable.nodes[0]!.label = "Custom";
    editable.nodes[0]!.children[0]!.id = "landing";
    editable.nodes[0]!.children[0]!.label = "Landing";
    editable.nodes.reverse();
    expect(loadContentTree(editable).nodes.at(-1)?.id).toBe("custom");
    expect(checkSlotLeafFreeze(slots)).toEqual([]);
  });

  it("rejects added, removed, renamed and duplicate identities", () => {
    const slots = leafRegistryFixture().slots;
    const added = { ...slots[0]!, id: "sl_aaaaaaaaaa" as const };
    expect(checkSlotLeafFreeze([...slots, added]).map(f => f.message)).toEqual([expect.stringContaining("Unexpected")]);
    expect(checkSlotLeafFreeze(slots.slice(1)).map(f => f.message)).toEqual([expect.stringContaining("Missing")]);
    expect(checkSlotLeafFreeze([added, ...slots.slice(1)]).map(f => f.message)).toEqual([expect.stringContaining("Missing"), expect.stringContaining("Unexpected")]);
    expect(checkSlotLeafFreeze([...slots, slots[0]!]).map(f => f.message)).toEqual([expect.stringContaining("Duplicate")]);
  });

  it("supports an explicit baseline without requiring every consumer to have eighteen slots", () => {
    const slots = reviewFixture().slots;
    expect(checkSlotLeafFreeze(slots, { ...freeze, leafIds: slots.map(slot => slot.id) })).toEqual([]);
  });

  it.each([null, {}, { ...freeze, schemaVersion: 2 }, { ...freeze, leafIds: ["invalid"] }, { ...freeze, leafIds: [freeze.leafIds[0], freeze.leafIds[0]] }])("reports malformed freeze data %#", value => {
    expect(checkSlotLeafFreeze([], value)).toEqual([{ path: "freeze", rule: "LEAF_FREEZE", message: expect.any(String) }]);
  });
});
