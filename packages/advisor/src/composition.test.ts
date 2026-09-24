import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOGUE,
  CLIENT_PROBLEMS,
  EVIDENCE_LEVELS,
  FIRST_ENGAGEMENT_ROLE_CAP,
  KIT_PRESETS,
  composeKit,
  composeKitFromProblems,
  evidenceAtLeast,
  kitCatalogueDigest,
  presetEvidenceFindings,
  toEngagementBrief,
  validateKitProposal,
} from "./index.js";
import type { ComposeKitResult } from "./index.js";
import { SYNTHETIC_CATALOGUE } from "../test/synthetic-catalogue.js";

// Tests of the generated CAPABILITY_CATALOGUE check properties that hold
// for any correct data (the contract's solves rule, every preset
// composing). Tests of composition behaviour use a fixed synthetic
// catalogue, so correct `needs`/`solves` landing in a package cannot break
// them (review of PR #1403).

describe("CAPABILITY_CATALOGUE and kitCatalogueDigest", () => {
  it("has one entry per role, excluding executable tooling", () => {
    const roleNames = CAPABILITY_CATALOGUE.roles.map((role) => role.role).sort();
    expect(roleNames).toHaveLength(19);
    expect(roleNames.includes("launcher")).toBe(false);
    expect(roleNames.includes("starter")).toBe(false);
    expect(roleNames.includes("publisher")).toBe(true);
  });

  it("gives every role solves entries that follow the package-framework contract's rule", () => {
    // The contract: `problem` is a declared client-problems.json id,
    // `statement` a nonempty sentence, `metric` the role's OWN owned
    // metric, `proofCase` nonempty, and `evidence` one of the three tiers
    // -- `designed`, `qualified` or `proven`, not only `designed`.
    for (const role of CAPABILITY_CATALOGUE.roles) {
      expect(role.solves.length).toBeGreaterThan(0);
      for (const entry of role.solves) {
        expect(CLIENT_PROBLEMS.some((problem) => problem.id === entry.problem)).toBe(true);
        expect(entry.statement.trim()).not.toBe("");
        expect(entry.metric).toBe(role.metric.name);
        expect(entry.proofCase.trim()).not.toBe("");
        expect(EVIDENCE_LEVELS).toContain(entry.evidence);
        if (entry.capability !== undefined) expect(role.capabilities.map((capability) => capability.id)).toContain(entry.capability);
      }
    }
  });

  it("is a deterministic sha256 hex digest", () => {
    expect(kitCatalogueDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("KIT_PRESETS", () => {
  it("are curated starting points, not a partition -- fewer roles than the full catalogue", () => {
    const presetRoles = new Set(KIT_PRESETS.flatMap((preset) => preset.roles));
    expect(presetRoles.size).toBeLessThan(CAPABILITY_CATALOGUE.roles.length);
  });

  it("every preset composes cleanly against the real catalogue", () => {
    for (const preset of KIT_PRESETS) {
      const composed = composeKit({ selectedRoles: preset.roles, catalogue: CAPABILITY_CATALOGUE });
      expect(composed.state).toBe("composed");
      if (composed.state === "composed") {
        expect(composed.unsatisfiedNeeds).toHaveLength(0);
        expect(composed.unjudgedCycle).toBeNull();
      }
    }
  });

  it("grow is an addOn to launch", () => {
    const grow = KIT_PRESETS.find((preset) => preset.id === "grow");
    expect(grow?.addOnTo).toBe("launch");
  });
});

describe("composeKit", () => {
  it("pulls in every role a selected role needs, each ahead of its consumer", () => {
    const composed = composeKit({ selectedRoles: ["publisher"], catalogue: SYNTHETIC_CATALOGUE });
    expect(composed.state).toBe("composed");
    if (composed.state === "composed") {
      expect([...composed.addedForDependencies].sort()).toEqual(["designer", "platform", "writer"]);
      for (const producer of ["designer", "platform", "writer"]) {
        expect(composed.sequence.indexOf(producer)).toBeLessThan(composed.sequence.indexOf("publisher"));
      }
      expect(composed.unsatisfiedNeeds).toEqual([]);
    }
  });

  it("pulls in every role a real catalogue role needs, each ahead of its consumer", () => {
    for (const role of CAPABILITY_CATALOGUE.roles) {
      const composed = composeKit({ selectedRoles: [role.role], catalogue: CAPABILITY_CATALOGUE });
      if (composed.state !== "composed") continue;
      for (const need of role.needs) {
        if (need.role && composed.roleCycles.length === 0) expect(composed.sequence.indexOf(need.role)).toBeLessThan(composed.sequence.indexOf(role.role));
      }
    }
  });

  it("reports an unknown role as indeterminate", () => {
    expect(composeKit({ selectedRoles: ["not-a-role"], catalogue: CAPABILITY_CATALOGUE }).state).toBe("indeterminate");
  });
});

describe("composeKitFromProblems", () => {
  it("is deterministic regardless of confirmed-problem order", () => {
    const a = composeKitFromProblems({
      confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }, { id: "designer-interface-quality" }],
      catalogue: CAPABILITY_CATALOGUE,
    });
    const b = composeKitFromProblems({
      confirmedProblems: [{ id: "designer-interface-quality" }, { id: "writer-unapproved-copy", primary: true }],
      catalogue: CAPABILITY_CATALOGUE,
    });
    expect(a).toEqual(b);
    expect(a.state).toBe("composed");
  });

  it("requires exactly one primary confirmed problem", () => {
    expect(composeKitFromProblems({ confirmedProblems: [{ id: "writer-unapproved-copy" }], catalogue: CAPABILITY_CATALOGUE }).state).toBe(
      "indeterminate",
    );
    expect(
      composeKitFromProblems({
        confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }, { id: "designer-interface-quality", primary: true }],
        catalogue: CAPABILITY_CATALOGUE,
      }).state,
    ).toBe("indeterminate");
  });

  it("enforces the first-engagement role cap unless overCapReason is given", () => {
    const confirmedProblems = [
      { id: "strategist-unclear-direction", primary: true },
      { id: "writer-unapproved-copy" },
      { id: "designer-interface-quality" },
      { id: "customer-would-they-keep-it" },
      { id: "publisher-verified-release" },
      { id: "influencer-audience-response" },
    ];
    const overCap = composeKitFromProblems({ confirmedProblems, catalogue: CAPABILITY_CATALOGUE });
    expect(overCap.state).toBe("over-cap");
    if (overCap.state === "over-cap") {
      expect(overCap.cap).toBe(FIRST_ENGAGEMENT_ROLE_CAP);
      expect(overCap.roleCount).toBeGreaterThan(FIRST_ENGAGEMENT_ROLE_CAP);
    }
    const withReason = composeKitFromProblems({ confirmedProblems, catalogue: CAPABILITY_CATALOGUE, overCapReason: "client wants the full launch+grow set" });
    expect(withReason.state).toBe("composed");
  });

  it("comes back indeterminate rather than an empty kit when no role solves the confirmed problem", () => {
    expect(composeKitFromProblems({ confirmedProblems: [{ id: "not-a-real-problem", primary: true }], catalogue: CAPABILITY_CATALOGUE }).state).toBe(
      "indeterminate",
    );
  });

  it("traces each direct role back to the confirmed problems it itself solves", () => {
    const result = composeKitFromProblems({ confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }], catalogue: CAPABILITY_CATALOGUE });
    expect(result.state).toBe("composed");
    if (result.state === "composed") {
      const writer = result.roles.find((role) => role.role === "writer");
      expect(writer?.isDirect).toBe(true);
      expect(writer?.confirmedProblemIds).toEqual(["writer-unapproved-copy"]);
    }
  });
});

describe("validateKitProposal", () => {
  const confirmedProblems = [{ id: "writer-unapproved-copy", primary: true }];
  const CAPABILITY_CATALOGUE = SYNTHETIC_CATALOGUE;

  it("drops a role that links to no confirmed problem and is not needed by one that does", () => {
    const result = validateKitProposal({
      proposal: { problem: "Our words don't sound like us.", roles: [{ role: "writer", why: "writer job" }, { role: "strategist", why: "seemed related" }] },
      confirmedProblems,
      catalogue: CAPABILITY_CATALOGUE,
    });
    expect(result.state).toBe("indeterminate");
    expect(result.removalCandidates).toEqual(["strategist"]);
    expect(result.findings.some((finding) => finding.rule === "ungrounded-role" && finding.role === "strategist")).toBe(true);
  });

  it("accepts every role the deterministic composition itself justifies", () => {
    const result = validateKitProposal({
      proposal: { problem: "Our words don't sound like us.", roles: [{ role: "writer", problemId: "writer-unapproved-copy", why: "writer job" }] },
      confirmedProblems,
      catalogue: CAPABILITY_CATALOGUE,
    });
    expect(result.state).toBe("valid");
    expect(result.removalCandidates).toEqual([]);
  });
});

describe("evidence tiers and the advisory preset floor", () => {
  it("ranks designed < qualified < proven", () => {
    expect(EVIDENCE_LEVELS).toEqual(["designed", "qualified", "proven"]);
    expect(evidenceAtLeast("proven", "qualified")).toBe(true);
    expect(evidenceAtLeast("designed", "qualified")).toBe(false);
  });

  it("flags exactly the preset roles with no solves claim at or above the qualified floor", () => {
    const presets = [{ id: "launch", roles: ["strategist", "writer", "designer", "publisher"] }];
    const findings = presetEvidenceFindings({ presets, catalogue: SYNTHETIC_CATALOGUE });
    expect(findings.every((finding) => finding.rule === "preset-role-below-evidence-floor")).toBe(true);
    // writer and designer are `qualified` in the synthetic catalogue; the others `designed`.
    expect(findings.map((finding) => finding.role).sort()).toEqual(["publisher", "strategist"]);
  });

  it("is advisory against the real presets: findings name only roles whose best claim is below the floor", () => {
    for (const finding of presetEvidenceFindings({ presets: KIT_PRESETS, catalogue: CAPABILITY_CATALOGUE })) {
      const role = CAPABILITY_CATALOGUE.roles.find((entry) => entry.role === finding.role)!;
      expect(role.solves.some((entry) => evidenceAtLeast(entry.evidence, "qualified"))).toBe(false);
    }
  });
});

describe("toEngagementBrief", () => {
  it("builds deliverables from each composed role's own boundary.owns", () => {
    const composed = composeKit({ selectedRoles: ["publisher"], catalogue: SYNTHETIC_CATALOGUE }) as Extract<ComposeKitResult, { state: "composed" }>;
    const brief = toEngagementBrief({ problem: "We're not sure what's actually live.", composed, catalogue: SYNTHETIC_CATALOGUE });
    expect(brief.schemaVersion).toBe(1);
    expect(brief.roles).toHaveLength(composed.roles.length);
    expect(brief.deliverables).toEqual(composed.sequence.map((role) => SYNTHETIC_CATALOGUE.roles.find((entry) => entry.role === role)?.boundary.owns));
  });
});
