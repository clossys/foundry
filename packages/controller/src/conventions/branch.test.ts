import { describe, expect, it } from "vitest";
import { branchExemptionsFromProfile, validateBranchName } from "./branch.js";
import type { RepositoryProfile } from "../repository/types.js";

const agents = ["codex", "claude"] as const;

describe("validateBranchName", () => {
  it("accepts a conforming agent branch", () => {
    expect(validateBranchName("claude/extract-agent-governance", { agents })).toEqual([]);
  });

  it("rejects a name with no provenance segment", () => {
    const findings = validateBranchName("extract-governance", { agents });
    expect(findings.map((f) => f.rule)).toEqual(["branch/missing-provenance"]);
  });

  it("names taxonomy prefixes specifically, because that is the common mistake", () => {
    for (const name of ["feat/thing", "fix/thing", "chore/thing", "task/thing", "agent/thing"]) {
      const findings = validateBranchName(name, { agents });
      expect(findings.map((f) => f.rule), name).toContain("branch/taxonomy-prefix");
    }
  });

  it("distinguishes an unknown prefix from a taxonomy prefix", () => {
    const findings = validateBranchName("devin/thing", { agents });
    expect(findings.map((f) => f.rule)).toContain("branch/unknown-prefix");
  });

  // A hand-passed list still exempts, so existing callers keep working, but
  // it no longer passes silently: nothing can check it against the repository
  // it claims to describe, and that is now said out loud (issue #929).
  it("honors a hand-passed exemption but reports that it was never derived from a profile", () => {
    const findings = validateBranchName("main", { agents, exempt: ["main"] });
    expect(findings.map((f) => f.rule)).toEqual(["branch/underived-exemption"]);
    expect(findings[0]?.severity).toBe("medium");
  });

  it("reports a slug that is not lowercase kebab case", () => {
    const findings = validateBranchName("claude/Extract_Thing", { agents });
    expect(findings.map((f) => f.rule)).toContain("branch/malformed-slug");
  });

  it("reports an empty slug", () => {
    const findings = validateBranchName("claude/", { agents });
    expect(findings.map((f) => f.rule)).toContain("branch/empty-slug");
  });

  // A check that passes because it was handed nothing to check is worse than no
  // check: it produces a green result that means nothing.
  it("refuses to pass vacuously when no agents are declared", () => {
    const findings = validateBranchName("anything/at-all", { agents: [] });
    expect(findings.map((f) => f.rule)).toEqual(["branch/no-agents-declared"]);
  });

  it("rejects a malformed declared prefix", () => {
    const findings = validateBranchName("claude/thing", { agents: ["Claude"] });
    expect(findings.map((f) => f.rule)).toContain("branch/invalid-agent-prefix");
  });

  it("keeps a slug containing slashes out of the prefix comparison", () => {
    expect(validateBranchName("claude/extract/nested", { agents }).map((f) => f.rule)).toEqual([
      "branch/malformed-slug",
    ]);
  });
});

// The live hazard issue #929 names: `exempt` was a caller-supplied list, so a
// repository could exempt a branch it had never declared anywhere. The
// exemption and the topology could not be cross-checked because only one of
// them existed as data. Now both do, and the profile is the authority.
describe("branch exemptions derived from the repository profile", () => {
  const base = {
    schemaVersion: 3,
    commands: [],
    protectedPaths: [],
    requirements: [],
    rootEntries: [],
  } as const;
  const twoBranches = { ...base, defaultBranch: "main", releaseBranch: "release" } as RepositoryProfile;
  const oneBranch = { ...base, defaultBranch: "main" } as RepositoryProfile;

  it("derives both long-lived branches from a profile that declares them", () => {
    expect(branchExemptionsFromProfile(twoBranches)).toEqual(["main", "release"]);
  });

  it("derives only the default branch from a profile with no release branch", () => {
    expect(branchExemptionsFromProfile(oneBranch)).toEqual(["main"]);
  });

  it("derives no exemption from a malformed releaseBranch, leaving that report to the profile validator", () => {
    for (const releaseBranch of ["", 7, null, undefined]) {
      expect(branchExemptionsFromProfile({ ...base, defaultBranch: "main", releaseBranch } as unknown as RepositoryProfile)).toEqual([
        "main",
      ]);
    }
  });

  it("exempts a declared release branch with no caller-supplied list at all", () => {
    expect(validateBranchName("release", { agents, profile: twoBranches })).toEqual([]);
    expect(validateBranchName("main", { agents, profile: twoBranches })).toEqual([]);
  });

  // The point of the change: the profile-derived set is authoritative. An
  // entry only the caller believes in is reported AND does not take effect --
  // reporting it and honoring it anyway would leave the hazard exactly where
  // it was, with a finding next to it.
  it("refuses to exempt a branch the profile does not declare, and says so", () => {
    const findings = validateBranchName("release", { agents, profile: oneBranch, exempt: ["release"] });
    expect(findings.map((f) => f.rule)).toEqual(["branch/undeclared-exemption", "branch/missing-provenance"]);
    expect(findings[0]?.message).toContain("release");
  });

  it("reports an undeclared exemption even when the branch under test is a declared one", () => {
    const findings = validateBranchName("main", { agents, profile: oneBranch, exempt: ["main", "release"] });
    expect(findings.map((f) => f.rule)).toEqual(["branch/undeclared-exemption"]);
  });

  it("keeps an undeclared exemption visible alongside a vacuous-check finding", () => {
    const findings = validateBranchName("anything/at-all", { agents: [], profile: oneBranch, exempt: ["release"] });
    expect(findings.map((f) => f.rule)).toEqual(["branch/undeclared-exemption", "branch/no-agents-declared"]);
  });
});
