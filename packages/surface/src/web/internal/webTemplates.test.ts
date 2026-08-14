import { describe, expect, it } from "vitest";
import { getWebTemplate, listWebTemplateNames } from "./webTemplates.js";

describe("web template registry", () => {
  it("lists exactly the three templates this package's web renderer knows today", () => {
    expect(listWebTemplateNames().sort()).toEqual(["AuthView", "ErrorView", "MarketingView"]);
  });

  it("getWebTemplate returns undefined for a name that is not registered", () => {
    expect(getWebTemplate("DashboardView")).toBeUndefined();
  });

  it("AuthView's flow marks exactly heading and form as required", () => {
    const template = getWebTemplate("AuthView")!;
    const required = template.flow.slots.filter((s) => s.required === true).map((s) => s.key).sort();
    expect(required).toEqual(["form", "heading"]);
  });

  it("ErrorView's flow marks exactly status and title as required", () => {
    const template = getWebTemplate("ErrorView")!;
    const required = template.flow.slots.filter((s) => s.required === true).map((s) => s.key).sort();
    expect(required).toEqual(["status", "title"]);
  });

  it("MarketingView's flow marks exactly brand, heroHeading, and ctaHeading as required", () => {
    const template = getWebTemplate("MarketingView")!;
    const required = template.flow.slots.filter((s) => s.required === true).map((s) => s.key).sort();
    expect(required).toEqual(["brand", "ctaHeading", "heroHeading"]);
  });

  it("MarketingView declares 'features' as a required repeating slot and 'faq' as an optional one — the only two", () => {
    const template = getWebTemplate("MarketingView")!;
    expect(template.repeatingSlots).toEqual([
      { key: "features", required: true },
      { key: "faq" },
    ]);
  });

  it("AuthView and ErrorView declare no repeating slots at all", () => {
    expect(getWebTemplate("AuthView")!.repeatingSlots).toBeUndefined();
    expect(getWebTemplate("ErrorView")!.repeatingSlots).toBeUndefined();
  });
});
