import { describe, expect, it } from "vitest";
import {
  checkDirectionCoverage,
  checkDirectionCurrency,
  type DirectionCurrencyResult,
} from "./direction-invalidation.js";
import type { DirectionEntity } from "./schema.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain, following schema.test.ts's/brand-derivation.test.ts's
// own convention.

const RATIONALE = "Precision means every public claim traces to something checkable, and copy never hedges.";

function entity(id: string, overrides: Partial<DirectionEntity> = {}): DirectionEntity {
  return {
    id,
    kind: "mission",
    statement: "Every public claim a team makes should trace to something checkable.",
    rationale: RATIONALE,
    decidedOn: "2026-01-05",
    derivesFrom: [],
    ...overrides,
  };
}

// ------------------------------------------------------------- coverage

describe("checkDirectionCoverage", () => {
  it("holds when every direction entity has a derived artifact and every artifact traces to a real entity", () => {
    const result = checkDirectionCoverage(["vision", "positioning"], ["vision", "positioning"]);
    expect(result.ok).toBe(true);
    expect(result.entitiesWithoutDerivedArtifact).toEqual([]);
    expect(result.untraceableDerivedArtifacts).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  // Direction 1: an entity nothing derives from — "a vision nothing derives
  // from is a poster on a wall" (issue #374). This is the direction a
  // one-directional "does every artifact resolve" checker would never catch.
  it("flags direction 1: a direction entity named by no reviewedAgainst reference", () => {
    const result = checkDirectionCoverage(["vision", "positioning"], ["vision"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("coverage-gap");
    expect(result.entitiesWithoutDerivedArtifact).toEqual(["positioning"]);
    expect(result.untraceableDerivedArtifacts).toEqual([]);
  });

  // Direction 2: an artifact citing an id that names nothing real.
  it("flags direction 2: a reviewedAgainst reference naming no known direction entity", () => {
    const result = checkDirectionCoverage(["vision"], ["vision", "typo-d-id"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("coverage-gap");
    expect(result.entitiesWithoutDerivedArtifact).toEqual([]);
    expect(result.untraceableDerivedArtifacts).toEqual(["typo-d-id"]);
  });

  it("fails closed on an empty directionIds list, never a vacuous pass", () => {
    const result = checkDirectionCoverage([], ["vision"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-entities-provided");
    expect(result.entitiesChecked).toBe(0);
    expect(result.derivedArtifactsChecked).toBe(1);
  });

  it("fails closed on an empty reviewedAgainstRefs list, never a vacuous pass", () => {
    const result = checkDirectionCoverage(["vision"], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-reviews-provided");
    expect(result.entitiesChecked).toBe(1);
    expect(result.derivedArtifactsChecked).toBe(0);
  });

  it("fails closed when both lists are empty", () => {
    const result = checkDirectionCoverage([], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-entities-provided");
  });

  it("always reports checked counts, so 'checked nothing' can never look like 'checked and clean'", () => {
    const clean = checkDirectionCoverage(["vision"], ["vision"]);
    const empty = checkDirectionCoverage([], []);
    expect(clean.entitiesChecked).toBe(1);
    expect(empty.entitiesChecked).toBe(0);
  });
});

// -------------------------------------------------------------- currency

describe("checkDirectionCurrency", () => {
  it("holds when every reviewedAgainst names a current entity", () => {
    const entities = [entity("vision-v1")];
    const result = checkDirectionCurrency(entities, ["vision-v1"]);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("flags a dangling reviewedAgainst — names no entity in the given set at all", () => {
    const entities = [entity("vision-v1")];
    const result = checkDirectionCurrency(entities, ["vision-v1", "nonexistent-id"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("currency-violation");
    expect(result.findings).toEqual([{ reviewedAgainst: "nonexistent-id", kind: "dangling-reference" }]);
  });

  it("flags a stale reviewedAgainst — names a real entity that a newer version has superseded", () => {
    const entities = [entity("vision-v1"), entity("vision-v2", { supersedes: "vision-v1" })];
    const result = checkDirectionCurrency(entities, ["vision-v1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("currency-violation");
    expect(result.findings).toEqual([
      { reviewedAgainst: "vision-v1", kind: "stale-review", supersededBy: "vision-v2" },
    ]);
  });

  it("does not flag the CURRENT (superseding) version itself", () => {
    const entities = [entity("vision-v1"), entity("vision-v2", { supersedes: "vision-v1" })];
    const result = checkDirectionCurrency(entities, ["vision-v2"]);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("does not deduplicate: two artifacts citing the same stale version produce two findings", () => {
    const entities = [entity("vision-v1"), entity("vision-v2", { supersedes: "vision-v1" })];
    const result = checkDirectionCurrency(entities, ["vision-v1", "vision-v1"]);
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.kind === "stale-review")).toBe(true);
  });

  it("fails closed on an empty entities list, never a vacuous pass", () => {
    const result = checkDirectionCurrency([], ["vision-v1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-entities-provided");
  });

  it("fails closed on an empty reviewedAgainstRefs list, never a vacuous pass", () => {
    const result = checkDirectionCurrency([entity("vision-v1")], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-reviews-provided");
  });

  it("always reports checked counts, so 'checked nothing' can never look like 'checked and clean'", () => {
    const clean = checkDirectionCurrency([entity("vision-v1")], ["vision-v1"]);
    const empty = checkDirectionCurrency([], []);
    expect(clean.entitiesChecked).toBe(1);
    expect(empty.entitiesChecked).toBe(0);
  });
});

// ---------------------------------------------------------------------
// THE SEPARATING FIXTURE (issue #374's adversarial proof, mandatory).
//
// A weaker tool that only checks "does this reviewedAgainst id resolve to
// SOME known direction entity" is passed by an artifact whose
// reviewedAgainst names a REAL but SUPERSEDED version — the reference
// resolves cleanly, presence alone cannot see that the decision it points
// at is no longer the current one. This is exactly the gap
// `checkDirectionCoverage` (a presence/traceability checker, structurally
// identical to `checkBrandCoverage`) cannot close and was never asked to —
// see `direction-invalidation.ts`'s header comment. `checkDirectionCurrency`
// is the tool built to close it. This test asserts both halves of that
// claim in one place: the naive presence check passes, and
// `checkDirectionCurrency` fails, naming the specific `"stale-review"`
// finding kind.
// ---------------------------------------------------------------------

describe("the separating fixture — presence resolves, currency does not", () => {
  const visionV1 = entity("vision-v1", { statement: "We ship the fastest path from spreadsheet to real tool." });
  const visionV2 = entity("vision-v2", {
    supersedes: "vision-v1",
    statement: "We ship the fastest path from spreadsheet to a governed, auditable tool.",
    rationale: "Customers now cite audit requirements as their top blocker, not speed — the vision has to say so.",
    decidedOn: "2026-07-01",
  });
  const entities = [visionV1, visionV2];

  // The exact "weaker tool" the issue describes: presence only, no notion
  // of supersession at all.
  function namesAKnownEntity(directionEntities: DirectionEntity[], reviewedAgainst: string): boolean {
    return directionEntities.some((e) => e.id === reviewedAgainst);
  }

  it("a presence-only checker reports the superseded reference as passing", () => {
    expect(namesAKnownEntity(entities, "vision-v1")).toBe(true);
  });

  it("checkDirectionCurrency reports the identical reference as a stale-review finding, not ok", () => {
    const result: DirectionCurrencyResult = checkDirectionCurrency(entities, ["vision-v1"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("currency-violation");
    expect(result.findings).toEqual([
      { reviewedAgainst: "vision-v1", kind: "stale-review", supersededBy: "vision-v2" },
    ]);
  });

  it("checkDirectionCoverage — the presence/traceability checker — is satisfied by the very same reference", () => {
    // Same inputs, the OTHER checker: coverage only asks "does this
    // resolve", and vision-v1 resolves. This is what makes the separation
    // real — not a strawman, but this package's own sibling checker.
    const coverage = checkDirectionCoverage(["vision-v1", "vision-v2"], ["vision-v1", "vision-v2"]);
    expect(coverage.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// THE CONSTRUCTED POSITIVE CONTROL (issue #374's second required proof,
// mandatory).
//
// Start from a known-good fixture: a small DAG (vision → positioning →
// two audiences) where every derived artifact's reviewedAgainst names a
// CURRENT version, so checkDirectionCurrency holds. Perturb it in exactly
// one way — supersede the vision by adding a new DirectionEntity whose
// `supersedes` names the old vision's id — and re-run the SAME check
// against the SAME reviewedAgainst list. Every downstream artifact that
// cited the now-superseded vision must go stale IN THAT SAME RUN, each
// reported as its own `"stale-review"` finding. Asserting only "it
// failed" cannot distinguish the gate working from the harness being
// broken — this asserts the exact count and the exact finding kind for
// every downstream artifact, and separately confirms an UNRELATED
// artifact (reviewed against positioning, never touched by the
// supersession) is untouched.
// ---------------------------------------------------------------------

describe("the constructed positive control — supersession cascades to every downstream artifact, same run", () => {
  const visionV1 = entity("vision-v1");
  const positioning = entity("positioning-v1", { kind: "positioning", derivesFrom: ["vision-v1"] });

  // Four derived artifacts (by their reviewedAgainst reference), authored
  // against the good fixture: three review the vision, one reviews
  // positioning.
  const reviewedAgainstRefs = ["vision-v1", "vision-v1", "vision-v1", "positioning-v1"];

  it("known-good fixture: checkDirectionCurrency holds before any supersession", () => {
    const goodEntities = [visionV1, positioning];
    const before = checkDirectionCurrency(goodEntities, reviewedAgainstRefs);
    expect(before.ok).toBe(true);
    expect(before.findings).toEqual([]);
  });

  it("perturbation: superseding vision-v1 alone sends every artifact reviewed against it stale, in the same run, leaving the positioning-reviewed artifact untouched", () => {
    const visionV2 = entity("vision-v2", { supersedes: "vision-v1", decidedOn: "2026-07-01" });
    const perturbedEntities = [visionV1, visionV2, positioning]; // only addition vs. the good fixture above

    const after = checkDirectionCurrency(perturbedEntities, reviewedAgainstRefs);

    expect(after.ok).toBe(false);
    expect(after.reason).toBe("currency-violation");

    // Every one of the three artifacts that reviewedAgainst vision-v1 is
    // its own stale-review finding — proving "every downstream artifact",
    // not merely "the id is stale once".
    const staleFindings = after.findings.filter((f) => f.kind === "stale-review");
    expect(staleFindings).toHaveLength(3);
    for (const finding of staleFindings) {
      expect(finding.reviewedAgainst).toBe("vision-v1");
      expect(finding.supersededBy).toBe("vision-v2");
    }

    // No dangling findings, and nothing at all about the positioning
    // reference — it was never superseded and must not appear in
    // `findings`.
    expect(after.findings.some((f) => f.kind === "dangling-reference")).toBe(false);
    expect(after.findings.some((f) => f.reviewedAgainst === "positioning-v1")).toBe(false);
    expect(after.findings).toHaveLength(3);
  });
});
