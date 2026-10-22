import { describe, expect, it } from "vitest";
import { projectAndValidateStrategyContract } from "./projector.js";
import type { StrategyBundle } from "./reader.js";

const bundle: StrategyBundle = {
  root: "/tmp/strategy",
  facts: [
    {
      key: "active-customers",
      label: "Active customers",
      value: 4200,
      unit: "customers",
      source: "billing-export-2026-06",
      lastUpdatedAt: "2026-06-30",
    },
  ],
  audiences: [{ id: "ops-lead", name: "Operations lead", situation: "Runs operations.", pains: ["spreadsheet chaos"] }],
  positioning: {
    productName: "Widgetronic",
    category: "internal tooling platform",
    audienceIds: ["ops-lead"],
    weAre: "the fastest way to turn a spreadsheet into a real tool",
    unlike: "general-purpose no-code builders",
    claimIds: ["prototype-same-meeting"],
  },
  claims: [
    {
      id: "prototype-same-meeting",
      status: "approved",
      assertion: "We ship a working prototype in the same meeting the request is made.",
      basis: "Observed in three consecutive pilot sessions with operations teams.",
    },
  ],
  constraints: [],
  brand: {
    essence: { statement: "Precision engineering for teams who cannot afford to guess." },
    attributes: [
      {
        id: "precise",
        statement: "Every public claim we make is checkable.",
        basis: "Every number in our marketing traces to a facts.json entry, enforced in CI.",
      },
    ],
    derivations: [{ attributeId: "precise", tokenSlots: ["--color-accent-primary"], voiceRuleIds: [] }],
  },
  directions: [
    {
      id: "direction-2026-h1",
      subject: { file: "positioning.json", id: "positioning" },
      decidedOn: "2026-01-05",
      derivesFrom: [],
    },
  ],
  issues: [],
  complete: true,
};

describe("projectAndValidateStrategyContract", () => {
  it("mixed-date facts keep their own observation dates", () => {
    const referencedFacts: StrategyBundle["facts"] = [
      { key: "sample-count", label: "Sample count", value: 3, source: "sample-log", lastUpdatedAt: "2026-01-01" },
      { key: "record-count", label: "Record count", value: 5, source: "record-log", lastUpdatedAt: "2026-01-15" },
    ];
    const mixedDateBundle: StrategyBundle = {
      ...bundle,
      facts: referencedFacts,
      claims: bundle.claims?.map((claim) => ({ ...claim, factRefs: ["sample-count", "record-count"] })),
    };
    const withoutUnrelatedFact = projectAndValidateStrategyContract(mixedDateBundle);
    const withUnrelatedFact = projectAndValidateStrategyContract({
      ...mixedDateBundle,
      facts: [
        ...referencedFacts,
        { key: "unrelated-count", label: "Unrelated count", value: 8, source: "other-log", lastUpdatedAt: "2026-02-01" },
      ],
    });

    for (const result of [withoutUnrelatedFact, withUnrelatedFact]) {
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Mixed-date bundle must validate");
      const evidence = result.value.records.filter((record) => record.kind === "evidence");
      expect(evidence.filter((record) => record.evidenceKind === "observed-fact")).toEqual([
        expect.objectContaining({
          id: "prototype-same-meeting-fact-sample-count",
          statement: "Sample count",
          observedAt: "2026-01-01",
        }),
        expect.objectContaining({
          id: "prototype-same-meeting-fact-record-count",
          statement: "Record count",
          observedAt: "2026-01-15",
        }),
      ]);
      expect(evidence.find((record) => record.evidenceKind === "research")?.observedAt).toBeUndefined();
    }
    if (withoutUnrelatedFact.ok && withUnrelatedFact.ok) {
      expect(withoutUnrelatedFact.value.provenance.recordedAt).toBe("2026-01-15");
      expect(withUnrelatedFact.value.provenance.recordedAt).toBe("2026-02-01");
    }
  });

  it("projects a bundle that validates as a StrategyContract", () => {
    const result = projectAndValidateStrategyContract(bundle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provenance.source).toBe("strategy-directory");
      expect(result.value.revision).toBe("1.0.0");
      expect(result.value.records.some((record) => record.kind === "evidence")).toBe(true);
    }
  });
});
