import { describe, expect, it } from "vitest";
import { pendingAudienceIntakeQuestions, seedAudienceFromContext } from "./audience-intake.js";
import { readEngagementContextFromBriefData } from "./engagement-context.js";
import type { EngagementContextSnapshot } from "./engagement-context.js";

function contextWith(known: Record<string, string>): EngagementContextSnapshot {
  const fields = Object.entries(known).map(([id, value]) => ({ id, state: "known", value }));
  return readEngagementContextFromBriefData({ schemaVersion: 1, problem: "p", roles: [], sequence: [], deliverables: [], context: { schemaVersion: 1, fields } }).context;
}

const noBrief = readEngagementContextFromBriefData(undefined).context;

describe("pendingAudienceIntakeQuestions", () => {
  it("leads with a pointer to Advisor's own audience context card, plus the three genuinely distinct questions, when there is no brief", () => {
    const steps = pendingAudienceIntakeQuestions(noBrief);
    expect(steps[0]).toEqual({ kind: "context-pointer", fieldId: "audience", note: expect.any(String) });
    expect(steps.slice(1).map((s) => (s.kind === "question" ? s.id : s.kind))).toEqual(["audience-name", "audience-situation", "audience-pains"]);
  });

  it("never asks a Strategist-owned consumers-or-businesses question, even when the brief's audience field is unknown", () => {
    const steps = pendingAudienceIntakeQuestions(noBrief);
    for (const step of steps) {
      if (step.kind === "question") expect(step.id as string).not.toBe("audience-type");
    }
  });

  it("drops the pointer, and asks only the three genuinely distinct questions, when the brief's audience field is known", () => {
    const context = contextWith({ audience: "consumers", business: "product-or-service" });
    const steps = pendingAudienceIntakeQuestions(context);
    expect(steps.every((s) => s.kind === "question")).toBe(true);
    expect(steps.map((s) => (s as { id: string }).id)).toEqual(["audience-name", "audience-situation", "audience-pains"]);
  });

  it("still leads with the pointer when other context fields are known but audience itself is not (partial context)", () => {
    const context = contextWith({ business: "product-or-service", stage: "building" });
    const steps = pendingAudienceIntakeQuestions(context);
    expect(steps[0]).toMatchObject({ kind: "context-pointer", fieldId: "audience" });
    expect(steps).toHaveLength(4);
  });

  it("leads with the pointer when the brief is invalid, the same starting point as no brief at all", () => {
    const invalid = readEngagementContextFromBriefData("not an object").context;
    const steps = pendingAudienceIntakeQuestions(invalid);
    expect(steps[0]).toMatchObject({ kind: "context-pointer", fieldId: "audience" });
    expect(steps).toHaveLength(4);
  });
});

describe("seedAudienceFromContext", () => {
  it("refuses to seed when the audience context field is unknown", () => {
    const result = seedAudienceFromContext(noBrief, []);
    expect(result).toEqual({ seeded: false, reason: "no-audience-context" });
  });

  it("seeds a consumers audience from a known context field, with provenance", () => {
    const context = contextWith({ audience: "consumers" });
    const result = seedAudienceFromContext(context, []);
    expect(result.seeded).toBe(true);
    if (result.seeded) {
      expect(result.audience).toEqual({
        id: "consumers",
        name: "Consumers",
        situation: "Consumers, per the engagement brief's audience answer — situation not yet described.",
        notes: expect.stringContaining("engagement brief"),
      });
      expect(result.provenance).toEqual({ audience: "brief" });
    }
  });

  it("seeds a businesses audience from a known context field, with its own situation text", () => {
    const context = contextWith({ audience: "businesses" });
    const result = seedAudienceFromContext(context, []);
    expect(result.seeded).toBe(true);
    if (result.seeded) {
      expect(result.audience.id).toBe("businesses");
      expect(result.audience.name).toBe("Businesses");
      expect(result.audience.situation).toBe("Businesses, per the engagement brief's audience answer — situation not yet described.");
    }
  });

  it("never overwrites an existing detailed audiences.json record", () => {
    const context = contextWith({ audience: "consumers" });
    const result = seedAudienceFromContext(context, [{ id: "power-users" }]);
    expect(result).toEqual({ seeded: false, reason: "audiences-already-recorded" });
  });
});
