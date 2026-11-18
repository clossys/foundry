import { describe, expect, it } from "vitest";
import { contentTreeFixture } from "./__fixtures__/content-tree.js";
import { leafRegistryFixture, reviewFixture } from "./__fixtures__/review.js";
import { checkSlotLeafFreeze } from "./leaf-freeze.js";
import { loadContentTree } from "./taxonomy.js";

// Publisher reads no freeze of its own: the signed slots freeze lists only slot identities Publisher has since retired
// (catalog/retired.json) and is kept as a record with no readers (foundry-build-0042). The caller supplies the record,
// so the membership rules run against a record of the fixture's own identities.
const freeze = {
  schemaVersion: 1, layer: "slots", scope: "leaf-membership-only", policy: "regrouping is not membership",
  signedHead: null, ownerSignoffComment: "fixture sign-off", leafIds: [] as string[],
};
const fixtureFreeze = (slots: readonly { id: string }[]) => ({ ...freeze, leafIds: slots.map(slot => slot.id).sort() });

describe("slot leaf membership freeze", () => {
  it("requires the caller's freeze record: there is no built-in baseline", () => {
    const slots = leafRegistryFixture().slots;
    expect(slots).toHaveLength(18);
    expect(checkSlotLeafFreeze(slots, fixtureFreeze(slots))).toEqual([]);
    expect(checkSlotLeafFreeze(slots, undefined)).toEqual([{ path: "freeze", rule: "LEAF_FREEZE", message: expect.any(String) }]);
  });

  it("allows slot movement, label and address changes, and reordering", () => {
    const slots = [...leafRegistryFixture().slots].reverse().map((slot, index) => ({
      ...slot, l1: "custom", l2: "landing", name: `Label ${index}`,
      position: { order: index, name: "renamed" }, aliases: ["custom/landing/new"],
    }));
    const editable = { schemaVersion: 1, nodes: contentTreeFixture().nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child })) })) };
    editable.nodes[0]!.id = "custom";
    editable.nodes[0]!.label = "Custom";
    editable.nodes[0]!.children[0]!.id = "landing";
    editable.nodes[0]!.children[0]!.label = "Landing";
    editable.nodes.reverse();
    expect(loadContentTree(editable).nodes.at(-1)?.id).toBe("custom");
    expect(checkSlotLeafFreeze(slots, fixtureFreeze(leafRegistryFixture().slots))).toEqual([]);
  });

  it("rejects added, removed, renamed and duplicate identities", () => {
    const slots = leafRegistryFixture().slots, baseline = fixtureFreeze(slots);
    const added = { ...slots[0]!, id: "sl_aaaaaaaaaa" as const };
    expect(checkSlotLeafFreeze([...slots, added], baseline).map(f => f.message)).toEqual([expect.stringContaining("Unexpected")]);
    expect(checkSlotLeafFreeze(slots.slice(1), baseline).map(f => f.message)).toEqual([expect.stringContaining("Missing")]);
    expect(checkSlotLeafFreeze([added, ...slots.slice(1)], baseline).map(f => f.message)).toEqual([expect.stringContaining("Missing"), expect.stringContaining("Unexpected")]);
    expect(checkSlotLeafFreeze([...slots, slots[0]!], baseline).map(f => f.message)).toEqual([expect.stringContaining("Duplicate")]);
  });

  it("supports an explicit baseline without requiring every consumer to have eighteen slots", () => {
    const slots = reviewFixture().slots;
    expect(checkSlotLeafFreeze(slots, { ...freeze, leafIds: slots.map(slot => slot.id) })).toEqual([]);
  });

  it.each([null, {}, { ...freeze, schemaVersion: 2 }, { ...freeze, leafIds: ["invalid"] }, { ...freeze, leafIds: ["sl_aaaaaaaaaa", "sl_aaaaaaaaaa"] }])("reports malformed freeze data %#", value => {
    expect(checkSlotLeafFreeze([], value)).toEqual([{ path: "freeze", rule: "LEAF_FREEZE", message: expect.any(String) }]);
  });
});
