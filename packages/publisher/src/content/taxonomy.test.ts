import { describe, expect, it } from "vitest";
import { CONTENT_TAXONOMY, isContentPlacement, createSlotId } from "./taxonomy.js";

describe("content taxonomy", () => {
  it("contains the exact three groups and nine kinds", () => {
    expect(CONTENT_TAXONOMY).toEqual({
      websites: ["site", "app", "admin", "demo", "internal"],
      documents: ["slides", "docs"],
      communications: ["messages", "videos"],
    });
    expect(Object.isFrozen(CONTENT_TAXONOMY)).toBe(true);
    expect(Object.values(CONTENT_TAXONOMY).every(Object.isFrozen)).toBe(true);
  });
  it("rejects unknown kinds and kinds under the wrong group", () => {
    expect(isContentPlacement("communications", "social")).toBe(false);
    expect(isContentPlacement("documents", "site")).toBe(false);
    expect(isContentPlacement("unknown", "site")).toBe(false);
    expect(isContentPlacement("websites", "internal")).toBe(true);
  });
  it("issues an id from the initial placement and a single position name", () => {
    expect(createSlotId("websites", "site", "home")).toBe("websites/site/home");
    expect(() => createSlotId("documents", "site" as "docs", "home")).toThrow();
    expect(createSlotId("websites", "site", "nested/home")).toBe("websites/site/nested/home");
    expect(() => createSlotId("websites", "site", " ")).toThrow();
  });
});
