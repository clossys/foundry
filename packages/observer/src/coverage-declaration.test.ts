import { describe, expect, it } from "vitest";
import {
  COVERAGE_DECLARATION_SCHEMA_VERSION,
  parseCoverageDeclaration,
  validateCoverageDeclarationShape,
  writeCoverageDeclaration,
} from "./coverage-declaration.js";

const validRaw = {
  schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
  repository: "example-repository-id",
  declaredAbsences: [{ package: "@clossys/observer", reason: "this repository ships no telemetry lane" }],
};

describe("validateCoverageDeclarationShape", () => {
  it("accepts a well-formed declaration with findings empty", () => {
    expect(validateCoverageDeclarationShape(validRaw)).toEqual([]);
  });

  it("accepts an empty declaredAbsences array", () => {
    expect(validateCoverageDeclarationShape({ ...validRaw, declaredAbsences: [] })).toEqual([]);
  });

  it("rejects a non-object", () => {
    const findings = validateCoverageDeclarationShape("nope");
    expect(findings.map((f) => f.rule)).toEqual(["coverage-declaration/not-an-object"]);
  });

  it("rejects null and arrays as top-level values", () => {
    expect(validateCoverageDeclarationShape(null).map((f) => f.rule)).toEqual(["coverage-declaration/not-an-object"]);
    expect(validateCoverageDeclarationShape([]).map((f) => f.rule)).toEqual(["coverage-declaration/not-an-object"]);
  });

  it("rejects a wrong or missing schemaVersion", () => {
    const findings = validateCoverageDeclarationShape({ ...validRaw, schemaVersion: 99 });
    expect(findings.some((f) => f.rule === "coverage-declaration/unsupported-schema-version")).toBe(true);
  });

  it("rejects a missing or empty repository", () => {
    expect(
      validateCoverageDeclarationShape({ ...validRaw, repository: "" }).some(
        (f) => f.rule === "coverage-declaration/missing-repository",
      ),
    ).toBe(true);
    const { repository: _repository, ...withoutRepository } = validRaw;
    expect(
      validateCoverageDeclarationShape(withoutRepository).some((f) => f.rule === "coverage-declaration/missing-repository"),
    ).toBe(true);
  });

  it("rejects declaredAbsences that is not an array", () => {
    const findings = validateCoverageDeclarationShape({ ...validRaw, declaredAbsences: "nope" });
    expect(findings.map((f) => f.rule)).toEqual(["coverage-declaration/declared-absences-not-array"]);
  });

  it("rejects a non-object entry inside declaredAbsences", () => {
    const findings = validateCoverageDeclarationShape({ ...validRaw, declaredAbsences: ["nope"] });
    expect(findings.some((f) => f.rule === "coverage-declaration/absence-not-object")).toBe(true);
  });

  it("rejects an entry with a missing or empty package", () => {
    const findings = validateCoverageDeclarationShape({
      ...validRaw,
      declaredAbsences: [{ package: "", reason: "why" }],
    });
    expect(findings.some((f) => f.rule === "coverage-declaration/absence-missing-package")).toBe(true);
  });

  it("rejects an entry with a missing or empty reason -- this is the load-bearing rule", () => {
    const findings = validateCoverageDeclarationShape({
      ...validRaw,
      declaredAbsences: [{ package: "@clossys/observer", reason: "" }],
    });
    expect(findings.some((f) => f.rule === "coverage-declaration/absence-missing-reason")).toBe(true);
  });

  it("rejects a whitespace-only reason, not just an empty string", () => {
    const findings = validateCoverageDeclarationShape({
      ...validRaw,
      declaredAbsences: [{ package: "@clossys/observer", reason: "   " }],
    });
    expect(findings.some((f) => f.rule === "coverage-declaration/absence-missing-reason")).toBe(true);
  });

  it("rejects the same package declared absent twice", () => {
    const findings = validateCoverageDeclarationShape({
      ...validRaw,
      declaredAbsences: [
        { package: "@clossys/observer", reason: "a" },
        { package: "@clossys/observer", reason: "b" },
      ],
    });
    expect(findings.some((f) => f.rule === "coverage-declaration/absence-duplicate-package")).toBe(true);
  });

  it("never throws on a value it cannot even describe (a circular reference)", () => {
    const circular: Record<string, unknown> = { schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION };
    circular.self = circular;
    expect(() => validateCoverageDeclarationShape({ ...validRaw, declaredAbsences: [circular] })).not.toThrow();
  });
});

describe("parseCoverageDeclaration", () => {
  it("returns ok:true with the narrowed declaration for well-formed input", () => {
    const result = parseCoverageDeclaration(validRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.declaration.repository).toBe("example-repository-id");
      expect(result.declaration.declaredAbsences).toHaveLength(1);
    }
  });

  it("returns ok:false with findings for malformed input, never throws", () => {
    const result = parseCoverageDeclaration({ nonsense: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  // Issue #897 audit finding B: README.md and the CLI's own --help both
  // instruct the caller to pass "the already-fetched body" of the
  // coverage-declaration file, and that body comes from a raw-content HTTP
  // GET, which returns a STRING. The original implementation required an
  // already-JSON.parse'd object and rejected a string outright with
  // coverage-declaration/not-an-object -- so following the documentation
  // landed the caller directly on a bug. These tests hold the fix: a raw
  // JSON string is now accepted and parsed internally.
  it("accepts the raw JSON string body a real HTTP GET actually returns, exactly as documented", () => {
    const result = parseCoverageDeclaration(JSON.stringify(validRaw));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.declaration.repository).toBe("example-repository-id");
      expect(result.declaration.declaredAbsences).toHaveLength(1);
    }
  });

  it("fails closed -- ok:false, never a thrown SyntaxError -- for a string that is not valid JSON", () => {
    expect(() => parseCoverageDeclaration("not json {{{")).not.toThrow();
    const result = parseCoverageDeclaration("not json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings.map((f) => f.rule)).toEqual(["coverage-declaration/invalid-json"]);
    }
  });

  it("fails closed for a string that IS valid JSON but not a well-formed declaration once parsed", () => {
    const result = parseCoverageDeclaration(JSON.stringify({ nonsense: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.rule === "coverage-declaration/invalid-json")).toBe(false);
    }
  });

  it("still accepts an already-JSON.parse'd object exactly as before (both input shapes work)", () => {
    const result = parseCoverageDeclaration(validRaw);
    expect(result.ok).toBe(true);
  });
});

describe("writeCoverageDeclaration", () => {
  it("serializes a valid declaration that round-trips through parseCoverageDeclaration", () => {
    const json = writeCoverageDeclaration({
      repository: "example-repository-id",
      declaredAbsences: [{ package: "@clossys/observer", reason: "no telemetry lane here" }],
    });
    const parsed = parseCoverageDeclaration(JSON.parse(json));
    expect(parsed.ok).toBe(true);
  });

  it("serializes an empty declaredAbsences list", () => {
    const json = writeCoverageDeclaration({ repository: "example-repository-id", declaredAbsences: [] });
    const parsed = parseCoverageDeclaration(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.declaration.declaredAbsences).toEqual([]);
  });

  it("throws when asked to serialize an invalid declaration (empty reason)", () => {
    expect(() =>
      writeCoverageDeclaration({
        repository: "example-repository-id",
        declaredAbsences: [{ package: "@clossys/observer", reason: "" }],
      }),
    ).toThrow(/absence-missing-reason/);
  });

  it("throws when asked to serialize a declaration with a duplicated package", () => {
    expect(() =>
      writeCoverageDeclaration({
        repository: "example-repository-id",
        declaredAbsences: [
          { package: "@clossys/observer", reason: "a" },
          { package: "@clossys/observer", reason: "b" },
        ],
      }),
    ).toThrow(/absence-duplicate-package/);
  });
});
