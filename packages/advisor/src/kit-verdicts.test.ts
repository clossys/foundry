import { describe, expect, it } from "vitest";
import { composeKit, recommendKit } from "./index.js";
import { SYNTHETIC_CATALOGUE as CATALOGUE, SYNTHETIC_LAUNCH_PROBLEMS, SYNTHETIC_PRESETS } from "../test/synthetic-catalogue.js";

// Behaviour tests run against a fixed synthetic catalogue, never the
// generated one: correct `needs`/`solves` data landing in a package must
// not break a behaviour test (review of PR #1403). The real catalogue is
// exercised in composition.test.ts and catalogue-contract-shape.test.ts.

describe("recommendKit (issue #1177)", () => {
  it("attributes the verdict to a matching preset when the confirmed problems compose to exactly that preset's own closure", () => {
    const verdict = recommendKit({
      confirmedProblems: SYNTHETIC_LAUNCH_PROBLEMS,
      catalogue: CATALOGUE,
      problem: "We can't explain what we are.",
      presets: SYNTHETIC_PRESETS,
    });
    const launch = composeKit({ selectedRoles: SYNTHETIC_PRESETS[0]!.roles, catalogue: CATALOGUE });
    expect(launch.state).toBe("composed");
    expect(verdict.state).toBe("recommended");
    expect(verdict.source).toBe("preset");
    expect(verdict.presetId).toBe("launch");
    expect(new Set(verdict.sequence)).toEqual(new Set(launch.state === "composed" ? launch.sequence : []));
  });

  it("cites each direct role's own solves entry, naming the confirmed problem it matches", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.state).toBe("recommended");
    const writer = verdict.roles.find((role) => role.role === "writer");
    const declared = CATALOGUE.roles.find((role) => role.role === "writer")!.solves[0]!;
    expect(writer?.citations).toEqual([
      { problem: "writer-unapproved-copy", statement: declared.statement, metric: declared.metric, proofCase: declared.proofCase, evidence: declared.evidence },
    ]);
  });

  it("a role pulled in only by a needs edge carries no citations", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "publisher-verified-release", primary: true }],
      catalogue: CATALOGUE,
      problem: "We're not sure what's actually live.",
    });
    const toolchain = verdict.roles.find((role) => role.role === "toolchain");
    expect(toolchain).toBeDefined();
    expect(toolchain?.citations).toHaveLength(0);
  });

  it("deliverables come from each role's own boundary.owns, never invented copy", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.deliverables).toEqual(verdict.sequence.map((role) => CATALOGUE.roles.find((entry) => entry.role === role)!.boundary.owns));
  });

  it("over-cap without a reason never attributes a preset and is never ready for the client", () => {
    const verdict = recommendKit({
      confirmedProblems: [...SYNTHETIC_LAUNCH_PROBLEMS, { id: "customer-would-they-keep-it" }, { id: "influencer-audience-response" }],
      catalogue: CATALOGUE,
      problem: "We can't explain what we are.",
      presets: SYNTHETIC_PRESETS,
    });
    expect(verdict.state).toBe("over-cap");
    expect(verdict.source).toBe("composed");
    expect(verdict.presetId).toBeUndefined();
    expect(verdict.readyForClient).toBe(false);
  });

  it("indeterminate confirmed problems produce an indeterminate verdict, never a silent empty kit", () => {
    const verdict = recommendKit({ confirmedProblems: [], catalogue: CATALOGUE, problem: "unspecified" });
    expect(verdict.state).toBe("indeterminate");
    expect(verdict.roles).toHaveLength(0);
    expect(verdict.roleCycles).toEqual([]);
    expect(verdict.unjudgedCycle).toBeNull();
  });

  it("carries a cycle it cannot judge into the verdict, never passing it silently (issue #1382)", () => {
    // `inspector` and `integrator` have no capability map and need each other.
    const verdict = recommendKit({
      confirmedProblems: [{ id: "inspector-unchecked-release", primary: true }],
      catalogue: CATALOGUE,
      problem: "We ship without checking.",
    });
    expect(verdict.state).toBe("recommended");
    expect(verdict.unjudgedCycle).toEqual(["inspector", "integrator", "inspector"]);
    expect(verdict.roleCycles).toEqual([["inspector", "integrator", "inspector"]]);

    const clean = recommendKit({ confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }], catalogue: CATALOGUE, problem: "p" });
    expect(clean.unjudgedCycle).toBeNull();
    expect(clean.roleCycles).toEqual([]);
  });

  it("self-serve engagements are always ready for the client", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.readyForClient).toBe(true);
  });

  it("managed engagements are not ready for the client until the engaged operator approves", () => {
    const engagement = { engagementMode: "managed" as const, operatorRef: "acme-consulting" };
    const notYetReviewed = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CATALOGUE,
      problem: "Our words don't sound like us.",
      engagement,
    });
    expect(notYetReviewed.readyForClient).toBe(false);

    const approved = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CATALOGUE,
      problem: "Our words don't sound like us.",
      engagement,
      operatorReview: { operatorRef: "acme-consulting", reviewedAt: "2026-09-22T00:00:00Z", disposition: "approved" },
    });
    expect(approved.readyForClient).toBe(true);
  });
});
