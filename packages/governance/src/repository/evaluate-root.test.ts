import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { evaluateRepositoryRoot, validateRepositoryRootEvaluationInput } from "./index.js";
import type { RepositoryRootEvaluationInput } from "./index.js";

const exactRoot: RepositoryRootEvaluationInput = {
  rootEntries: [
    { name: "source", classification: "canonical", disposition: "required" },
    { name: ".tooling", classification: "extension", disposition: "allowed" },
    { name: "special-case", classification: "exception", disposition: "allowed" },
    { name: "old-link", classification: "compatibility-alias", disposition: "prohibited" },
    { name: "archive", classification: "legacy-artifact", disposition: "allowed" },
  ],
  observedEntries: ["source", ".tooling", "archive"],
};

describe("evaluateRepositoryRoot", () => {
  it("proves an exact caller-owned root without prescribing any entry names", () => {
    expect(evaluateRepositoryRoot(exactRoot)).toEqual({
      ok: true,
      status: "satisfied",
      entries: [
        { name: "source", classification: "canonical", disposition: "required", observed: true, status: "satisfied" },
        { name: ".tooling", classification: "extension", disposition: "allowed", observed: true, status: "satisfied" },
        { name: "special-case", classification: "exception", disposition: "allowed", observed: false, status: "satisfied" },
        { name: "old-link", classification: "compatibility-alias", disposition: "prohibited", observed: false, status: "satisfied" },
        { name: "archive", classification: "legacy-artifact", disposition: "allowed", observed: true, status: "satisfied" },
      ],
      findings: [],
    });
  });

  it("fails closed on every unknown direct child", () => {
    const result = evaluateRepositoryRoot({ ...exactRoot, observedEntries: [...exactRoot.observedEntries, "surprise", "another"] });
    expect(result).toMatchObject({ ok: false, status: "nonconforming" });
    expect(result.entries.slice(-2)).toEqual([
      { name: "surprise", observed: true, status: "unknown" },
      { name: "another", observed: true, status: "unknown" },
    ]);
    expect(result.findings.map((entry) => entry.rule)).toEqual(["root-entry-unknown", "root-entry-unknown"]);
  });

  it("reports missing required and observed prohibited entries together", () => {
    const result = evaluateRepositoryRoot({ ...exactRoot, observedEntries: ["old-link"] });
    expect(result.entries.map((entry) => [entry.name, entry.status])).toEqual([
      ["source", "missing"],
      [".tooling", "satisfied"],
      ["special-case", "satisfied"],
      ["old-link", "prohibited"],
      ["archive", "satisfied"],
    ]);
    expect(result.findings.map((entry) => entry.rule)).toEqual(["root-entry-missing", "root-entry-prohibited"]);
  });

  it("treats undeclared aliases and legacy artifacts as unknown rather than guessing", () => {
    const result = evaluateRepositoryRoot({
      rootEntries: [{ name: "source", classification: "canonical", disposition: "required" }],
      observedEntries: ["source", "compat-link", "old-output"],
    });
    expect(result.findings.map((entry) => entry.rule)).toEqual(["root-entry-unknown", "root-entry-unknown"]);
  });

  it("returns invalid with no partial proof for malformed declarations or observations", () => {
    const result = evaluateRepositoryRoot({
      rootEntries: [
        { name: "source", classification: "canonical" },
        { name: "source", classification: "legacy", disposition: "retain" },
      ],
      observedEntries: ["source", "source", "nested/path"],
      discover: true,
    });
    expect(result.status).toBe("invalid");
    expect(result.entries).toEqual([]);
    expect(result.findings.map((entry) => entry.rule)).toEqual([
      "root-evaluation-unknown-field",
      "root-entry-disposition",
      "duplicate-root-entry",
      "root-entry-classification",
      "root-entry-disposition",
      "duplicate-observed-entry",
      "observed-entry-name",
    ]);
  });

  it("accepts plain frozen data from another realm and never mutates it", () => {
    const input = runInNewContext(`Object.freeze({
      rootEntries: Object.freeze([Object.freeze({ name: "source", classification: "canonical", disposition: "required" })]),
      observedEntries: Object.freeze(["source"])
    })`) as unknown;
    expect(validateRepositoryRootEvaluationInput(input)).toEqual([]);
    expect(evaluateRepositoryRoot(input)).toMatchObject({ ok: true, status: "satisfied" });
  });

  it("rejects accessor-backed observations without invoking them", () => {
    let reads = 0;
    const observedEntries: string[] = [];
    Object.defineProperty(observedEntries, "0", { get: () => { reads += 1; return "source"; } });
    expect(validateRepositoryRootEvaluationInput({ rootEntries: [], observedEntries }).map((entry) => entry.rule)).toEqual(["observed-entries-shape"]);
    expect(reads).toBe(0);
  });

  it("rejects behavior-bearing or symbol-keyed declarations without invoking them", () => {
    let reads = 0;
    const accessorEntry = { name: "source", disposition: "required" };
    Object.defineProperty(accessorEntry, "classification", { get: () => { reads += 1; return "canonical"; } });
    const symbolEntry = { name: "other", classification: "canonical", disposition: "allowed", [Symbol("hidden")]: true };

    expect(validateRepositoryRootEvaluationInput({
      rootEntries: [accessorEntry, symbolEntry],
      observedEntries: [],
    }).map((entry) => entry.rule)).toEqual(["root-entry-shape", "root-entry-shape"]);
    expect(reads).toBe(0);
  });

  it("evaluates descriptor snapshots instead of lying top-level and nested proxy getters", () => {
    let reads = 0;
    const rootEntry = new Proxy(
      { name: "old-link", classification: "compatibility-alias", disposition: "prohibited" },
      {
        get(target, key, receiver) {
          reads += 1;
          if (key === "disposition") return "allowed";
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const input = new Proxy(
      { rootEntries: [rootEntry], observedEntries: ["old-link"] },
      {
        get(target, key, receiver) {
          reads += 1;
          if (key === "observedEntries") return [];
          return Reflect.get(target, key, receiver);
        },
      },
    );

    expect(validateRepositoryRootEvaluationInput(input)).toEqual([]);
    expect(evaluateRepositoryRoot(input)).toMatchObject({
      ok: false,
      status: "nonconforming",
      entries: [{ name: "old-link", disposition: "prohibited", observed: true, status: "prohibited" }],
      findings: [{ rule: "root-entry-prohibited" }],
    });
    expect(reads).toBe(0);
  });

  it("uses descriptor snapshots when nested proxy getters throw", () => {
    let reads = 0;
    const rootEntry = new Proxy(
      { name: "source", classification: "canonical", disposition: "required" },
      { get: () => { reads += 1; throw new Error("unsafe nested read"); } },
    );
    const observedEntries = new Proxy(["source", "unexpected"], {
      get: () => { reads += 1; throw new Error("unsafe observation read"); },
    });
    const input = new Proxy(
      { rootEntries: [rootEntry], observedEntries },
      { get: () => { reads += 1; throw new Error("unsafe top-level read"); } },
    );

    expect(validateRepositoryRootEvaluationInput(input)).toEqual([]);
    expect(evaluateRepositoryRoot(input)).toMatchObject({
      ok: false,
      status: "nonconforming",
      findings: [{ rule: "root-entry-unknown", path: "observedEntries[1]" }],
    });
    expect(reads).toBe(0);
  });

  it("fails closed on descriptor traps and nested accessors without invoking getters", () => {
    let reads = 0;
    const accessorEntry = { name: "source", disposition: "required" };
    Object.defineProperty(accessorEntry, "classification", {
      get: () => { reads += 1; return "canonical"; },
    });
    const accessorInput = { rootEntries: [accessorEntry], observedEntries: ["source"] };
    const descriptorFailure = new Proxy(
      { rootEntries: [], observedEntries: [] },
      {
        get: () => { reads += 1; throw new Error("unsafe top-level read"); },
        getOwnPropertyDescriptor(target, key) {
          if (key === "rootEntries") throw new Error("descriptor failure");
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );

    expect(evaluateRepositoryRoot(accessorInput)).toMatchObject({
      ok: false,
      status: "invalid",
      entries: [],
      findings: [{ rule: "root-entry-shape" }],
    });
    expect(evaluateRepositoryRoot(descriptorFailure)).toMatchObject({
      ok: false,
      status: "invalid",
      entries: [],
      findings: [{ rule: "root-evaluation-shape" }],
    });
    expect(reads).toBe(0);
  });
});
