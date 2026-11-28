import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCheck } from "./owned-rules.js";

// The same inputs the release qualification adapter runs against the packed bin.
const fixtures = new URL("../../../governance/release-qualification-fixtures/developer/current-direct/", import.meta.url);
const at = (name: string): string => fileURLToPath(new URL(name, fixtures));
const run = (...argv: string[]) => {
  const { stdout, exitCode } = runCheck(argv);
  return { exitCode, envelope: JSON.parse(stdout) as { verdict: string; findings: Array<{ rule: string; message: string }> } };
};

describe("developer-check", () => {
  it("exits 0 when the skill lists exactly the rules the registry gives developer", () => {
    const { exitCode, envelope } = run(at("registry.json"), "--skill", at("skill-match.md"));
    expect(exitCode).toBe(0);
    expect(envelope.verdict).toBe("satisfied");
    expect(envelope.findings).toEqual([]);
  });

  it("exits 1 naming each owned rule the skill does not list", () => {
    const { exitCode, envelope } = run(at("registry.json"), "--skill", at("skill-missing.md"));
    expect(exitCode).toBe(1);
    expect(envelope.findings.map((item) => item.rule)).toEqual(["missing-rule"]);
    expect(envelope.findings[0]?.message).toContain("R-FIXTURE-OWNED");
  });

  it("exits 1 naming each listed rule the registry gives another agent", () => {
    const { exitCode, envelope } = run(at("registry.json"), "--skill", at("skill-extra.md"));
    expect(exitCode).toBe(1);
    expect(envelope.findings.map((item) => item.rule)).toEqual(["extra-rule"]);
    expect(envelope.findings[0]?.message).toContain("R-FIXTURE-OTHER");
  });

  it("exits 2 on a read or usage error", () => {
    for (const argv of [
      [at("registry-malformed.json"), "--skill", at("skill-match.md")],
      [at("registry.json"), "--skill", at("no-such-skill.md")],
      [at("registry.json"), "--skill"],
      [at("registry.json"), at("registry.json")],
    ]) {
      const { exitCode, envelope } = run(...argv);
      expect(exitCode).toBe(2);
      expect(envelope.findings.map((item) => item.rule)).toEqual(["unreadable-input"]);
    }
  });

  it("passes on this repository's rule registry and the shipped skill", () => {
    expect(run(fileURLToPath(new URL("../../../scripts/rules/registry.json", import.meta.url))).exitCode).toBe(0);
  });

  it("prints usage for --help and exits 0", () => {
    expect(runCheck(["--help"])).toEqual({ stdout: expect.stringContaining("Usage: developer-check"), exitCode: 0 });
  });
});
