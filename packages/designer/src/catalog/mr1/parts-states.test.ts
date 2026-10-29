import { describe, expect, it } from "vitest";
import { loadSectionRegistry } from "../../catalog-core/sections-contract.js";
import passages from "../../../../writer/src/catalog/slots/passages.json" with { type: "json" };

const owned = ["band", "section-header", "pagination", "empty-state", "error-state", "boundary-message", "notices"];
describe("MR-1 registered parts and states", () => {
  it("resolves the named retired error-message id to the live error-state", () => {
    const registry = loadSectionRegistry();
    const alias = registry.aliases.find(row => row.id === "sections.error-message");
    expect(alias?.target).toBe("sections.error-state");
    expect(registry.slots.find(row => row.id === alias?.target)?.id).toBe("sections.error-state");
    expect(registry.slots.some(row => row.id === "sections.error-message")).toBe(false);
  });
  it("keeps every owned copy schema equal to its Writer passage", () => {
    const registry = loadSectionRegistry();
    for (const leaf of owned) {
      const section = registry.slots.find(row => row.id === `sections.${leaf}`)!;
      const passage = passages.find(row => row.id === section.contract.passageSchema)!;
      expect(passage.contract.sectionId).toBe(section.id);
      expect(passage.contract.copy).toEqual(section.contract.copy);
    }
  });
});
