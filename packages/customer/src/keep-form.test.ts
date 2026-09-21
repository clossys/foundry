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

  function feedback(overrides: Record<string, unknown> = {}) {
    return {
      ...cleanKeep(),
      intent: "feedback",
      ...returning,
      functional: [{ happened: "I clicked Continue and the button did nothing.", expected: "I would move to the next step." }],
      experience: ["I felt stuck and a little foolish."],
      expectations: [{ assumed: "This would remember what I already typed.", actually: "It dumped me back to the start." }],
      blockedMe: "yes",
      whatIDidInstead: "I refreshed and typed it again, then gave up.",
      wantedInstead: "The next step, with my answers still there.",
      stillForMe: "yes",
      ...overrides,
    };
  }

  function compare(overrides: Record<string, unknown> = {}) {
    return {
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
      whatTheyDoBetter: "Friday's numbers are already there and I do not have to re-key them.",
      whatThisDoesBetter: "The first screen is calmer than my sheet.",
      whenIReachForThem: "Every Friday when I have to ship a number I cannot get wrong.",
      switchingCost: "I would have to rebuild a year of columns and trust a new place with Friday.",
      iWouldSwitch: "no",
      whatKeepsMeHere: "I already know where every column lives.",
      whatWouldMakeMeSwitch: "If Friday's numbers landed here without a side file.",
      ...overrides,
    };
  }

  it("accepts lived feedback as the same person, not a QA contractor", () => {
    expect(checkKeepForm(feedback(), audience)).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts purely functional feedback with empty experience", () => {
    const report = checkKeepForm(
      feedback({
        experience: [],
        expectations: [],
        blockedMe: "yes",
        whatIDidInstead: "I clicked it twice more, then left.",
        wantedInstead: "The button to take me forward.",
      }),
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts purely experiential feedback with empty functional", () => {
    const report = checkKeepForm(
      feedback({
        topic: "how the first screen made me feel",
        functional: [],
        expectations: [],
        experience: ["I thought this was for people like me, then the tone went corporate."],
        blockedMe: "no",
        whatIDidInstead: "I kept scrolling, slower.",
        wantedInstead: "The same calm voice I heard in the first line.",
      }),
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when feedback has no lived channel", () => {
    const report = checkKeepForm(
      feedback({
        functional: [],
        experience: [],
        expectations: [],
        blockedMe: "no",
        whatIDidInstead: "Nothing happened because I had nothing to report.",
        wantedInstead: "A reason to speak.",
      }),
      audience,
    );
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("lived-channel-required");
  });

  it("accepts comparison from my actual consideration set", () => {
    expect(checkKeepForm(compare(), audience)).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when compare has no alternatives", () => {
    const report = checkKeepForm(compare({ alternatives: [] }), audience);
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("alternatives-required");
  });

  it("returns indeterminate when compare omits lived competitive fields", () => {
    const report = checkKeepForm(
      compare({
        whatTheyDoBetter: undefined,
        whatThisDoesBetter: undefined,
        whenIReachForThem: undefined,
        switchingCost: undefined,
      }),
      audience,
    );
    expect(report.state).toBe("indeterminate");
    expect(report.findings.map((item) => item.rule)).toEqual(
      expect.arrayContaining(["they-do-better", "this-does-better", "when-i-reach", "switching-cost"]),
    );
  });

  it("accepts referral testimony including what it would take", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "refer",
        topic: "telling a peer",
        familiarity: "returning",
        wouldITellAPeer: "no",
        alreadyToldSomeone: "no",
        whatIdSay: "It is close, but I still would not stake my name on Friday yet.",
        whatStopsMe: "I still cannot explain the offer in one sentence.",
        whatItWouldTake: "One Friday that finishes here without a side file, then I would text a peer.",
        whoIdTell: "a peer who also hates long setup",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("returns violated when I already told someone but would not tell a peer", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "refer",
        topic: "telling a peer",
        familiarity: "returning",
        wouldITellAPeer: "no",
        alreadyToldSomeone: "yes",
        whatIdSay: "I already mentioned it, then walked it back.",
        whatStopsMe: "I am not ready to stake my name.",
        whatItWouldTake: "Proof on a Friday.",
        whoIdTell: "a peer who also hates long setup",
      },
      audience,
    );
    expect(report.state).toBe("violated");
    expect(report.findings.map((item) => item.rule)).toContain("refer-already-told-but-would-not");
  });

  it("accepts churn testimony including the warning before I leave", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "churn",
        topic: "what would make me leave",
        familiarity: "returning",
        wouldILeave: "yes",
        alreadyLooking: "yes",
        theWarning: "I start keeping a side file again because I do not trust Friday here.",
        theMoment: "The third time setup takes too long on a Monday.",
        whatWouldKeepMe: "If Friday finished here without a side file.",
        whereIdGo: "back to the spreadsheet I already live in",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts adopt testimony for what it would take to start", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "adopt",
        topic: "whether I would start using this on Monday",
        familiarity: "fresh",
        wouldIStart: "no",
        whatStopsMeStarting: "I cannot see where Friday's numbers would live.",
        whatItWouldTake: "A first Friday that finished here without a side file.",
        firstJobIdGiveIt: "Monday setup for the one team that already hates the spreadsheet.",
      },
      audience,
    );
    expect(report).toEqual({ state: "satisfied", findings: [] });
  });

  it("accepts worth testimony for whether this is worth what it costs me", () => {
    const report = checkKeepForm(
      {
        ...cleanKeep(),
        intent: "worth",
        topic: "whether this is worth my Fridays",
        familiarity: "returning",
        isItWorthIt: "no",
        whatItCostsMe: "An hour of setup every Monday plus the risk of a wrong Friday number.",
        whatIGet: "A calmer first screen and a promise I have not seen kept.",
        whatWouldMakeItWorthIt: "If that hour came back and Friday shipped from here.",
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
        alreadyLooking: "no",
        theWarning: "I would score the funnel instead of leaving.",
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
