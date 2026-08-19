import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  evaluateRepositoryRequirements,
  validateRepositoryRequirementsEvaluationInput,
} from "./index.js";
import type { RepositoryRequirementsEvaluationInput } from "./index.js";

const independentConsumerFixture: RepositoryRequirementsEvaluationInput = {
  declarations: [
    {
      source: "account/repository-a",
      requirements: [
        { id: "runtime.javascript", scope: "machine", constraint: { kind: "one-of", values: ["stable", "preview"] } },
        { id: "tool.formatter", scope: "repository", constraint: { kind: "present" } },
      ],
    },
    {
      source: "account/repository-b",
      requirements: [
        { id: "runtime.javascript", scope: "machine", constraint: { kind: "one-of", values: ["stable"] } },
        { id: "tool.workspace-cache", scope: "workspace", constraint: { kind: "present" } },
      ],
    },
  ],
  observations: [
    { id: "runtime.javascript", scope: "machine", state: "observed", value: "stable" },
    { id: "tool.formatter", scope: "repository", source: "account/repository-a", state: "observed", value: "available" },
    { id: "tool.workspace-cache", scope: "workspace", state: "observed", value: "available" },
  ],
};

describe("evaluateRepositoryRequirements", () => {
  it("proves an independent consumer fixture and exposes the compatible shared values", () => {
    expect(evaluateRepositoryRequirements(independentConsumerFixture)).toEqual({
      ok: true,
      status: "satisfied",
      requirements: [
        {
          id: "runtime.javascript",
          scope: "machine",
          declaredBy: ["account/repository-a", "account/repository-b"],
          status: "satisfied",
          acceptedValues: ["stable"],
        },
        {
          id: "tool.formatter",
          scope: "repository",
          source: "account/repository-a",
          declaredBy: ["account/repository-a"],
          status: "satisfied",
        },
        {
          id: "tool.workspace-cache",
          scope: "workspace",
          declaredBy: ["account/repository-b"],
          status: "satisfied",
        },
      ],
      findings: [],
    });
  });

  it("distinguishes conflicting, unsatisfied, and unknown requirements in one report", () => {
    const result = evaluateRepositoryRequirements({
      declarations: [
        {
          source: "repo-a",
          requirements: [
            { id: "runtime.primary", scope: "machine", constraint: { kind: "one-of", values: ["alpha"] } },
            { id: "runtime.secondary", scope: "machine", constraint: { kind: "one-of", values: ["alpha"] } },
            { id: "tool.required", scope: "workspace", constraint: { kind: "present" } },
          ],
        },
        {
          source: "repo-b",
          requirements: [
            { id: "runtime.primary", scope: "machine", constraint: { kind: "one-of", values: ["beta"] } },
          ],
        },
      ],
      observations: [
        { id: "runtime.primary", scope: "machine", state: "observed", value: "alpha" },
        { id: "runtime.secondary", scope: "machine", state: "observed", value: "beta" },
        { id: "tool.required", scope: "workspace", state: "unknown" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("conflicting");
    expect(result.requirements.map((entry) => entry.status)).toEqual(["conflicting", "unsatisfied", "unknown"]);
    expect(result.findings.map((entry) => entry.rule)).toEqual([
      "requirement-conflicting",
      "requirement-unsatisfied",
      "requirement-unknown",
    ]);
  });

  it("treats missing and explicit unknown evidence identically and fails closed", () => {
    const base = {
      declarations: [{ source: "repo-a", requirements: [{ id: "tool.required", scope: "machine", constraint: { kind: "present" } }] }],
    } as const;
    const missing = evaluateRepositoryRequirements({ ...base, observations: [] });
    const explicit = evaluateRepositoryRequirements({ ...base, observations: [{ id: "tool.required", scope: "machine", state: "unknown" }] });

    expect(missing.status).toBe("unknown");
    expect(explicit.status).toBe("unknown");
    expect(missing.findings.map((entry) => entry.rule)).toEqual(["requirement-unknown"]);
    expect(explicit.findings.map((entry) => entry.rule)).toEqual(["requirement-unknown"]);
  });

  it("keeps repository-scoped requirements independent across declaration sources", () => {
    const result = evaluateRepositoryRequirements({
      declarations: [
        { source: "repo-a", requirements: [{ id: "tool.local", scope: "repository", constraint: { kind: "one-of", values: ["alpha"] } }] },
        { source: "repo-b", requirements: [{ id: "tool.local", scope: "repository", constraint: { kind: "one-of", values: ["beta"] } }] },
      ],
      observations: [
        { id: "tool.local", scope: "repository", source: "repo-a", state: "observed", value: "alpha" },
        { id: "tool.local", scope: "repository", source: "repo-b", state: "absent" },
      ],
    });

    expect(result.status).toBe("unsatisfied");
    expect(result.requirements.map((entry) => [entry.source, entry.status])).toEqual([
      ["repo-a", "satisfied"],
      ["repo-b", "unsatisfied"],
    ]);
  });

  it("returns invalid with no partial evaluations for strict-shape findings", () => {
    const result = evaluateRepositoryRequirements({
      declarations: [
        {
          source: "repo-a",
          requirements: [
            { id: "runtime.node", scope: "machine", constraint: { kind: "one-of", values: ["stable", "stable"] } },
          ],
          provider: "example",
        },
        { source: "repo-a", requirements: [] },
      ],
      observations: [
        { id: "runtime.node", scope: "machine", source: "repo-a", state: "observed", value: "stable" },
        { id: "runtime.node", scope: "machine", state: "observed", value: "stable" },
      ],
      install: true,
    });

    expect(result.status).toBe("invalid");
    expect(result.requirements).toEqual([]);
    expect(result.findings.map((entry) => entry.rule)).toEqual([
      "evaluation-unknown-field",
      "declaration-unknown-field",
      "duplicate-constraint-value",
      "duplicate-declaration-source",
      "observation-source",
      "duplicate-observation",
    ]);
  });

  it("rejects malformed evidence without invoking accessors", () => {
    let reads = 0;
    const observation = { id: "tool.required", scope: "machine", state: "observed" };
    Object.defineProperty(observation, "value", { get: () => { reads += 1; return "present"; } });
    const findings = validateRepositoryRequirementsEvaluationInput({
      declarations: [{ source: "repo-a", requirements: [] }],
      observations: [observation],
    });
    expect(findings.map((entry) => entry.rule)).toEqual(["observation-shape"]);
    expect(reads).toBe(0);
  });

  it("rejects inherited custom-prototype data before evaluation", () => {
    const prototype = Object.create(null, {
      source: { value: "not-an-observation-source", enumerable: true },
    });
    const observation = Object.assign(Object.create(prototype), {
      id: "tool.required",
      scope: "workspace",
      state: "observed",
      value: "present",
    });
    const input = {
      declarations: [{ source: "repo-a", requirements: [] }],
      observations: [observation],
    };

    expect(validateRepositoryRequirementsEvaluationInput(input).map((entry) => entry.rule)).toEqual(["observation-shape"]);
    expect(evaluateRepositoryRequirements(input)).toMatchObject({
      ok: false,
      status: "invalid",
      requirements: [],
    });
  });

  it("rejects inherited custom-prototype getters without invoking them or throwing", () => {
    let reads = 0;
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "source", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("must not read inherited source");
      },
    });
    const observation = Object.assign(Object.create(prototype), {
      id: "tool.required",
      scope: "workspace",
      state: "observed",
      value: "present",
    });
    const input = {
      declarations: [{ source: "repo-a", requirements: [] }],
      observations: [observation],
    };

    expect(validateRepositoryRequirementsEvaluationInput(input).map((entry) => entry.rule)).toEqual(["observation-shape"]);
    expect(() => evaluateRepositoryRequirements(input)).not.toThrow();
    expect(evaluateRepositoryRequirements(input)).toMatchObject({
      ok: false,
      status: "invalid",
      requirements: [],
    });
    expect(reads).toBe(0);
  });

  it("accepts plain records from another realm", () => {
    const value = runInNewContext(`({
      declarations: [{ source: "repo-a", requirements: [] }],
      observations: []
    })`) as unknown;
    expect(evaluateRepositoryRequirements(value)).toEqual({
      ok: true,
      status: "satisfied",
      requirements: [],
      findings: [],
    });
  });
});
