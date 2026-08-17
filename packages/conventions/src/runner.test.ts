import { describe, it, expect } from "vitest";
import {
  validateRunnerLabel,
  validateRunnerSet,
  summarizeRunnerResults,
  type JobDefinition,
  type RunnerConventions,
} from "./runner.js";

const baseConventions: RunnerConventions = {
  vocabulary: {
    labels: [
      { label: "blacksmith-2vcpu-ubuntu-2204", capacity: "standard", intendedWorkload: "default" },
      { label: "blacksmith-4vcpu-ubuntu-2204", capacity: "high", intendedWorkload: "build+test" },
    ],
    defaultLabel: "blacksmith-2vcpu-ubuntu-2204",
    highCapacityJustifiedJobs: ["frontend-verify", "node-tests-verify", "site-verify", "admin-verify"],
  },
  publicRepos: ["foundry"],
};

const baseJob: JobDefinition = {
  workflow: "ci.yml",
  job: "frontend-verify",
  label: "blacksmith-4vcpu-ubuntu-2204",
  repoVisibility: "private",
};

describe("validateRunnerLabel", () => {
  it("returns satisfied for a valid high-capacity job that is justified", () => {
    const results = validateRunnerLabel(baseJob, baseConventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("satisfied");
    expect(results[0].rule).toBe("runner/ok");
  });

  it("returns violated for unknown label", () => {
    const job: JobDefinition = { ...baseJob, label: "blacksmith-8vcpu-ubuntu-2204" };
    const results = validateRunnerLabel(job, baseConventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("violated");
    expect(results[0].rule).toBe("runner/unknown-label");
  });

  it("returns violated for public repo using paid-provider label", () => {
    const job: JobDefinition = { ...baseJob, workflow: "ci.yml", repoVisibility: "public" };
    const results = validateRunnerLabel(job, baseConventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("violated");
    expect(results[0].rule).toBe("runner/visibility-mismatch");
  });

  it("returns satisfied for public repo using paid-provider label when exempted", () => {
    const conventions: RunnerConventions = {
      ...baseConventions,
      publicRepos: ["ci.yml"],
    };
    const job: JobDefinition = { ...baseJob, workflow: "ci.yml", repoVisibility: "public" };
    const results = validateRunnerLabel(job, conventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("satisfied");
  });

  it("returns violated for high-capacity job not in justified list", () => {
    const job: JobDefinition = { ...baseJob, job: "secret-scan", label: "blacksmith-4vcpu-ubuntu-2204" };
    const results = validateRunnerLabel(job, baseConventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("violated");
    expect(results[0].rule).toBe("runner/unjustified-capacity");
  });

  it("returns satisfied for standard-capacity job", () => {
    const job: JobDefinition = { ...baseJob, job: "secret-scan", label: "blacksmith-2vcpu-ubuntu-2204" };
    const results = validateRunnerLabel(job, baseConventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("satisfied");
  });

  it("returns indeterminate when vocabulary is missing", () => {
    const conventions: RunnerConventions = { ...baseConventions, vocabulary: { ...baseConventions.vocabulary, labels: [] } };
    const results = validateRunnerLabel(baseJob, conventions);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("indeterminate");
    expect(results[0].rule).toBe("runner/missing-vocabulary");
  });
});

describe("validateRunnerSet", () => {
  it("validates multiple jobs and returns all results", () => {
    const jobs: JobDefinition[] = [
      { workflow: "ci.yml", job: "frontend-verify", label: "blacksmith-4vcpu-ubuntu-2204", repoVisibility: "private" },
      { workflow: "ci.yml", job: "secret-scan", label: "blacksmith-4vcpu-ubuntu-2204", repoVisibility: "private" },
      { workflow: "ci.yml", job: "lint", label: "blacksmith-2vcpu-ubuntu-2204", repoVisibility: "private" },
    ];
    const results = validateRunnerSet(jobs, baseConventions);
    expect(results).toHaveLength(3);
    expect(results[0].state).toBe("satisfied");
    expect(results[1].state).toBe("violated");
    expect(results[2].state).toBe("satisfied");
  });
});

describe("summarizeRunnerResults", () => {
  it("summarizes correctly when all satisfied", () => {
    const results = [
      { job: baseJob, state: "satisfied" as const, rule: "runner/ok", message: "ok" },
      { job: baseJob, state: "satisfied" as const, rule: "runner/ok", message: "ok" },
    ];
    const summary = summarizeRunnerResults(results);
    expect(summary.satisfied).toBe(2);
    expect(summary.violated).toBe(0);
    expect(summary.indeterminate).toBe(0);
    expect(summary.overall).toBe("satisfied");
  });

  it("summarizes correctly when any violated", () => {
    const results = [
      { job: baseJob, state: "satisfied" as const, rule: "runner/ok", message: "ok" },
      { job: baseJob, state: "violated" as const, rule: "runner/unknown-label", message: "bad" },
    ];
    const summary = summarizeRunnerResults(results);
    expect(summary.satisfied).toBe(1);
    expect(summary.violated).toBe(1);
    expect(summary.indeterminate).toBe(0);
    expect(summary.overall).toBe("violated");
  });

  it("summarizes correctly when indeterminate but no satisfied", () => {
    const results = [
      { job: baseJob, state: "indeterminate" as const, rule: "runner/missing-vocabulary", message: "missing" },
    ];
    const summary = summarizeRunnerResults(results);
    expect(summary.satisfied).toBe(0);
    expect(summary.violated).toBe(0);
    expect(summary.indeterminate).toBe(1);
    expect(summary.overall).toBe("indeterminate");
  });
});