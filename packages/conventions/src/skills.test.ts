import { describe, expect, it } from "vitest";
import { SKILL_VERBS, validateSkillName, validateSkillSet } from "./skills.js";

const options = { prefixes: ["ex", "acme"] } as const;

describe("validateSkillName", () => {
  it("accepts a conforming name", () => {
    expect(validateSkillName("ex-audit-dependencies", options)).toEqual([]);
  });

  it("requires an owner, a verb, and a subject", () => {
    const findings = validateSkillName("ex-audit", options);
    expect(findings.map((f) => f.rule)).toContain("skill/malformed");
  });

  it("rejects an unregistered prefix", () => {
    const findings = validateSkillName("zz-audit-dependencies", options);
    expect(findings.map((f) => f.rule)).toContain("skill/unregistered-prefix");
  });

  it("rejects a verb outside the closed vocabulary", () => {
    const findings = validateSkillName("ex-check-dependencies", options);
    expect(findings.map((f) => f.rule)).toContain("skill/unknown-verb");
    expect(SKILL_VERBS).not.toContain("check");
  });

  it("reports a directory that has drifted from the skill name", () => {
    const findings = validateSkillName("ex-audit-dependencies", options, "ex-audit-deps");
    expect(findings.map((f) => f.rule)).toContain("skill/directory-mismatch");
  });

  it("reports a prefix that collides with a provider namespace", () => {
    const findings = validateSkillName("ex-audit-dependencies", {
      ...options,
      reservedNamespaces: ["ex"],
    });
    expect(findings.map((f) => f.rule)).toContain("skill/prefix-collision");
  });

  // Renaming a vendor's skill to fit a local grammar forks it.
  it("leaves a third-party skill alone", () => {
    expect(
      validateSkillName("vendor-thing", { ...options, thirdParty: ["vendor-thing"] }),
    ).toEqual([]);
  });

  it("rejects a segment that is not lowercase alphanumeric", () => {
    const findings = validateSkillName("ex-audit-Dependencies", options);
    expect(findings.map((f) => f.rule)).toContain("skill/malformed-segment");
  });

  it("accepts a multi-word subject", () => {
    expect(validateSkillName("acme-review-watched-protocols", options)).toEqual([]);
  });

  it("includes proven expand and groom verbs", () => {
    expect(validateSkillName("ex-expand-read-set", options)).toEqual([]);
    expect(validateSkillName("ex-groom-backlog", options)).toEqual([]);
    expect(SKILL_VERBS).toContain("expand");
    expect(SKILL_VERBS).toContain("groom");
  });
});

describe("validateSkillSet", () => {
  it("reports a duplicate name", () => {
    const findings = validateSkillSet(["ex-audit-dependencies", "ex-audit-dependencies"], options);
    expect(findings.map((f) => f.rule)).toContain("skill/duplicate");
  });

  it("passes a clean set", () => {
    expect(validateSkillSet(["ex-audit-dependencies", "acme-clean-worktrees"], options)).toEqual([]);
  });
});
