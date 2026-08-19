import { describe, expect, it } from "vitest";
import { classifyRequirementId } from "./id-grammar.js";

describe("classifyRequirementId", () => {
  it("accepts every id the settled two-segment grammar admits", () => {
    for (const id of ["runtime.node", "tool.git", "tool.package-manager", "dependency.controller"]) {
      expect(classifyRequirementId(id)).toBeUndefined();
    }
  });

  it("reports the precision baked into an extra-segment id as value-embedded (issue #316)", () => {
    expect(classifyRequirementId("runtime.node.major")).toEqual({
      rule: "requirement-id-value-embedded",
      message: expect.stringContaining("3 dot-separated segments"),
    });
  });

  it("reports a value folded into the category as value-embedded (issue #316)", () => {
    expect(classifyRequirementId("package-manager.npm")).toEqual({
      rule: "requirement-id-value-embedded",
      message: expect.stringContaining('category "package-manager"'),
    });
  });

  it("reports a missing category as a generic shape finding, not value-embedded", () => {
    expect(classifyRequirementId("git")).toEqual({
      rule: "requirement-id",
      message: expect.stringContaining("missing a category"),
    });
  });

  it("reports non-string, empty, and malformed-character ids as generic shape findings", () => {
    for (const id of [undefined, null, 42, "", "Bad Id", "runtime.Node", "runtime.node ", " runtime.node"]) {
      expect(classifyRequirementId(id)).toMatchObject({ rule: "requirement-id" });
    }
  });

  it("reports an empty segment as a generic shape finding", () => {
    expect(classifyRequirementId("runtime.")).toMatchObject({ rule: "requirement-id" });
    expect(classifyRequirementId(".node")).toMatchObject({ rule: "requirement-id" });
    expect(classifyRequirementId("runtime..node")).toMatchObject({ rule: "requirement-id" });
  });

  it("accepts a hyphenated multi-word subject", () => {
    expect(classifyRequirementId("dependency.web-charts")).toBeUndefined();
  });
});
