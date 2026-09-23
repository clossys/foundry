import { describe, expect, it } from "vitest";
import { ENGAGEMENT_CONTEXT_FIELD_IDS, applyContextChoice, applyProblemChoice, nextContextQuestion, nextProblemQuestion } from "./index.js";
import type { EngagementContext, EngagementContextField } from "./index.js";

function context(known: Partial<Record<string, string>> = {}): EngagementContext {
  const fields: EngagementContextField[] = ENGAGEMENT_CONTEXT_FIELD_IDS.map((id) =>
    known[id] ? { id, state: "known", value: known[id]! } : { id, state: "unknown" },
  );
  return { schemaVersion: 1, fields };
}

describe("nextContextQuestion / applyContextChoice (issue #1173)", () => {
  it("asks for the first unknown field, in the fixed field order", () => {
    const card = nextContextQuestion(context());
    expect(card?.fieldId).toBe("business");
  });

  it("moves to the next field once the prior one is known", () => {
    const card = nextContextQuestion(context({ business: "product-or-service" }));
    expect(card?.fieldId).toBe("product");
  });

  it("returns null once every field is known", () => {
    const filled = context({
      business: "product-or-service",
      product: "software",
      audience: "consumers",
      stage: "building",
      intent: "validate",
      constraints: "none-known",
    });
    expect(nextContextQuestion(filled)).toBeNull();
  });

  it("every field's card offers 2-4 choices, an explicit unknown, and something-else last", () => {
    const known: Partial<Record<string, string>> = {};
    for (const fieldId of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      const card = nextContextQuestion(context(known))!;
      expect(card.fieldId).toBe(fieldId);
      expect(card.choices.length).toBeGreaterThanOrEqual(2);
      expect(card.choices.length).toBeLessThanOrEqual(4);
      expect(card.choices.some((choice) => choice.id === "unknown")).toBe(true);
      expect(card.choices.at(-1)?.id).toBe("something-else");
      known[fieldId] = card.choices[0]!.id;
    }
  });

  it("a known choice resolves to its own id as the value", () => {
    expect(applyContextChoice("stage", "building")).toEqual({ kind: "known", value: "building" });
  });

  it("never invents a value for unknown or something-else", () => {
    expect(applyContextChoice("stage", "unknown")).toEqual({ kind: "unknown" });
    expect(applyContextChoice("stage", "something-else")).toEqual({ kind: "something-else" });
  });

  it("rejects a choice id that is not on that field's card", () => {
    expect(applyContextChoice("stage", "software")).toEqual({ kind: "unknown-choice" });
  });
});

describe("nextProblemQuestion / applyProblemChoice (issue #1176, problem confirmation)", () => {
  it("offers the first unanswered problem candidate", () => {
    const card = nextProblemQuestion([]);
    expect(card).not.toBeNull();
    expect(card?.choices.map((choice) => choice.id)).toEqual(["confirmed", "declined", "unknown", "something-else"]);
  });

  it("skips a problem once it has a confirmed or declined state, offers the next one", () => {
    const first = nextProblemQuestion([]);
    const second = nextProblemQuestion([{ id: first!.problemId, state: "confirmed" }]);
    expect(second?.problemId).not.toBe(first?.problemId);
  });

  it("never invents a confirmation for unknown or something-else", () => {
    expect(applyProblemChoice("confirmed")).toEqual({ kind: "confirmed" });
    expect(applyProblemChoice("declined")).toEqual({ kind: "declined" });
    expect(applyProblemChoice("unknown")).toEqual({ kind: "unknown" });
    expect(applyProblemChoice("something-else")).toEqual({ kind: "something-else" });
    expect(applyProblemChoice("not-a-real-choice")).toEqual({ kind: "unknown-choice" });
  });
});
