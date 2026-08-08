import { describe, expect, it } from "vitest";
import { getSlotSpec, listSlotKeys, requiredSlotKeys } from "./slots.js";
import type { LayoutSpec } from "./types.js";

const layout: LayoutSpec = {
  slots: [
    { key: "heading", element: "heading", frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 }, required: true },
    { key: "body", element: "body", frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.5 } },
    { key: "logo", element: "logo", frame: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 }, required: true },
  ],
};

describe("listSlotKeys", () => {
  it("returns every slot key, in declaration order", () => {
    expect(listSlotKeys(layout)).toEqual(["heading", "body", "logo"]);
  });
  it("returns an empty array for an empty layout", () => {
    expect(listSlotKeys({ slots: [] })).toEqual([]);
  });
});

describe("requiredSlotKeys", () => {
  it("returns only the slots marked required: true", () => {
    expect(requiredSlotKeys(layout)).toEqual(["heading", "logo"]);
  });
  it("returns an empty array when no slot is required", () => {
    expect(requiredSlotKeys({ slots: [{ key: "x", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 } }] })).toEqual([]);
  });
});

describe("getSlotSpec", () => {
  it("returns the matching SlotSpec by key", () => {
    expect(getSlotSpec(layout, "body")?.element).toBe("body");
  });
  it("returns undefined for a key that isn't in the layout", () => {
    expect(getSlotSpec(layout, "does-not-exist")).toBeUndefined();
  });
});
