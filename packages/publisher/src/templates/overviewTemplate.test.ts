import { describe, expect, it } from "vitest";
import { COMPANY_OVERVIEW_TEMPLATES, overviewSectionIds } from "./overviewTemplate.js";

describe("COMPANY_OVERVIEW_TEMPLATES", () => {
  it("declares short, medium, and long (#1206's own three lengths)", () => {
    expect(Object.keys(COMPANY_OVERVIEW_TEMPLATES).sort()).toEqual(["long", "medium", "short"]);
  });

  it("every length starts with a one-liner and ends with a call-to-action", () => {
    for (const sections of Object.values(COMPANY_OVERVIEW_TEMPLATES)) {
      expect(sections[0]).toBe("one-liner");
      expect(sections[sections.length - 1]).toBe("call-to-action");
    }
  });

  it("each length is strictly longer than the previous (short < medium < long)", () => {
    expect(COMPANY_OVERVIEW_TEMPLATES.short.length).toBeLessThan(COMPANY_OVERVIEW_TEMPLATES.medium.length);
    expect(COMPANY_OVERVIEW_TEMPLATES.medium.length).toBeLessThan(COMPANY_OVERVIEW_TEMPLATES.long.length);
  });

  it("every length's sections are unique within that length", () => {
    for (const sections of Object.values(COMPANY_OVERVIEW_TEMPLATES)) expect(new Set(sections).size).toBe(sections.length);
  });
});

describe("overviewSectionIds", () => {
  it("returns the same array the registry declares", () => {
    expect(overviewSectionIds("short")).toBe(COMPANY_OVERVIEW_TEMPLATES.short);
  });
});
