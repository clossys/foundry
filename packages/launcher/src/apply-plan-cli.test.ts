import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./apply-plan-cli.js";
import { createNodeHost } from "./host.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "apply-plan-cli-"));
  roots.push(root);
  return root;
}

const VALID_PLAN = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "x", primaryProblemId: "unclear-positioning", roles: ["strategist"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: null,
  decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "compose", chosen: "approved", by: "sponsor" }],
  blockers: [],
};

const VALID_BRIEF = {
  schemaVersion: 1,
  problem: "x",
  roles: [{ role: "strategist", why: "y", goal: { metric: "m", direction: "increase" }, inputsFrom: [], outputsTo: [] }],
  sequence: ["strategist"],
  deliverables: ["z"],
};

describe("apply-plan-cli main", () => {
  it("writes clossys/brief.json and exits 0 when both files validate and the plan is approved", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toContain("clossys/brief.json");
    const written = JSON.parse(readFileSync(join(repoDir, "clossys", "brief.json"), "utf8"));
    expect(written).toEqual(VALID_BRIEF);
  });

  it("exits 1 and writes nothing when the plan is not approved", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    writeFileSync(planPath, JSON.stringify({ ...VALID_PLAN, decisions: [] }));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/refused/);
  });

  it("exits 2 when --plan does not point at readable JSON", () => {
    const workDir = tempDir();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", join(workDir, "missing.json"), "--brief", join(workDir, "also-missing.json"), "--repo", workDir], createNodeHost());
    expect(code).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/could not be read/);
  });

  it("exits 1 with a specific reason when --brief exists but does not validate", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify(VALID_PLAN));
    writeFileSync(briefPath, JSON.stringify({ schemaVersion: 1 }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/--brief does not validate/);
  });

  it("applies an Advisor-shaped plan with a blocker and no recommendedNext.due, and prints its canonical digest (#1475)", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    const plan = {
      ...VALID_PLAN,
      recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor" },
      blockers: [
        { capabilityId: "engagement", kind: "missing-authority", owner: "sponsor", nextAction: { who: "sponsor", how: "approve the plan", byWhen: "2026-09-29" }, since: "2026-09-20T00:00:00Z" },
      ],
    };
    writeFileSync(planPath, JSON.stringify(plan));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", repoDir], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[1]?.[0])).toMatch(/^plan digest sha256:[0-9a-f]{64}$/);
  });

  it("exits 1 naming the field when --plan carries a field the contract does not declare", () => {
    const workDir = tempDir();
    const planPath = join(workDir, "plan.json");
    const briefPath = join(workDir, "brief.json");
    writeFileSync(planPath, JSON.stringify({ ...VALID_PLAN, staffing: [] }));
    writeFileSync(briefPath, JSON.stringify(VALID_BRIEF));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["--plan", planPath, "--brief", briefPath, "--repo", workDir], createNodeHost());
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toBe(
      "launcher-apply-plan: --plan does not validate: plan.staffing is not a field the contract declares, and unknown fields are refused",
    );
  });

  it("--help prints usage and exits 0", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(["--help"], createNodeHost());
    expect(code).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/Usage: launcher-apply-plan/);
  });

  it("main() throws directly on malformed arguments -- only the run() executable wrapper maps that to exit 2", () => {
    expect(() => main(["--plan"], createNodeHost())).toThrow(/usage: launcher-apply-plan/);
  });
});
