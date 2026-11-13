import { describe, expect, it } from "vitest";
import data from "./tree.json" with { type: "json" };
import { loadContentTree, isContentL2 } from "./taxonomy.js";
import { checkSlotLeafFreeze } from "./leaf-freeze.js";
import { leafRegistryFixture, reviewFixture } from "./__fixtures__/review.js";
import { validateContentRegistry } from "./validate.js";
import { computeContentDigest } from "./digest.js";
import { checkContentActivation } from "./approval.js";

describe("regrouping independently of leaf membership and approval", () => {
  it("moves one slot and renames/reorders an L2 without changing ids or approved content", () => {
    const leaf = leafRegistryFixture();
    const candidate = reviewFixture().candidates[0]!;
    const registry = {
      ...leaf, candidates: [candidate],
      slots: leaf.slots.map((slot, index) => index ? slot : { ...slot, activeCandidateId: candidate.id }),
    };
    const ids = registry.slots.map(slot => slot.id);
    const digest = computeContentDigest(candidate);
    const approval = structuredClone(candidate.approval);
    expect(checkContentActivation(registry)).toEqual([]);
    const editable = structuredClone(data);
    const app = editable.nodes[0]!.children.find(child => child.id === "app")!;
    app.id = "application"; app.label = "Application pages";
    editable.nodes[0]!.children.reverse();
    const tree = loadContentTree(editable);
    const moved = { ...registry, slots: registry.slots.map((slot, index) => index ? slot : { ...slot, l2: "admin" }) };
    expect(isContentL2("websites", "application", tree)).toBe(true);
    expect(isContentL2("websites", "app", tree)).toBe(false);
    expect(validateContentRegistry(moved, tree)).toEqual([]);
    expect(moved.slots.map(slot => slot.id)).toEqual(ids);
    expect(checkSlotLeafFreeze(moved.slots)).toEqual([]);
    expect(computeContentDigest(moved.candidates[0]!)).toBe(digest);
    expect(moved.candidates[0]!.approval).toEqual(approval);
    expect(checkContentActivation(moved)).toEqual([]);
  });
});
