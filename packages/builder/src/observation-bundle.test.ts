import { describe, expect, it } from "vitest";
import {
  OBSERVATION_BUNDLE_SCHEMA_VERSION,
  parseObservationBundle,
  validateObservationBundleShape,
  writeObservationBundle,
} from "./observation-bundle.js";
import type { ObservationBundleGateEntry, WriteObservationBundleInput } from "./observation-bundle.js";

function satisfiedGate(gateId: string): ObservationBundleGateEntry {
  return { gateId, result: { verdict: "satisfied", evaluated: 3 } };
}

function baseInput(): WriteObservationBundleInput {
  return {
    repository: { id: "example-org/example-app", ref: "a1b2c3d" },
    producedAt: "2026-08-18T12:00:00.000Z",
    gates: [satisfiedGate("secret-scan")],
  };
}

describe("writeObservationBundle", () => {
  it("serializes a well-formed bundle as JSON, carrying the schema version", () => {
    const serialized = writeObservationBundle(baseInput());
    const parsed = JSON.parse(serialized);
    expect(parsed.schemaVersion).toBe(OBSERVATION_BUNDLE_SCHEMA_VERSION);
    expect(parsed.repository).toEqual({ id: "example-org/example-app", ref: "a1b2c3d" });
    expect(parsed.producedAt).toBe("2026-08-18T12:00:00.000Z");
    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0]).toEqual({ gateId: "secret-scan", result: { verdict: "satisfied", evaluated: 3 } });
  });

  it("omits ref when not supplied, never writing an undefined placeholder", () => {
    const input = baseInput();
    const serialized = writeObservationBundle({ ...input, repository: { id: "example-org/example-app" } });
    const parsed = JSON.parse(serialized);
    expect("ref" in parsed.repository).toBe(false);
  });

  it("throws on an empty repository id -- caller error, not a reportable finding", () => {
    const input = baseInput();
    expect(() => writeObservationBundle({ ...input, repository: { id: "" } })).toThrow();
  });

  it("throws on zero gates -- a bundle that observed nothing is not a valid bundle", () => {
    const input = baseInput();
    expect(() => writeObservationBundle({ ...input, gates: [] })).toThrow();
  });

  it("throws on an unparseable producedAt", () => {
    const input = baseInput();
    expect(() => writeObservationBundle({ ...input, producedAt: "not-a-date" })).toThrow();
  });

  it("throws on a duplicate gateId within the same bundle", () => {
    const input = baseInput();
    expect(() =>
      writeObservationBundle({ ...input, gates: [satisfiedGate("secret-scan"), satisfiedGate("secret-scan")] }),
    ).toThrow();
  });

  it("never reads a clock -- calling twice with the same input produces byte-identical output", () => {
    const input = baseInput();
    expect(writeObservationBundle(input)).toBe(writeObservationBundle(input));
  });
});

describe("validateObservationBundleShape", () => {
  it("accepts a bundle written by writeObservationBundle with zero findings", () => {
    const serialized = writeObservationBundle(baseInput());
    expect(validateObservationBundleShape(JSON.parse(serialized))).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateObservationBundleShape(null).length).toBeGreaterThan(0);
    expect(validateObservationBundleShape("a bundle").length).toBeGreaterThan(0);
    expect(validateObservationBundleShape([1, 2, 3]).length).toBeGreaterThan(0);
  });

  it("rejects an unsupported schema version", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    const findings = validateObservationBundleShape({ ...bundle, schemaVersion: 99 });
    expect(findings.some((finding) => finding.rule === "observation-bundle/unsupported-schema-version")).toBe(true);
  });

  it("rejects a missing repository id", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    const findings = validateObservationBundleShape({ ...bundle, repository: {} });
    expect(findings.some((finding) => finding.rule === "observation-bundle/missing-repository-id")).toBe(true);
  });

  it("rejects a violated gate result with an empty findings array", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "violated", findings: [] } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-empty-findings")).toBe(true);
  });

  it("rejects a violated gate result whose findings array is not actually an array", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "violated", findings: "not-an-array" } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-empty-findings")).toBe(true);
  });

  it("rejects a violated gate result carrying a null in its findings array -- never silently typed as a Finding", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "violated", findings: [null] } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-invalid-finding")).toBe(true);
  });

  it("rejects a violated gate result carrying an empty object in its findings array", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "violated", findings: [{}] } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-invalid-finding")).toBe(true);
  });

  it("still flags a well-formed finding alongside a malformed one, rather than accepting the whole array on one good entry", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [
      {
        gateId: "release-readiness",
        result: {
          verdict: "violated",
          findings: [{ rule: "real/rule", severity: "high", message: "a real finding" }, null],
        },
      },
    ];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-invalid-finding")).toBe(true);
  });

  it("accepts a violated gate result whose findings are all well-formed", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [
      {
        gateId: "release-readiness",
        result: { verdict: "violated", findings: [{ rule: "real/rule", severity: "high", message: "a real finding" }] },
      },
    ];
    expect(validateObservationBundleShape(bundle)).toEqual([]);
  });

  it("never throws formatting a BigInt schemaVersion -- diagnostics must not crash validation", () => {
    // Constructed directly, not via JSON.parse/writeObservationBundle: JSON has no BigInt literal,
    // so this shape can only arise from a caller handing in-memory data (not wire-parsed JSON) --
    // exactly what `aggregateObservations` accepts (see its own module header).
    const bundle = { ...JSON.parse(writeObservationBundle(baseInput())), schemaVersion: 1n };
    let findings: ReturnType<typeof validateObservationBundleShape>;
    expect(() => {
      findings = validateObservationBundleShape(bundle);
    }).not.toThrow();
    expect(findings!.some((finding) => finding.rule === "observation-bundle/unsupported-schema-version")).toBe(true);
    expect(findings!.some((finding) => finding.message.includes("1n"))).toBe(true);
  });

  it("never throws formatting a BigInt in other raw-input diagnostics (evaluated, verdict)", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [
      { gateId: "a", result: { verdict: "satisfied", evaluated: 2n } },
      { gateId: "b", result: { verdict: 7n } },
    ];
    let findings: ReturnType<typeof validateObservationBundleShape>;
    expect(() => {
      findings = validateObservationBundleShape(bundle);
    }).not.toThrow();
    expect(findings!.some((finding) => finding.rule === "observation-bundle/gate-result-invalid-evaluated")).toBe(true);
    expect(findings!.some((finding) => finding.rule === "observation-bundle/gate-result-unknown-verdict")).toBe(true);
  });

  it("rejects an indeterminate gate result with no reason", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "indeterminate" } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-missing-reason")).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    bundle.gates = [{ gateId: "release-readiness", result: { verdict: "pending" } }];
    const findings = validateObservationBundleShape(bundle);
    expect(findings.some((finding) => finding.rule === "observation-bundle/gate-result-unknown-verdict")).toBe(true);
  });

  it("collects every finding at once, rather than stopping at the first", () => {
    const findings = validateObservationBundleShape({
      schemaVersion: 1,
      repository: {},
      producedAt: "not-a-date",
      gates: [],
    });
    const rules = findings.map((finding) => finding.rule);
    expect(rules).toContain("observation-bundle/missing-repository-id");
    expect(rules).toContain("observation-bundle/produced-at-unparseable");
    expect(rules).toContain("observation-bundle/empty-gates");
  });
});

describe("parseObservationBundle", () => {
  it("returns ok:true with the typed bundle for well-formed data", () => {
    const bundle = JSON.parse(writeObservationBundle(baseInput()));
    const parsed = parseObservationBundle(bundle);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bundle.repository.id).toBe("example-org/example-app");
    }
  });

  it("returns ok:false with findings for malformed data, never throwing", () => {
    const parsed = parseObservationBundle({ nonsense: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.findings.length).toBeGreaterThan(0);
    }
  });
});
