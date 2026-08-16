import { describe, expect, it } from "vitest";
import { GATE_VERBS, validateGateName, validateGateSet } from "./gates.js";

describe("validateGateName", () => {
  // The shipped default document's own vocabulary -- see documents/gate-naming.md.
  // Adopting it verbatim must validate; so must any other conforming name, which
  // is exactly why this package never enforces the five back.
  it.each([
    "scan-secrets",
    "check-task-record",
    "verify-review-evidence",
    "detect-policy-drift",
    "verify-repository",
  ])("accepts the canonical default name %s", (name) => {
    expect(validateGateName(name)).toEqual([]);
  });

  it("accepts a conforming name outside the default vocabulary", () => {
    expect(validateGateName("build-example-package")).toEqual([]);
  });

  // Today's real-world gate names, generalized with placeholder subjects
  // rather than the real tool and account names they were drawn from.
  it("rejects a bare verb with no noun", () => {
    const findings = validateGateName("verify");
    expect(findings.map((f) => f.rule)).toContain("gate/malformed");
  });

  it("rejects a bare tool name", () => {
    const findings = validateGateName("exampletool");
    expect(findings.map((f) => f.rule)).toContain("gate/malformed");
  });

  it("rejects a noun-noun name whose first segment is not a verb", () => {
    const findings = validateGateName("task-record");
    expect(findings.map((f) => f.rule)).toContain("gate/unrecognized-verb");
  });

  it("rejects a bare noun", () => {
    const findings = validateGateName("drift");
    expect(findings.map((f) => f.rule)).toContain("gate/malformed");
  });

  it("rejects a capitalized, spaced name", () => {
    const findings = validateGateName("Task-record contract");
    expect(findings.map((f) => f.rule)).toContain("gate/uppercase");
    expect(findings.map((f) => f.rule)).toContain("gate/whitespace");
  });

  it("rejects prose with commas and spaces", () => {
    const findings = validateGateName("typecheck, pack validation, tests, and build");
    expect(findings.map((f) => f.rule)).toContain("gate/whitespace");
    expect(findings.map((f) => f.rule)).toContain("gate/comma");
  });

  // No account or repository prefix. A prefix reads as an unrecognized first
  // segment because it is not a verb -- the same grammar that rejects a tool
  // name rejects a namespace, without this package needing to know what any
  // account calls itself.
  it("rejects an account-style prefix", () => {
    const findings = validateGateName("acme-verify-review-evidence");
    expect(findings.map((f) => f.rule)).toContain("gate/unrecognized-verb");
  });

  it("rejects a repository-style prefix", () => {
    const findings = validateGateName("widget-scan-secrets");
    expect(findings.map((f) => f.rule)).toContain("gate/unrecognized-verb");
  });

  // A third segment must narrow the second, not restate it.
  it("rejects a tautological third segment", () => {
    const findings = validateGateName("scan-secrets-leaks");
    expect(findings.map((f) => f.rule)).toContain("gate/tautological-noun");
  });

  it("leaves a genuinely disambiguating third segment alone", () => {
    expect(validateGateName("verify-review-evidence")).toEqual([]);
  });

  it("rejects a literally repeated noun segment", () => {
    const findings = validateGateName("check-task-task");
    expect(findings.map((f) => f.rule)).toContain("gate/tautological-noun");
  });

  it("rejects leading, trailing, and doubled hyphens", () => {
    expect(validateGateName("-scan-secrets").map((f) => f.rule)).toContain("gate/edge-hyphen");
    expect(validateGateName("scan-secrets-").map((f) => f.rule)).toContain("gate/edge-hyphen");
    expect(validateGateName("scan--secrets").map((f) => f.rule)).toContain("gate/consecutive-hyphens");
  });

  it("rejects an underscore and other characters outside the kebab alphabet", () => {
    const findings = validateGateName("scan_secrets");
    expect(findings.map((f) => f.rule)).toContain("gate/invalid-character");
  });

  it("accepts an extended verb vocabulary supplied by the caller", () => {
    expect(validateGateName("propagate-config-drift", { verbs: [...GATE_VERBS, "propagate"] })).toEqual([]);
  });

  it("still rejects an unrecognized verb when the caller supplies no extension", () => {
    const findings = validateGateName("propagate-config-drift");
    expect(findings.map((f) => f.rule)).toContain("gate/unrecognized-verb");
  });

  // Adversarial input: non-string values a hostile or merely buggy caller
  // might hand in from parsed JSON, an API response, or a spread accident.
  it.each([
    [42, "a number"],
    [null, "null"],
    [undefined, "undefined"],
    [{}, "a plain object"],
    [["scan-secrets"], "an array"],
  ])("treats %s (%s) as empty rather than throwing", (value) => {
    expect(() => validateGateName(value as unknown as string)).not.toThrow();
    expect(validateGateName(value as unknown as string).map((f) => f.rule)).toEqual(["gate/empty"]);
  });

  // Adversarial input: a name built from prototype-pollution-flavored
  // segments. Nothing in this validator does a keyed property lookup on the
  // name it is given, so these are just ordinary bad strings to it.
  it.each(["proto-scan", "constructor-verify", "prototype-audit"])(
    "treats %s as an ordinary unrecognized-verb name, not a special key",
    (name) => {
      const findings = validateGateName(name);
      expect(findings.map((f) => f.rule)).toContain("gate/unrecognized-verb");
    },
  );

  it("is unaffected by pollution of Object.prototype", () => {
    // eslint-disable-next-line no-extend-native
    Object.defineProperty(Object.prototype, "zzGatePolluted", {
      value: "scan-secrets",
      configurable: true,
    });
    try {
      expect(validateGateName("scan-secrets")).toEqual([]);
      expect(validateGateName("task-record").map((f) => f.rule)).toContain("gate/unrecognized-verb");
    } finally {
      delete (Object.prototype as Record<string, unknown>).zzGatePolluted;
    }
  });
});

describe("validateGateSet", () => {
  it("passes a clean set", () => {
    expect(validateGateSet(["scan-secrets", "check-task-record", "verify-repository"])).toEqual([]);
  });

  it("reports a duplicate name", () => {
    const findings = validateGateSet(["scan-secrets", "scan-secrets"]);
    expect(findings.map((f) => f.rule)).toContain("gate/duplicate");
  });

  it("reports every conforming and non-conforming name in one pass", () => {
    const findings = validateGateSet(["scan-secrets", "task-record"]);
    expect(findings.map((f) => f.rule)).toEqual(["gate/unrecognized-verb"]);
  });

  // Adversarial input: a sparse array, as could arise from `new Array(n)` or
  // a `delete` on an array element. Holes iterate as `undefined` rather than
  // being silently skipped, so each hole is reported rather than vanishing.
  it("handles a sparse array without throwing, reporting each hole as empty", () => {
    const sparse: string[] = [];
    sparse[2] = "scan-secrets";
    expect(sparse.length).toBe(3);

    expect(() => validateGateSet(sparse)).not.toThrow();
    const findings = validateGateSet(sparse);
    expect(findings.filter((f) => f.rule === "gate/empty")).toHaveLength(2);
    expect(findings.some((f) => f.rule === "gate/unrecognized-verb" || f.rule === "gate/malformed")).toBe(false);
  });

  it("does not let a __proto__-named entry corrupt duplicate tracking for later entries", () => {
    const findings = validateGateSet(["__proto__", "__proto__", "scan-secrets"]);
    expect(findings.filter((f) => f.rule === "gate/duplicate")).toHaveLength(1);
    expect(findings.some((f) => f.rule === "gate/invalid-character")).toBe(true);
  });
});
