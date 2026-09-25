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
  it("asks every audience question when there is no brief (unchanged behaviour)", () => {
    const questions = pendingAudienceIntakeQuestions(noBrief);
    expect(questions.map((q) => q.id)).toEqual(["audience-type", "audience-name", "audience-situation", "audience-pains"]);
  });

  it("drops only audience-type when the brief's audience field is known (no duplicate question)", () => {
    const context = contextWith({ audience: "consumers", business: "product-or-service" });
    const questions = pendingAudienceIntakeQuestions(context);
    expect(questions.map((q) => q.id)).toEqual(["audience-name", "audience-situation", "audience-pains"]);
  });

  it("still asks audience-type when other context fields are known but audience itself is not (partial context)", () => {
    const context = contextWith({ business: "product-or-service", stage: "building" });
    const questions = pendingAudienceIntakeQuestions(context);
    expect(questions.map((q) => q.id)).toEqual(["audience-type", "audience-name", "audience-situation", "audience-pains"]);
  });

  it("asks every audience question when the brief is invalid (unchanged behaviour)", () => {
    const invalid = readEngagementContextFromBriefData("not an object").context;
    const questions = pendingAudienceIntakeQuestions(invalid);
    expect(questions.map((q) => q.id)).toEqual(["audience-type", "audience-name", "audience-situation", "audience-pains"]);
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
        situation: "Everyday consumers (B2C).",
        notes: expect.stringContaining("engagement brief"),
      });
      expect(result.provenance).toEqual({ audience: "brief" });
    }
  });

  it("seeds a businesses audience from a known context field", () => {
    const context = contextWith({ audience: "businesses" });
    const result = seedAudienceFromContext(context, []);
    expect(result.seeded).toBe(true);
    if (result.seeded) expect(result.audience.id).toBe("businesses");
  });

  it("never overwrites an existing detailed audiences.json record", () => {
    const context = contextWith({ audience: "consumers" });
    const result = seedAudienceFromContext(context, [{ id: "power-users" }]);
    expect(result).toEqual({ seeded: false, reason: "audiences-already-recorded" });
  });
});
