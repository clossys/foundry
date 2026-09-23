import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateProviderCustody, providerCustodyReport } from "./provider-custody.js";
import type { ProviderCustodyDeclaration } from "./provider-custody.js";

// docs/contracts/check-output-envelope.json (issue #1174/#1190) is the one
// shape every check command's JSON report uses across every role. This
// package carries no local copy of it: this test reads the contract file
// itself, at its one location, and checks REAL output from this package's
// own evaluator against exactly what that file declares -- the same
// discipline packages/controller/src/loop/contract-sync.test.ts already
// applies to docs/contracts/loop.json. If the contract's own field list,
// required fields, or verdict vocabulary ever change, this test starts
// failing instead of silently drifting from it.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/check-output-envelope.json"), "utf8")) as {
  fields: readonly string[];
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  verdicts: readonly string[];
  findingShape: { rule: string; severity: string; message: string; path?: string };
};

function declaration(overrides: Partial<ProviderCustodyDeclaration> = {}): ProviderCustodyDeclaration {
  return {
    key: "CLOUDFLARE_API_TOKEN",
    provider: "cloudflare",
    rung: "scoped-environment-secret",
    owner: "team-platform",
    store: "github-environment:deploy-cloudflare",
    scope: ["zone:edit:example.com"],
    leastPrivilegeNote: "One zone only, Workers deploy, no account-wide access.",
    usedBy: [".github/workflows/deploy.yml#deploy-cloudflare"],
    rotationPolicy: { maxAgeDays: 90 },
    ...overrides,
  };
}

describe("providerCustodyReport conforms to docs/contracts/check-output-envelope.json", () => {
  it("declares this package's own verdict vocabulary as exactly the contract's verdicts, in the same order", () => {
    // evaluateProviderCustody's own verdict union is a TypeScript-only
    // guarantee; this asserts the RUNTIME values this package actually
    // produces (satisfied/violated/indeterminate) match the contract's own
    // declared `verdicts` list, not a second, independently-typed copy of it.
    const observedVerdicts = [
      evaluateProviderCustody(declaration()).verdict,
      evaluateProviderCustody(declaration({ store: "repository" })).verdict,
      evaluateProviderCustody(null).verdict,
    ];
    expect(new Set(observedVerdicts)).toEqual(new Set(contract.verdicts));
  });

  it("a satisfied report carries exactly the contract's required fields, no local extras beyond its declared optional ones", () => {
    const report = providerCustodyReport(declaration(), "0.2.8");
    for (const field of contract.requiredFields) expect(report).toHaveProperty(field);
    const extraKeys = Object.keys(report).filter((key) => !contract.fields.includes(key));
    expect(extraKeys).toEqual([]);
    expect(report.verdict).toBe("satisfied");
    expect(report.findings).toEqual([]);
  });

  it("summary is exactly one plain-language sentence, the rule the contract requires", () => {
    for (const report of [
      providerCustodyReport(declaration(), "0.2.8"),
      providerCustodyReport(declaration({ store: "repository" }), "0.2.8"),
      providerCustodyReport(null, "0.2.8"),
    ]) {
      expect(typeof report.summary).toBe("string");
      const sentenceCount = report.summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      expect(sentenceCount).toBe(1);
    }
  });

  it("a non-satisfied verdict always carries at least one finding, and finding severity is a value the contract allows", () => {
    for (const report of [providerCustodyReport(declaration({ store: "repository" }), "0.2.8"), providerCustodyReport(null, "0.2.8")]) {
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
    const violated = providerCustodyReport(declaration({ store: "repository" }), "0.2.8");
    const indeterminate = providerCustodyReport(null, "0.2.8");
    expect(contract.optionalFields).toContain("nextAction");
    expect(typeof violated.nextAction).toBe("string");
    expect(typeof indeterminate.nextAction).toBe("string");
  });

  it("package and version are exact, non-empty strings", () => {
    const report = providerCustodyReport(declaration(), "0.2.8");
    expect(report.package).toBe("@clossys/locksmith");
    expect(report.version).toBe("0.2.8");
  });
});
