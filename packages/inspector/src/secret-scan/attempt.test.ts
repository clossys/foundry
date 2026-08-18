import { describe, expect, it } from "vitest";
import { attemptGitleaksScan } from "./attempt.js";
import type { GitleaksExecutor } from "./attempt.js";
import { checkSecretScan } from "../secret-scan.js";

/**
 * Hermetic on purpose: every test here injects `execute` rather than
 * spawning a real process, per this package's hermetic-tests rule (see the
 * vitest config header and #283). `defaultGitleaksExecutor` — the one export
 * from `./attempt.ts` that does real I/O — is exercised nowhere in this
 * file, the same way `bin.ts`'s real `CliPort` is thin, untested glue and
 * `cli.ts`'s logic underneath it is what carries the test suite.
 */
describe("attemptGitleaksScan", () => {
  it("builds a clean observation from a clean gitleaks run, and the judge reports it satisfied", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 0, report: [] });
    const observation = attemptGitleaksScan({
      binaryPath: "/opt/gitleaks/gitleaks",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 42,
      args: ["detect", "--source", "."],
      execute,
    });
    expect(observation).toEqual({
      attempted: true,
      toolName: "gitleaks",
      toolVersion: "8.30.1",
      exitCode: 0,
      scope: "working-tree",
      unitsScanned: 42,
      hits: [],
    });
    // The point of this module: what it produces is not merely a shape that
    // looks right, it is a real, satisfied verdict from the judge.
    expect(checkSecretScan(observation).verdict).toBe("satisfied");
  });

  it("translates gitleaks' report shape into SecretScanHit, and the judge reports it violated", () => {
    const execute: GitleaksExecutor = () => ({
      exitCode: 1,
      report: [{ RuleID: "aws-access-key", File: "src/config.ts", Commit: "abc123" }],
    });
    const observation = attemptGitleaksScan({
      binaryPath: "/opt/gitleaks/gitleaks",
      toolVersion: "8.30.1",
      scope: "full-history",
      unitsScanned: 100,
      args: [],
      execute,
    });
    expect(observation.hits).toEqual([{ ruleId: "aws-access-key", path: "src/config.ts", commit: "abc123" }]);
    expect(checkSecretScan(observation).verdict).toBe("violated");
  });

  it("skips a report entry that is not an object rather than throwing", () => {
    const execute: GitleaksExecutor = () => ({
      exitCode: 1,
      report: [null, "not an object", 42, { RuleID: "x", File: "y" }],
    });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 1,
      args: [],
      execute,
    });
    expect(observation.hits).toHaveLength(1);
  });

  it("falls back to unnamed-rule and an unreported path when gitleaks omits them", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 1, report: [{}] });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 1,
      args: [],
      execute,
    });
    expect(observation.hits).toEqual([{ ruleId: "unnamed-rule", path: "<unreported path>" }]);
  });

  it("omits commit when gitleaks did not report one, rather than writing an empty string", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 1, report: [{ RuleID: "x", File: "y" }] });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 1,
      args: [],
      execute,
    });
    expect(observation.hits[0]).not.toHaveProperty("commit");
  });

  it("treats a non-array report as no hits, rather than throwing", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 0, report: undefined });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 1,
      args: [],
      execute,
    });
    expect(observation.hits).toEqual([]);
  });

  it("always reports attempted: true, since being called at all means the binary was invoked", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 0, report: [] });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "1.0.0",
      scope: "commit-range",
      unitsScanned: 3,
      args: [],
      execute,
    });
    expect(observation.attempted).toBe(true);
  });

  it("carries the executor's exit code through untouched, including one the judge will reject as a tool error", () => {
    const execute: GitleaksExecutor = () => ({ exitCode: 17, report: [] });
    const observation = attemptGitleaksScan({
      binaryPath: "/x",
      toolVersion: "8.30.1",
      scope: "working-tree",
      unitsScanned: 1,
      args: [],
      execute,
    });
    expect(observation.exitCode).toBe(17);
    const result = checkSecretScan(observation);
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") expect(result.reason).toBe("tool-errored");
  });
});
