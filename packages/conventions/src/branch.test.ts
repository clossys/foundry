import { describe, expect, it } from "vitest";
import { validateBranchName } from "./branch.js";

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

  it("exempts a repository's own long-lived branches", () => {
    expect(validateBranchName("main", { agents, exempt: ["main"] })).toEqual([]);
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
