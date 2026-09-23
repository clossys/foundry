import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorRenderStatusCliInputError, main } from "./render-status-cli.js";
import type { AdvisorPlan } from "./status.js";

let root: string;

const BASE_PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "Our site doesn't explain what we do.", primaryProblemId: "strategist-unclear-direction", roles: ["strategist"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: null,
  decisions: [],
  blockers: [],
};

function write(value: unknown): string {
  const path = join(root, "plan.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "advisor-render-status-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("advisor-render-status", () => {
  it("prints the rendered STATUS.md and exits 0", () => {
    expect(main([write(BASE_PLAN)])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("## Mandate"));
  });

  it("exits 2 for a missing file, and throws AdvisorRenderStatusCliInputError with no/too many args", () => {
    expect(() => main([])).toThrow(AdvisorRenderStatusCliInputError);
    expect(() => main([join(root, "missing.json"), "extra"])).toThrow(AdvisorRenderStatusCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(AdvisorRenderStatusCliInputError);
  });

  it("rejects a plan.json that does not match the AdvisorPlan shape", () => {
    expect(() => main([write({ not: "a plan" })])).toThrow(AdvisorRenderStatusCliInputError);
  });

  it("rejects a plan.json whose blocker uses the old local shape (description/dueDate) instead of Controller's shared Blocker shape (#1237)", () => {
    const oldShapeBlocker = { kind: "missing-input", description: "no evidence yet", owner: "this-role", dueDate: "2026-09-25T00:00:00Z" };
    expect(() => main([write({ ...BASE_PLAN, blockers: [oldShapeBlocker] })])).toThrow(AdvisorRenderStatusCliInputError);
  });

  it("accepts a plan.json whose blocker uses the shared Blocker shape", () => {
    const blocker = {
      capabilityId: "engagement",
      kind: "missing-authority",
      owner: "sponsor",
      nextAction: { who: "sponsor", how: "approve the plan", byWhen: "2026-09-25T00:00:00Z" },
      since: "2026-09-20T00:00:00Z",
    };
    expect(main([write({ ...BASE_PLAN, blockers: [blocker] })])).toBe(0);
  });

  it("--help prints usage and exits 0 without reading a file", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: advisor-render-status"));
  });
});
