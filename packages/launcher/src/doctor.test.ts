import { describe, expect, it } from "vitest";
import { renderDoctorReport, runDoctorChecks, type DoctorCheckHost } from "./doctor.js";
import type { CommandResult } from "./types.js";

function ok(): CommandResult {
  return { status: 0, stdout: "x", stderr: "" };
}
function fail(): CommandResult {
  return { status: 1, stdout: "", stderr: "not found" };
}
function throwingHost(): DoctorCheckHost {
  return {
    run() {
      throw new Error("ENOENT");
    },
  };
}

describe("runDoctorChecks", () => {
  it("reports every prerequisite satisfied when every command succeeds", () => {
    const host: DoctorCheckHost = { run: () => ok() };
    const report = runDoctorChecks(host);
    expect(report.allSatisfied).toBe(true);
    expect(report.nextToFix).toBeUndefined();
    expect(report.steps.every((step) => step.satisfied || step.advisory)).toBe(true);
  });

  it("names git first when nothing is installed, not gh-auth or a later step", () => {
    const host: DoctorCheckHost = { run: () => fail() };
    const report = runDoctorChecks(host);
    expect(report.allSatisfied).toBe(false);
    expect(report.nextToFix?.id).toBe("git");
  });

  it("gh-auth is reported as unresolved-because-of-gh-cli, not run, when gh itself is missing", () => {
    const host: DoctorCheckHost = {
      run: (command) => (command === "gh" ? fail() : ok()),
    };
    const report = runDoctorChecks(host);
    const ghAuthStep = report.steps.find((step) => step.id === "gh-auth");
    expect(ghAuthStep?.satisfied).toBe(false);
    expect(ghAuthStep?.problem).toMatch(/cannot be checked/);
  });

  it("a spawn failure (ENOENT, not a nonzero exit) is treated as 'not installed', never thrown", () => {
    const report = runDoctorChecks(throwingHost());
    expect(report.allSatisfied).toBe(false);
    expect(report.nextToFix?.id).toBe("git");
  });

  it("coding-agent is advisory: never the reported nextToFix, and is reported satisfied", () => {
    const host: DoctorCheckHost = { run: () => ok() };
    const report = runDoctorChecks(host);
    const codingAgentStep = report.steps.find((step) => step.id === "coding-agent");
    expect(codingAgentStep?.advisory).toBe(true);
    expect(codingAgentStep?.satisfied).toBe(true);
    expect(report.nextToFix?.id).not.toBe("coding-agent");
  });

  it("reports steps in the fix-in-this-order sequence: git, gh-cli, gh-auth, node, npm, coding-agent", () => {
    const host: DoctorCheckHost = { run: () => ok() };
    const report = runDoctorChecks(host);
    expect(report.steps.map((step) => step.id)).toEqual(["git", "gh-cli", "gh-auth", "node", "npm", "coding-agent"]);
  });
});

describe("renderDoctorReport", () => {
  it("renders exactly one step at a time, never the full list, when something is missing", () => {
    const host: DoctorCheckHost = { run: () => fail() };
    const report = runDoctorChecks(host);
    const rendered = renderDoctorReport(report);
    expect(rendered).toContain("Git");
    expect(rendered).not.toContain("npm is installed");
  });

  it("renders a single ready message when everything is satisfied", () => {
    const host: DoctorCheckHost = { run: () => ok() };
    const rendered = renderDoctorReport(runDoctorChecks(host));
    expect(rendered).toMatch(/ready/i);
  });
});
