import { describe, expect, it } from "vitest";
import { BUILTIN_WEB_TEMPLATES, DEFAULT_WEB_SLOT_KINDS, getWebTemplate, listWebTemplateNames, nodeSlotKeys, slotKindsFor } from "./webTemplates.js";

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

  it("BUILTIN_WEB_TEMPLATES is exactly the three built-ins, in their declared order", () => {
    expect(BUILTIN_WEB_TEMPLATES.map((t) => t.name)).toEqual(["AuthView", "ErrorView", "MarketingView"]);
  });
});

describe("web template registry — slotKinds default to ['copy', 'asset'], no built-in declares 'node'", () => {
  it("none of the three built-ins declare slotKinds at all", () => {
    for (const template of BUILTIN_WEB_TEMPLATES) {
      expect(template.slotKinds).toBeUndefined();
    }
  });

  it("slotKindsFor returns the shared default for every flowed slot on every built-in", () => {
    for (const template of BUILTIN_WEB_TEMPLATES) {
      for (const slot of template.flow.slots) {
        expect(slotKindsFor(template, slot.key)).toEqual(DEFAULT_WEB_SLOT_KINDS);
      }
    }
  });

  it("nodeSlotKeys is empty for every built-in — none declares a node-kind slot", () => {
    for (const template of BUILTIN_WEB_TEMPLATES) {
      expect(nodeSlotKeys(template)).toEqual([]);
    }
  });
});
