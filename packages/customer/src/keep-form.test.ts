import { describe, expect, it } from "vitest";
import { checkKeepForm, parseAudience, parseKeepRecord } from "./keep-form.js";

const audience = {
  id: "audience-one",
  name: "Maya Chen",
  description: "A product lead evaluating onboarding.",
  painPoints: ["setup takes too long", "unclear pricing"],
};

function cleanKeep(overrides: Record<string, unknown> = {}) {
  return {
    speaker: "customer",
    inhabitedAs: "target-audience",
    audienceId: "audience-one",
    persona: { name: "Maya Chen" },
    stance: "I came because setup takes too long and I need clarity fast.",
    impressions: {
      firstSeconds: "This looks like it was written for someone like me.",
      isThisForMe: "yes",
      doIBelieve: "yes",
      wouldIStay: "yes",
      wouldITellAPeer: "yes",
    },
    visual: { impression: "Clean and calm; I would keep scrolling." },
    verbal: { impression: "Plain language; I believe what it says." },
    verdict: "keep",
    ...overrides,
  };
}

describe("checkKeepForm", () => {
  it("returns satisfied for a clean keep record", () => {
    expect(checkKeepForm(cleanKeep(), audience)).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when speaker is a contractor role", () => {
    const report = checkKeepForm(cleanKeep({ speaker: "designer" }), audience);
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("speaker-not-customer");
  });

  it("returns violated when verdict is keep but an impression is no", () => {
    const report = checkKeepForm(cleanKeep({ impressions: { ...cleanKeep().impressions, wouldIStay: "no" } }), audience);
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("keep-with-no-impression");
  });

  it("returns violated when persona name does not match the audience", () => {
    const report = checkKeepForm(cleanKeep({ persona: { name: "Someone else" } }), audience);
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("persona-name-mismatch");
  });

  it("returns indeterminate when visual or verbal is missing", () => {
    const missingVisual = checkKeepForm({ ...cleanKeep(), visual: undefined }, audience);
    expect(missingVisual.state).toBe("indeterminate");
    expect(missingVisual.findings.map((item) => item.rule)).toContain("visual-impression");

    const missingVerbal = checkKeepForm({ ...cleanKeep(), verbal: undefined }, audience);
    expect(missingVerbal.state).toBe("indeterminate");
    expect(missingVerbal.findings.map((item) => item.rule)).toContain("verbal-impression");
  });

  it("returns violated when painPoints are not cited in stance", () => {
    const report = checkKeepForm(cleanKeep({ stance: "I showed up curious." }), audience);
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("stance-pain-point");
  });
});

describe("parse helpers", () => {
  it("parseAudience and parseKeepRecord accept valid JSON seams", () => {
    expect(parseAudience(audience)).toEqual(audience);
    expect(parseKeepRecord(cleanKeep()).speaker).toBe("customer");
  });

  it("parseKeepRecord throws on invalid speaker", () => {
    expect(() => parseKeepRecord(cleanKeep({ speaker: "reviewer" }))).toThrow(/parse(Keep|Inhabit)Record/);
  });
});

describe("speed-dial inhabit intents", () => {
  const returning = {
    familiarity: "returning",
    topic: "the checkout flow",
  };

  it("accepts lived feedback as the same person, not a QA contractor", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "feedback",
        ...returning,
        functional: [{ happened: "I clicked Continue and the button did nothing.", expected: "I would move to the next step." }],
        experience: ["I felt stuck and a little foolish."],
        expectations: [{ assumed: "This would remember what I already typed.", actually: "It dumped me back to the start." }],
        stillForMe: "yes",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts comparison from my actual consideration set", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "compare",
        topic: "how this sits next to what I already pay for",
        familiarity: "returning",
        alternatives: [
          {
            name: "the spreadsheet I already live in",
            relationship: "i-use-this",
            whyItMatters: "It is slow but I trust it with Friday's numbers.",
          },
        ],
        versus: "This looks faster until I have to export; then I go back.",
        iWouldSwitch: "no",
        whatKeepsMeHere: "I already know where every column lives.",
        whatWouldMakeMeSwitch: "If Friday's numbers landed here without a side file.",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when compare has no alternatives", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "compare",
        topic: "competitors",
        familiarity: "returning",
        alternatives: [],
        versus: "I do not actually have anyone to put this next to.",
        iWouldSwitch: "no",
        whatKeepsMeHere: "Habit.",
        whatWouldMakeMeSwitch: "A reason.",
      },
      audience,
    );
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("alternatives-required");
  });

  it("accepts referral testimony", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "refer",
        topic: "telling a peer",
        familiarity: "returning",
        wouldITellAPeer: "no",
        whatIdSay: "It is close, but I still would not stake my name on Friday yet.",
        whatStopsMe: "I still cannot explain the offer in one sentence.",
        whoIdTell: "a peer who also hates long setup",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts churn testimony", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "churn",
        topic: "what would make me leave",
        familiarity: "returning",
        wouldILeave: "yes",
        theMoment: "The third time setup takes too long on a Monday.",
        whatWouldKeepMe: "If Friday finished here without a side file.",
        whereIdGo: "back to the spreadsheet I already live in",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when churn is spoken as a reviewer", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        speaker: "reviewer",
        intent: "churn",
        topic: "churn",
        familiarity: "returning",
        wouldILeave: "no",
        theMoment: "I would score the funnel instead of leaving.",
        whatWouldKeepMe: "A better rubric.",
        whereIdGo: "the next audit",
      },
      audience,
    );
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("speaker-not-customer");
  });

  it("returns indeterminate for an unknown intent", () => {
    const report = checkKeepForm(cleanKeep({ intent: "audit" }), audience);
    expect(report.state).toBe("indeterminate");
    expect(report.findings.map((item) => item.rule)).toContain("intent-unknown");
  });
});
