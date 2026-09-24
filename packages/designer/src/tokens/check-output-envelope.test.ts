import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateIdentityDirections, type IdentityTokenInput } from "./identity-kit.js";
import { identityKitReport, judgeIdentityKit } from "./identity-checks.js";

// docs/contracts/check-output-envelope.json (issue #1174/#1190) is the one
// shape every check command's JSON report uses across every role. This
// package carries no local copy of it: this test reads the contract file
// itself, at its one location, and checks REAL output from this package's
// own judgement (identityKitReport) against exactly what that file
// declares -- the same discipline
// packages/controller/src/loop/contract-sync.test.ts already applies to
// docs/contracts/loop.json. If the contract's own field list, required
// fields, or verdict vocabulary ever change, this test starts failing
// instead of silently drifting from it.
//
// Built with node:path's own `dirname`, not `new URL("../../../../", ...)`:
// this package's vitest config runs tests under jsdom (real React rendering
// elsewhere in this package), whose WHATWG URL implementation rejects a
// relative reference that walks this far above a `file:` base -- Node's own
// path resolution has no such restriction.
const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/check-output-envelope.json"), "utf8")) as {
  fields: readonly string[];
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  verdicts: readonly string[];
};

const PASSING_TOKENS: IdentityTokenInput = {
  ink: "oklch(0.2178 0 0)",
  onInverse: "oklch(0.9702 0 0)",
  surfaceBase: "oklch(0.9702 0 0)",
  surfaceInverse: "oklch(0.2178 0 0)",
  accent: "oklch(0.2178 0 0)",
  onAccent: "oklch(0.9702 0 0)",
  fontFamily: "system-ui, sans-serif",
};

const FAILING_TOKENS: IdentityTokenInput = {
  ...PASSING_TOKENS,
  ink: "oklch(0.9 0 0)",
  surfaceBase: "oklch(0.91 0 0)",
  onInverse: "oklch(0.5 0 0)",
  surfaceInverse: "oklch(0.52 0 0)",
  accent: "oklch(0.5 0 0)",
  onAccent: "oklch(0.51 0 0)",
};

function directionFor(tokens: IdentityTokenInput) {
  const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, tokens);
  if (!direction) throw new Error("generateIdentityDirections produced no direction");
  return direction;
}

describe("identityKitReport conforms to docs/contracts/check-output-envelope.json", () => {
  it("declares this package's own verdict vocabulary as exactly the contract's verdicts, in the same order", () => {
    const observedVerdicts = [
      judgeIdentityKit(directionFor(PASSING_TOKENS), PASSING_TOKENS).verdict,
      judgeIdentityKit(directionFor(FAILING_TOKENS), FAILING_TOKENS).verdict,
      judgeIdentityKit(directionFor(PASSING_TOKENS), { ...PASSING_TOKENS, ink: "not-a-colour" }).verdict,
    ];
    expect(new Set(observedVerdicts)).toEqual(new Set(contract.verdicts));
  });

  it("a satisfied report carries exactly the contract's required fields, no local extras beyond its declared optional ones", () => {
    const report = identityKitReport(directionFor(PASSING_TOKENS), PASSING_TOKENS, "0.5.0");
    for (const field of contract.requiredFields) expect(report).toHaveProperty(field);
    const extraKeys = Object.keys(report).filter((key) => !contract.fields.includes(key));
    expect(extraKeys).toEqual([]);
    expect(report.verdict).toBe("satisfied");
    expect(report.findings).toEqual([]);
  });

  it("summary is exactly one plain-language sentence, the rule the contract requires", () => {
    for (const report of [
      identityKitReport(directionFor(PASSING_TOKENS), PASSING_TOKENS, "0.5.0"),
      identityKitReport(directionFor(FAILING_TOKENS), FAILING_TOKENS, "0.5.0"),
      identityKitReport(directionFor(PASSING_TOKENS), { ...PASSING_TOKENS, ink: "not-a-colour" }, "0.5.0"),
    ]) {
      expect(typeof report.summary).toBe("string");
      const sentenceCount = report.summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      expect(sentenceCount).toBe(1);
    }
  });

  it("a non-satisfied verdict always carries at least one finding, and finding severity is a value the contract allows", () => {
    for (const report of [
      identityKitReport(directionFor(FAILING_TOKENS), FAILING_TOKENS, "0.5.0"),
      identityKitReport(directionFor(PASSING_TOKENS), { ...PASSING_TOKENS, ink: "not-a-colour" }, "0.5.0"),
    ]) {
      expect(report.verdict).not.toBe("satisfied");
      expect(report.findings.length).toBeGreaterThan(0);
      for (const finding of report.findings) {
        expect(typeof finding.rule).toBe("string");
        expect(["error", "warning"]).toContain(finding.severity);
        expect(typeof finding.message).toBe("string");
        expect(finding.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries a nextAction whenever the verdict is not satisfied, as the contract's own optionalFields allow", () => {
    expect(contract.optionalFields).toContain("nextAction");
    const violated = identityKitReport(directionFor(FAILING_TOKENS), FAILING_TOKENS, "0.5.0");
    const indeterminate = identityKitReport(directionFor(PASSING_TOKENS), { ...PASSING_TOKENS, ink: "not-a-colour" }, "0.5.0");
    expect(typeof violated.nextAction).toBe("string");
    expect(typeof indeterminate.nextAction).toBe("string");
  });

  it("package and version are exact, non-empty strings", () => {
    const report = identityKitReport(directionFor(PASSING_TOKENS), PASSING_TOKENS, "0.5.0");
    expect(report.package).toBe("@clossys/designer");
    expect(report.version).toBe("0.5.0");
  });
});
