import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorRateCliInputError, main, runDirectorRateCli } from "./strategy-traceability-rate-cli.js";

// `clossys director rate-check` (producer) runs runDirectorRateCli; the compiled path is
// exercised end to end in packages/producer/src/cli/director-verb.test.ts.
let root: string;

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function satisfied(): Record<string, unknown> {
  return {
    asOf: "2026-09-18T12:00:00Z",
    declaredClaims: [{ id: "claim-one" }],
    observations: [{
      claimId: "claim-one",
      independent: true,
      currentEvidence: true,
      derived: true,
      approved: true,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
    observations: [{
      claimId: "claim-one",
      independent: true,
      currentEvidence: true,
      derived: true,
      approved: false,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function write(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "director-rate-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("clossys director rate-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredClaims: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(DirectorRateCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(DirectorRateCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("prints the report and maps input errors to exit 2 at the error boundary", () => {
    expect(runDirectorRateCli([write("satisfied.json", satisfied())])).toBe(0);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({ state: "satisfied", metric: "strategy traceability rate", rate: 1 });
    expect(runDirectorRateCli([join(root, "missing.json")])).toBe(2);
    expect(vi.mocked(console.error).mock.calls.some(([line]) => String(line).startsWith("clossys director rate-check: ") && String(line).includes("does not exist"))).toBe(true);
  });
});
