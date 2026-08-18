import { describe, expect, it } from "vitest";
import { assertNeverVacuouslySatisfied, gateResultToExitCode } from "@vespeneventures/controller/gates";
import { checkSecretScan } from "./secret-scan.js";
import type { SecretScanObservation } from "./secret-scan.js";

/** A complete, clean, believable scan record. Each test breaks exactly one thing. */
function cleanScan(overrides: Partial<SecretScanObservation> = {}): SecretScanObservation {
  return {
    attempted: true,
    toolName: "example-scanner",
    toolVersion: "8.30.1",
    exitCode: 0,
    scope: "full-history",
    unitsScanned: 412,
    hits: [],
    ...overrides,
  };
}

describe("checkSecretScan", () => {
  it("is satisfied for a completed, self-consistent, non-empty clean scan", () => {
    const result = checkSecretScan(cleanScan());
    expect(result).toMatchObject({ verdict: "satisfied", evaluated: 412 });
    expect(gateResultToExitCode(result)).toBe(0);
  });

  it("is violated when the scanner reported a hit", () => {
    const result = checkSecretScan(
      cleanScan({ exitCode: 1, hits: [{ ruleId: "generic-api-key", path: "src/config.ts", commit: "abc123" }] }),
    );
    expect(result.verdict).toBe("violated");
    expect(gateResultToExitCode(result)).toBe(1);
    if (result.verdict !== "violated") throw new Error("unreachable");
    expect(result.findings[0]).toMatchObject({ rule: "secret-detected", path: "src/config.ts" });
    expect(result.findings[0]?.message).toContain("generic-api-key");
  });

  it("is indeterminate when no record was supplied at all", () => {
    const result = checkSecretScan(undefined);
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "no-observation-supplied" });
    expect(gateResultToExitCode(result)).toBe(2);
  });

  it("is indeterminate — never satisfied — when the scanner never ran", () => {
    // The exact failure that motivated this package: a wrapped tool that
    // stops running for an account-level reason, while the surrounding gate
    // keeps reporting green because it saw no findings.
    const result = checkSecretScan(cleanScan({ attempted: false, exitCode: undefined, unitsScanned: undefined }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "scan-not-attempted" });
    expect(gateResultToExitCode(result)).toBe(2);
  });

  it.each([
    ["a tool that does not name itself", { toolName: undefined }],
    ["a tool that cannot report its version", { toolVersion: undefined }],
  ])("is indeterminate for %s", (_label, overrides) => {
    const result = checkSecretScan(cleanScan(overrides));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "tool-unidentified" });
  });

  it("is indeterminate when the tool produced no usable exit status", () => {
    const result = checkSecretScan(cleanScan({ exitCode: undefined }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "tool-outcome-unknown" });
  });

  it("is indeterminate when the tool errored rather than answered", () => {
    const result = checkSecretScan(cleanScan({ exitCode: 127 }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "tool-errored" });
  });

  it("honours a caller's own exit-code convention", () => {
    const result = checkSecretScan(cleanScan({ exitCode: 8 }), { cleanExitCode: 8, findingsExitCode: 9 });
    expect(result.verdict).toBe("satisfied");
  });

  it.each([
    ["findings signalled but none reported", { exitCode: 1, hits: [] }],
    [
      "a clean signal alongside reported hits",
      { exitCode: 0, hits: [{ ruleId: "r", path: "p" }] },
    ],
  ])("is indeterminate for a self-contradicting record: %s", (_label, overrides) => {
    const result = checkSecretScan(cleanScan(overrides));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "inconsistent-report" });
  });

  it("is indeterminate when a clean run does not say what it covered", () => {
    const result = checkSecretScan(cleanScan({ scope: undefined }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "scope-undeclared" });
  });

  it.each([undefined, 0, -1, 1.5])("is indeterminate for a clean run over %s units", (unitsScanned) => {
    const result = checkSecretScan(cleanScan({ unitsScanned: unitsScanned as number | undefined }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "empty-scan-scope" });
  });

  // A hit list arrives as parsed JSON, so `Array.isArray` is not the same
  // question as "every entry is a hit". Each of these threw before.
  it.each([[null], [42], ["a-string"], [[]]])("is indeterminate for a malformed hit entry %s", (hit) => {
    const result = checkSecretScan(cleanScan({ exitCode: 1, hits: [hit] as unknown as SecretScanObservation["hits"] }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "inconsistent-report" });
    expect(gateResultToExitCode(result)).toBe(2);
  });

  it.each([[null], [42], ["a-string"], [[]]])("is indeterminate when the record itself is %s", (record) => {
    const result = checkSecretScan(record as unknown as SecretScanObservation);
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "no-observation-supplied" });
    expect(gateResultToExitCode(result)).toBe(2);
  });

  it("still evaluates when the exit-code policy itself is unusable", () => {
    const result = checkSecretScan(cleanScan(), null as unknown as undefined);
    expect(result).toMatchObject({ verdict: "satisfied" });
  });

  it("renders no scanner-supplied prose into a finding message", () => {
    // The message reaches a job summary and a report artifact. On a public
    // repository that is as public as a commit, so nothing a scanner wrote
    // may travel into it — only the structural fields a secret cannot hide in.
    const result = checkSecretScan(
      cleanScan({
        exitCode: 1,
        hits: [
          { ruleId: "generic-api-key", path: "src/config.ts", description: "leaked-value-abc123" } as unknown as {
            ruleId: string;
            path: string;
          },
        ],
      }),
    );
    if (result.verdict !== "violated") throw new Error("expected violated");
    expect(result.findings[0]?.message).not.toContain("leaked-value-abc123");
    expect(result.findings[0]?.message).toContain("generic-api-key");
  });

  it("never reports satisfied on a path that evaluated nothing", () => {
    // #256's meta-check, applied to this gate's own real function.
    assertNeverVacuouslySatisfied((observation: SecretScanObservation | undefined) => checkSecretScan(observation), undefined);
    assertNeverVacuouslySatisfied(
      (observation: SecretScanObservation | undefined) => checkSecretScan(observation),
      cleanScan({ attempted: false }),
    );
    assertNeverVacuouslySatisfied(
      (observation: SecretScanObservation | undefined) => checkSecretScan(observation),
      cleanScan({ unitsScanned: 0 }),
    );
  });
});
