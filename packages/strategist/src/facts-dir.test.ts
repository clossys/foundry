import { describe, expect, it } from "vitest";
import { readStrategyDirectory } from "./facts-dir.js";
import { validateFacts } from "./schema.js";
import type { Fact } from "./schema.js";

// Hermetic and fully synchronous: `readStrategyDirectory` is pure — it
// takes the directory's contents as a map, so every test here passes a
// literal and never touches a filesystem. The CLI-side tests that DO use
// real `mkdtemp` directories live in `cli.test.ts`.

const factA: Fact = {
  key: "active-customers",
  label: "Active customers",
  value: 4200,
  unit: "customers",
  source: "billing-export-2026-06",
  lastUpdatedAt: "2026-06-30",
  aliases: ["4,200"],
};

const factB: Fact = {
  key: "uptime",
  label: "Trailing-90-day uptime",
  value: 99.95,
  unit: "%",
  source: "status-page-export",
  lastUpdatedAt: "2026-07-01",
};

const factC: Fact = {
  key: "launch-quarter",
  label: "First launch quarter",
  value: "Q2 2026",
  source: "launch-plan",
  lastUpdatedAt: "2026-04-01",
};

describe("readStrategyDirectory — happy path", () => {
  it("combines every *.json leaf into one Fact[] in deterministic path order", () => {
    const result = readStrategyDirectory({
      files: {
        "b-uptime.json": JSON.stringify([factB]),
        "a-customers.json": JSON.stringify([factA]),
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    // Sorted by relative path, not key insertion order — the same
    // directory map always combines identically.
    expect(result.facts.map((f) => f.key)).toEqual(["active-customers", "uptime"]);
  });

  it("reads multiple facts from a single leaf", () => {
    const result = readStrategyDirectory({
      files: { "facts.json": JSON.stringify([factA, factB, factC]) },
    });
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.facts.map((f) => f.key)).toEqual(["active-customers", "uptime", "launch-quarter"]);
  });

  it("records each fact's provenance in Fact.sourceFile", () => {
    const result = readStrategyDirectory({
      files: {
        "customers.json": JSON.stringify([factA]),
        "uptime.json": JSON.stringify([factB]),
      },
    });
    expect(result.facts.map((f) => f.sourceFile)).toEqual(["customers.json", "uptime.json"]);
  });

  it("produces the same values as the flat facts.json equivalent", () => {
    // The directory form is a re-layout of the flat file, not a new
    // format: one leaf holding the whole flat array must combine to
    // exactly what the flat file's own validator produces.
    const flatText = JSON.stringify([factA, factB]);
    const flat = validateFacts(JSON.parse(flatText));
    expect(flat.ok).toBe(true);
    const result = readStrategyDirectory({ files: { "facts.json": flatText } });
    expect(result.facts.map(({ sourceFile: _sourceFile, ...rest }) => rest)).toEqual(flat.ok ? flat.value : []);
  });

  it("validates each leaf with the same rules as the flat file, so a single leaf can also hold the whole registry", () => {
    const result = readStrategyDirectory({
      files: {
        "people.json": JSON.stringify([factA]),
        "claims.json": JSON.stringify([{ key: "bad key", value: 1 }]),
      },
    });
    expect(result.complete).toBe(false);
    expect(result.facts.map((f) => f.key)).toEqual(["active-customers"]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.file).toBe("claims.json");
    expect(result.issues[0]?.reason).toBe("invalid-schema");
  });

  it("accepts duplicate keys across separate leaves (per-leaf validation, mirroring a split registry)", () => {
    // Each leaf is validated exactly like a standalone facts.json — and
    // two standalone files may legitimately carry the same key while one
    // flat file may not. Documented here so the behavior is a decision,
    // not an accident.
    const result = readStrategyDirectory({
      files: {
        "a.json": JSON.stringify([factA]),
        "b.json": JSON.stringify([factA]),
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.facts).toHaveLength(2);
  });
});

describe("readStrategyDirectory — refusal, always naming the offending file", () => {
  it("records an unparseable leaf with its path and never throws", () => {
    const result = readStrategyDirectory({
      files: {
        "customers.json": JSON.stringify([factA]),
        "broken.json": "{ not valid json",
      },
    });
    expect(result.facts.map((f) => f.key)).toEqual(["active-customers"]);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      { file: "broken.json", reason: "unparseable", detail: expect.any(String) },
    ]);
  });

  it("records a schema-invalid leaf with the validator's issue summary", () => {
    const result = readStrategyDirectory({ files: { "bad.json": JSON.stringify([{ key: "nope" }]) } });
    expect(result.facts).toEqual([]);
    expect(result.issues).toEqual([
      { file: "bad.json", reason: "invalid-schema", detail: expect.any(String) },
    ]);
    // The same shape errors the flat file's validator emits — the leaf is
    // a whole facts file, so issues are addressed by index, not by name.
    expect(result.issues[0]?.detail).toContain("(root)[0].label: must be a string");
  });

  it("refuses a non-JSON leaf instead of silently skipping it — every leaf must be accounted for", () => {
    const result = readStrategyDirectory({
      files: {
        "customers.json": JSON.stringify([factA]),
        "notes.md": "misplaced prose",
        "data.csv": "a,b\n1,2",
      },
    });
    expect(result.facts.map((f) => f.key)).toEqual(["active-customers"]);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      { file: "data.csv", reason: "non-json", detail: expect.any(String) },
      { file: "notes.md", reason: "non-json", detail: expect.any(String) },
    ]);
  });

  it("refuses a directory with no JSON leaf at all as 'empty', never a silent zero-fact pass", () => {
    const result = readStrategyDirectory({ files: {} });
    expect(result.facts).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      { file: "(directory)", reason: "empty", detail: expect.any(String) },
    ]);
  });

  it("refuses a directory holding only non-JSON leaves with both the leaf refusals and the 'empty' refusal", () => {
    const result = readStrategyDirectory({ files: { "notes.md": "prose" } });
    expect(result.facts).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.issues.map((i) => [i.file, i.reason])).toEqual([
      ["notes.md", "non-json"],
      ["(directory)", "empty"],
    ]);
  });
});
