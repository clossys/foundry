import { describe, expect, it } from "vitest";
import { CAPABILITY_CATALOGUE, KIT_PRESETS, recommendKit } from "./index.js";

const LAUNCH_PROBLEMS = [
  { id: "strategist-unclear-direction", primary: true },
  { id: "designer-interface-quality" },
  { id: "writer-unapproved-copy" },
  { id: "customer-would-they-keep-it" },
  { id: "publisher-verified-release" },
];

describe("recommendKit (issue #1177)", () => {
  it("attributes the verdict to a matching preset when the confirmed problems compose to exactly that preset's own closure", () => {
    const verdict = recommendKit({
      confirmedProblems: LAUNCH_PROBLEMS,
      catalogue: CAPABILITY_CATALOGUE,
      problem: "We can't explain what we are, and our site doesn't sell.",
      presets: KIT_PRESETS,
      overCapReason: "matches the curated launch preset",
    });
    expect(verdict.state).toBe("recommended");
    expect(verdict.source).toBe("preset");
    expect(verdict.presetId).toBe("launch");
    expect(new Set(verdict.sequence)).toEqual(new Set(["strategist", "designer", "writer", "customer", "publisher", "controller"]));
  });

  it("cites each direct role's own solves entry, naming the confirmed problem it matches", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.state).toBe("recommended");
    const writer = verdict.roles.find((role) => role.role === "writer");
    expect(writer?.citations).toHaveLength(1);
    expect(writer?.citations[0]?.problem).toBe("writer-unapproved-copy");
    expect(writer?.citations[0]?.evidence).toBe("designed");
  });

  it("a role pulled in only by a needs edge carries no citations", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "publisher-verified-release", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "We're not sure what's actually live.",
    });
    const controller = verdict.roles.find((role) => role.role === "controller");
    expect(controller).toBeDefined();
    expect(controller?.citations).toHaveLength(0);
  });

  it("deliverables come from each role's own boundary.owns, never invented copy", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.deliverables.length).toBeGreaterThan(0);
    const writerCapability = CAPABILITY_CATALOGUE.roles.find((role) => role.role === "writer");
    expect(verdict.deliverables).toContain(writerCapability?.boundary.owns);
  });

  it("over-cap without a reason never attributes a preset and is never ready for the client", () => {
    const verdict = recommendKit({
      confirmedProblems: LAUNCH_PROBLEMS,
      catalogue: CAPABILITY_CATALOGUE,
      problem: "We can't explain what we are, and our site doesn't sell.",
      presets: KIT_PRESETS,
    });
    expect(verdict.state).toBe("over-cap");
    expect(verdict.source).toBe("composed");
    expect(verdict.readyForClient).toBe(false);
  });

  it("indeterminate confirmed problems produce an indeterminate verdict, never a silent empty kit", () => {
    const verdict = recommendKit({ confirmedProblems: [], catalogue: CAPABILITY_CATALOGUE, problem: "unspecified" });
    expect(verdict.state).toBe("indeterminate");
    expect(verdict.roles).toHaveLength(0);
  });

  it("self-serve engagements are always ready for the client", () => {
    const verdict = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "Our words don't sound like us.",
    });
    expect(verdict.readyForClient).toBe(true);
  });

  it("managed engagements are not ready for the client until the engaged operator approves", () => {
    const engagement = { engagementMode: "managed" as const, operatorRef: "acme-consulting" };
    const notYetReviewed = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "Our words don't sound like us.",
      engagement,
    });
    expect(notYetReviewed.readyForClient).toBe(false);

    const approved = recommendKit({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
      problem: "Our words don't sound like us.",
      engagement,
      operatorReview: { operatorRef: "acme-consulting", reviewedAt: "2026-09-22T00:00:00Z", disposition: "approved" },
    });
    expect(approved.readyForClient).toBe(true);
  });
});
