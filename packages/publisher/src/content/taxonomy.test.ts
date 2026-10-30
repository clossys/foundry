import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_TREE, CONTENT_TAXONOMY, createSlotId, isContentL1, isContentL2, isContentPlacement, isSlotId, loadContentTree,
} from "./taxonomy.js";
import type { ContentPlacement, SlotId } from "./taxonomy.js";
import treeData from "./tree.json" with { type: "json" };

afterEach(() => vi.unstubAllGlobals());

describe("content taxonomy", () => {
  it("loads the seed JSON in presentation order and derives the compatibility view", () => {
    expect(CONTENT_TREE).toEqual(treeData);
    expect(loadContentTree()).toEqual(treeData);
    expect(CONTENT_TAXONOMY).toEqual({
      websites: ["site", "admin", "auth", "app", "demo"],
      documents: ["docs"],
      presentations: ["decks"],
      videos: ["clips"],
      messages: ["email"],
      social: ["posts"],
    });
    expect(Object.keys(CONTENT_TAXONOMY)).toEqual([
      "websites", "documents", "presentations", "videos", "messages", "social",
    ]);
    expect(Object.isFrozen(CONTENT_TAXONOMY)).toBe(true);
    expect(Object.values(CONTENT_TAXONOMY).every(Object.isFrozen)).toBe(true);
    const kinds = Object.values(CONTENT_TAXONOMY).flat();
    expect(kinds).toHaveLength(10);
    for (const [l1, registered] of Object.entries(CONTENT_TAXONOMY)) {
      for (const l2 of kinds) {
        expect(isContentPlacement(l1, l2)).toBe((registered as readonly string[]).includes(l2));
      }
    }
  });

  it.each([
    ["communications", "messages"], ["websites", "internal"],
    ["documents", "slides"], ["documents", "site"], ["websites", "docs"],
    ["presentations", "clips"], ["videos", "decks"], ["messages", "posts"],
    ["social", "email"], ["unknown", "site"], ["toString", "site"],
    [null, "site"], ["websites", null], ["websites", 1],
  ])("rejects unregistered placement %s/%s", (l1, l2) => {
    expect(isContentPlacement(l1, l2)).toBe(false);
  });

  it("checks editable string placements at runtime", () => {
    const valid: ContentPlacement = { l1: "presentations", l2: "decks" };
    const invalid: ContentPlacement = { l1: "documents", l2: "decks" };
    expect(isContentPlacement(valid.l1, valid.l2)).toBe(true);
    expect(isContentPlacement(invalid.l1, invalid.l2)).toBe(false);
  });

  it("accepts custom groups, child IDs, labels, ordering and optional frame references", () => {
    const editable = structuredClone(treeData);
    const group = editable.nodes[0]!;
    group.id = "custom";
    group.label = "Custom group";
    group.children[0]!.id = "landing";
    group.children[0]!.label = "Landing page";
    group.children.reverse();
    editable.nodes.reverse();
    const tree = loadContentTree(editable);
    expect(tree.nodes.at(-1)?.children.at(-1)).toEqual({ id: "landing", label: "Landing page", frame: "site-shell" });
    expect(isContentL1("custom", tree)).toBe(true);
    expect(isContentL2("custom", "landing", tree)).toBe(true);
    expect(isContentPlacement("custom", "landing", tree)).toBe(true);
    expect(isContentPlacement("websites", "site", tree)).toBe(false);
    expect(isContentPlacement("custom", "landing")).toBe(false);
    group.label = "Edited afterward";
    expect(tree.nodes.at(-1)?.label).toBe("Custom group");
    expect(Object.isFrozen(tree.nodes)).toBe(true);
    expect(Object.isFrozen(tree.nodes.at(-1))).toBe(true);
    expect(Object.isFrozen(tree.nodes.at(-1)?.children)).toBe(true);
    expect(Object.isFrozen(tree.nodes.at(-1)?.children[0])).toBe(true);
    expect(loadContentTree({ schemaVersion: 1, nodes: [{ id: "custom", label: "Custom", children: [{ id: "plain", label: "Plain" }] }] }).nodes[0]?.children[0]?.frame).toBeUndefined();
  });

  it.each([
    null, {}, { schemaVersion: 2, nodes: [] }, { schemaVersion: 1, nodes: {} },
    { schemaVersion: 1, nodes: [], extra: true },
    { schemaVersion: 1, nodes: [{ id: "", label: "Group", children: [] }] },
    { schemaVersion: 1, nodes: [{ id: "group", label: " ", children: [] }] },
    { schemaVersion: 1, nodes: [{ id: "group", label: "Group" }] },
    { schemaVersion: 1, nodes: [{ id: "group", label: "Group", children: [null] }] },
    { schemaVersion: 1, nodes: [{ id: "group", label: "Group", children: [{ id: "kind", label: "Kind", frame: 1 }] }] },
    { schemaVersion: 1, nodes: [{ id: "group", label: "Group", children: [{ id: "kind", label: "Kind", extra: true }] }] },
  ])("rejects malformed tree data %#", input => {
    expect(() => loadContentTree(input)).toThrow(/Invalid content tree/);
  });

  it("rejects duplicate group and sibling child IDs", () => {
    const group = { id: "group", label: "Group", children: [] };
    expect(() => loadContentTree({ schemaVersion: 1, nodes: [group, group] })).toThrow(/duplicate group/);
    const child = { id: "kind", label: "Kind" };
    expect(() => loadContentTree({ schemaVersion: 1, nodes: [{ ...group, children: [child, child] }] })).toThrow(/duplicate child/);
  });
});

describe("slot ids", () => {
  it.each([
    "sl_abcdefghij", "sl_234567abcd", "sl_zzzzzzzzzz",
  ])("accepts the strict base32 id %s", id => {
    expect(isSlotId(id)).toBe(true);
  });

  it.each([
    "sl_abcdefghi", "sl_abcdefghijk", "sl_ABCDEFGHIJ", "sl_abcdefgh01",
    "sl_abcdefgh89", "sl_abcdefghi_", "sl_abcdefghi-", "SL_abcdefghij",
    " sl_abcdefghij", "sl_abcdefghij ", "sl_abcdefghij\n",
    "websites/site/home", "sl_", "", null, undefined, 12,
  ])("rejects malformed id %s", id => {
    expect(isSlotId(id)).toBe(false);
  });

  it("mints random valid ids without a placement or path", () => {
    const ids = Array.from({ length: 64 }, () => createSlotId());
    expect(ids.every(isSlotId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses secure random bytes and retries an occupied id", () => {
    let calls = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        return bytes.fill(calls++ === 0 ? 255 : 32);
      },
    });
    const existing = new Set(["sl_7777777777"]);
    expect(createSlotId(existing)).toBe("sl_aaaaaaaaaa");
    expect(calls).toBe(2);
    expect([...existing]).toEqual(["sl_7777777777"]);
  });

  it("fails when every random result collides", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) { return bytes.fill(0); },
    });
    expect(() => createSlotId(new Set(["sl_aaaaaaaaaa"]))).toThrow(/unique slot id/);
  });

  it("does not fall back to insecure randomness when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createSlotId()).toThrow();
  });

  it("preserves identity across placement, path, and position changes", () => {
    const id: SlotId = createSlotId();
    const initial = {
      id, placement: { l1: "websites", l2: "site" } satisfies ContentPlacement,
      path: "/home", positionName: "intro",
    };
    const moved = {
      ...initial,
      placement: { l1: "documents", l2: "docs" } satisfies ContentPlacement,
      path: "/guide", positionName: "overview",
    };
    expect(moved.id).toBe(initial.id);
    expect(isSlotId(moved.id)).toBe(true);
  });
});
