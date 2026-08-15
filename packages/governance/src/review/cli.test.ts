import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

const headSha = "e".repeat(40);
const baseSha = "7".repeat(40);
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "review-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeJson(name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function evidence() {
  return {
    schemaVersion: 2,
    headSha,
    baseSha,
    paginationComplete: true,
    checks: [{ name: "unit", conclusion: "success", headSha }],
    reviews: [{ id: "review", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha }],
    threads: [{ id: "thread", isResolved: true, headSha }],
  };
}

const policy = { requiredChecks: ["unit"], requireApproval: true, decisionUse: "authoritative" };

describe("review-check", () => {
  it("prints help and returns 0", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: review-check"));
  });

  it("prints a clean JSON report and returns 0", () => {
    expect(main([writeJson("evidence.json", evidence()), writeJson("policy.json", policy)])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ ok: true, findings: [] }, null, 2));
  });

  it("prints validation findings and returns 1", () => {
    const invalid = evidence();
    invalid.checks[0]!.conclusion = "failure";
    expect(main([writeJson("evidence.json", invalid), writeJson("policy.json", policy)])).toBe(1);
    const report = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string) as { ok: boolean; findings: Array<{ rule: string }> };
    expect(report.ok).toBe(false);
    expect(report.findings.map((item) => item.rule)).toContain("required-check-failed");
  });

  it("throws an input error for malformed input so the bin exits 2", () => {
    const malformed = join(directory, "malformed.json");
    writeFileSync(malformed, "{ no");
    expect(() => main([malformed, writeJson("policy.json", policy)])).toThrow(CliInputError);
  });

  it("rejects a version-1 evidence file rather than accepting it", () => {
    const v1 = { schemaVersion: 1, headSha, paginationComplete: true, checks: [], reviews: [], threads: [] };
    expect(main([writeJson("evidence.json", v1), writeJson("policy.json", policy)])).toBe(1);
    const report = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string) as { ok: boolean; findings: Array<{ rule: string }> };
    expect(report.ok).toBe(false);
    expect(report.findings.map((item) => item.rule)).toContain("schema-version");
  });

  it("rejects an advisory policy that also requires approval", () => {
    const advisoryPolicy = { requiredChecks: ["unit"], requireApproval: true, decisionUse: "advisory" };
    expect(main([writeJson("evidence.json", evidence()), writeJson("policy.json", advisoryPolicy)])).toBe(1);
    const report = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string) as { ok: boolean; findings: Array<{ rule: string }> };
    expect(report.ok).toBe(false);
    expect(report.findings.map((item) => item.rule)).toEqual(["advisory-approval-conflict"]);
  });
});
