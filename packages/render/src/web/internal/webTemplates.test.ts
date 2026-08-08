import { describe, expect, it } from "vitest";
import { getWebTemplate, listWebTemplateNames } from "./webTemplates.js";

describe("web template registry", () => {
  it("lists exactly the two templates this package's web renderer knows today", () => {
    expect(listWebTemplateNames().sort()).toEqual(["AuthView", "ErrorView"]);
  });

  it("getWebTemplate returns undefined for a name that is not registered", () => {
    expect(getWebTemplate("DashboardView")).toBeUndefined();
  });

  it("AuthView's layout marks exactly heading and form as required", () => {
    const template = getWebTemplate("AuthView")!;
    const required = template.layout.slots.filter((s) => s.required === true).map((s) => s.key).sort();
    expect(required).toEqual(["form", "heading"]);
  });

  it("ErrorView's layout marks exactly status and title as required", () => {
    const template = getWebTemplate("ErrorView")!;
    const required = template.layout.slots.filter((s) => s.required === true).map((s) => s.key).sort();
    expect(required).toEqual(["status", "title"]);
  });
});
