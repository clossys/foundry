import { describe, expect, it } from "vitest";
import { matchesPathExclusion, validatePathExclusions, type ValidatedPathExclusion } from "./path-exclusions.js";

function classify(path: string): ValidatedPathExclusion["kind"] | undefined {
  const { valid, findings } = validatePathExclusions([{ path, reason: "test" }]);
  if (findings.length > 0) return undefined;
  return valid[0]?.kind;
}

describe("validatePathExclusions — pattern classification", () => {
  it("classifies an exact path", () => {
    expect(classify("docs/style-guide.ts")).toBe("exact");
  });

  it("classifies a directory subtree", () => {
    expect(classify("docs/**")).toBe("subtree");
  });

  it("classifies a single final-segment wildcard", () => {
    expect(classify("docs/*.ts")).toBe("segment-wildcard");
  });

  it("rejects a bare '**' with no directory prefix", () => {
    expect(classify("**")).toBeUndefined();
  });

  it("rejects a mid-path wildcard", () => {
    expect(classify("docs/*/style-guide.ts")).toBeUndefined();
  });

  it("rejects more than one '*' in the final segment", () => {
    expect(classify("docs/*-*.ts")).toBeUndefined();
  });

  it("rejects an empty pattern", () => {
    expect(classify("")).toBeUndefined();
  });
});

describe("validatePathExclusions — fails closed", () => {
  it("returns [] valid, [] findings when omitted", () => {
    expect(validatePathExclusions(undefined)).toEqual({ valid: [], findings: [] });
  });

  it("reports a non-array value as invalid, applying nothing", () => {
    const { valid, findings } = validatePathExclusions("not an array");
    expect(valid).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "path-exclusion-invalid", severity: "error" });
  });

  it("reports a non-object entry as invalid", () => {
    const { valid, findings } = validatePathExclusions(["not an object", 5, null]);
    expect(valid).toEqual([]);
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.rule === "path-exclusion-invalid" && f.severity === "error")).toBe(true);
  });

  it("reports a missing/empty reason as invalid — an exclusion with no stated reason is not auditable", () => {
    const { valid, findings } = validatePathExclusions([{ path: "docs/x.ts" }, { path: "docs/y.ts", reason: "  " }]);
    expect(valid).toEqual([]);
    expect(findings).toHaveLength(2);
  });

  it("reports a missing path as invalid", () => {
    const { valid, findings } = validatePathExclusions([{ reason: "no path given" }]);
    expect(valid).toEqual([]);
    expect(findings).toHaveLength(1);
  });

  it("reports an unsupported pattern shape as invalid, never applied", () => {
    const { valid, findings } = validatePathExclusions([{ path: "**", reason: "bare double-star" }]);
    expect(valid).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("**");
  });

  it("flags every bad entry, not just the first", () => {
    const { findings } = validatePathExclusions([
      { path: "", reason: "x" },
      { path: "y", reason: "" },
    ]);
    expect(findings).toHaveLength(2);
  });

  it("keeps well-formed entries valid alongside malformed ones", () => {
    const { valid, findings } = validatePathExclusions([
      { path: "docs/style-guide.ts", reason: "documents banned terms" },
      { path: "bad", reason: "" },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.path).toBe("docs/style-guide.ts");
    expect(findings).toHaveLength(1);
  });

  it("never throws on any input shape", () => {
    for (const input of [null, undefined, 5, "x", {}, [null], [{}]]) {
      expect(() => validatePathExclusions(input)).not.toThrow();
    }
  });
});

describe("matchesPathExclusion", () => {
  it("exact matches only the identical path", () => {
    const excl: ValidatedPathExclusion = { path: "docs/style-guide.ts", reason: "x", kind: "exact" };
    expect(matchesPathExclusion("docs/style-guide.ts", excl)).toBe(true);
    expect(matchesPathExclusion("docs/other.ts", excl)).toBe(false);
    expect(matchesPathExclusion("nested/docs/style-guide.ts", excl)).toBe(false);
  });

  it("subtree matches every file recursively under the directory", () => {
    const excl: ValidatedPathExclusion = { path: "docs/**", reason: "x", kind: "subtree" };
    expect(matchesPathExclusion("docs/style-guide.ts", excl)).toBe(true);
    expect(matchesPathExclusion("docs/internal/glossary.ts", excl)).toBe(true);
    expect(matchesPathExclusion("src/docs/style-guide.ts", excl)).toBe(false);
    expect(matchesPathExclusion("other/file.ts", excl)).toBe(false);
  });

  it("segment-wildcard matches only within the final segment, never crossing '/'", () => {
    const excl: ValidatedPathExclusion = { path: "docs/*.ts", reason: "x", kind: "segment-wildcard" };
    expect(matchesPathExclusion("docs/style-guide.ts", excl)).toBe(true);
    expect(matchesPathExclusion("docs/a.ts", excl)).toBe(true);
    expect(matchesPathExclusion("docs/nested/style-guide.ts", excl)).toBe(false);
    expect(matchesPathExclusion("docs/style-guide.txt", excl)).toBe(false);
    expect(matchesPathExclusion("other/style-guide.ts", excl)).toBe(false);
  });
});
