import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

describe("SECTION_GROUND_CLASSES", () => {
  it("is exhaustive over the closed ground vocabulary", () => {
    const grounds: readonly SectionGround[] = ["base", "sunken", "inverse"];
    expect(Object.keys(SECTION_GROUND_CLASSES)).toEqual(grounds);
  });

  it("owns the full surface, foreground, divider, connector, and status policy", () => {
    expect(SECTION_GROUND_CLASSES.base).toMatchObject({
      surface: "",
      primary: "text-ink-primary",
      secondary: "text-ink-secondary",
      border: "border-line-base",
      line: "bg-line-base",
    });
    expect(SECTION_GROUND_CLASSES.sunken).toMatchObject({
      surface: "bg-surface-sunken",
      primary: "text-ink-primary",
      secondary: "text-ink-secondary",
      border: "border-line-base",
      line: "bg-line-base",
    });
    expect(SECTION_GROUND_CLASSES.inverse).toMatchObject({
      surface: "bg-surface-inverse",
      primary: "text-ink-on-inverse",
      secondary: "text-ink-on-inverse-muted",
      border: "border-line-on-inverse",
      line: "bg-line-on-inverse",
    });
  });

  it("inherits the ambient surface on base while painting non-base grounds", () => {
    expect(SECTION_GROUND_CLASSES.base.surface).toBe("");
    expect(SECTION_GROUND_CLASSES.sunken.surface).toBe("bg-surface-sunken");
    expect(SECTION_GROUND_CLASSES.inverse.surface).toBe("bg-surface-inverse");
  });

  it("keeps status display tokens on every ground and adds checked contrast boundaries off base", () => {
    for (const ground of Object.values(SECTION_GROUND_CLASSES)) {
      expect(ground.status.success).toContain("bg-status-success");
      expect(ground.status.warning).toContain("bg-status-warning");
      expect(ground.status.info).toContain("bg-status-info");
    }
    expect(SECTION_GROUND_CLASSES.base.status.success).not.toContain("ring-");
    expect(SECTION_GROUND_CLASSES.sunken.status.success).toContain("ring-ink-primary");
    expect(SECTION_GROUND_CLASSES.inverse.status.success).toContain("ring-ink-on-inverse");

    const checkedPairs = new Set(CONTRAST_PAIRS.map((pair) => pair.id));
    expect(checkedPairs.has("status-success/surface-base")).toBe(true);
    expect(checkedPairs.has("status-warning/surface-base")).toBe(true);
    expect(checkedPairs.has("status-info/surface-base")).toBe(true);
    expect(checkedPairs.has("ink-primary/surface-sunken")).toBe(true);
    expect(checkedPairs.has("ink-on-inverse/surface-inverse")).toBe(true);
    expect(checkedPairs.has("ink-on-inverse-muted/surface-inverse")).toBe(true);
  });
});
