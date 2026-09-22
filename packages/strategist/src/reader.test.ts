import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStrategy } from "./reader.js";

// Hermetic: every test operates on its own `mkdtemp` directory under the OS
// temp dir, created in beforeEach and removed in afterEach. Nothing here
// reads any path outside that directory.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strategy-reader-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validFact = {
  key: "active-customers",
  label: "Active customers",
  value: 4200,
  unit: "customers",
  source: "billing-export-2026-06",
  lastUpdatedAt: "2026-06-30",
};

describe("readStrategy", () => {
  it("reports a missing facts.json as an issue and is not complete", () => {
    const bundle = readStrategy(dir);
    expect(bundle.facts).toEqual([]);
    expect(bundle.complete).toBe(false);
    expect(bundle.issues).toEqual([
      { file: "facts.json", reason: "missing-required", detail: expect.any(String) },
    ]);
  });

  it("reads a valid facts.json and reports complete when nothing else is present", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    const bundle = readStrategy(dir);
    expect(bundle.facts).toEqual([validFact]);
    expect(bundle.issues).toEqual([]);
    expect(bundle.complete).toBe(true);
  });

  it("records unparseable JSON in facts.json without throwing", () => {
    writeFileSync(join(dir, "facts.json"), "{ not valid json");
    const bundle = readStrategy(dir);
    expect(bundle.facts).toEqual([]);
    expect(bundle.complete).toBe(false);
    expect(bundle.issues[0]?.reason).toBe("unparseable");
  });

  it("records a schema violation in facts.json without throwing", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([{ key: "bad key", value: 1 }]));
    const bundle = readStrategy(dir);
    expect(bundle.facts).toEqual([]);
    expect(bundle.complete).toBe(false);
    expect(bundle.issues[0]?.reason).toBe("invalid-schema");
  });

  it("loads an optional mission.json when present and valid", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(
      join(dir, "mission.json"),
      JSON.stringify({
        statement: "We help small teams ship internal tools faster.",
        vision: "A world where every team can build its own software.",
        values: [{ id: "clarity", rule: "When two designs are equally good, ship the one a newcomer understands fastest." }],
      }),
    );
    const bundle = readStrategy(dir);
    expect(bundle.mission?.statement).toBe("We help small teams ship internal tools faster.");
    expect(bundle.complete).toBe(true);
  });

  it("does not fail the whole read when an optional file is invalid, but is not complete", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(dir, "roadmap.json"), JSON.stringify([{ id: "x" }])); // missing required fields
    const bundle = readStrategy(dir);
    expect(bundle.facts).toEqual([validFact]); // facts still loaded
    expect(bundle.roadmap).toBeUndefined();
    expect(bundle.complete).toBe(false);
    expect(bundle.issues.find((i) => i.file === "roadmap.json")?.reason).toBe("invalid-schema");
  });

  it("leaves an absent optional file undefined with no issue", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    const bundle = readStrategy(dir);
    expect(bundle.positioning).toBeUndefined();
    expect(bundle.markets).toBeUndefined();
    expect(bundle.audiences).toBeUndefined();
    expect(bundle.issues).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Brand — brand.json replaces the retired brand-*.json trio.
  // ---------------------------------------------------------------------

  const validBrand = {
    essence: { statement: "Precision engineering for teams who cannot afford to guess." },
    attributes: [
      {
        id: "precise",
        statement: "Every public claim we make is checkable.",
        basis: "Every number in our marketing traces to a facts.json entry, enforced in CI.",
      },
    ],
    derivations: [
      {
        attributeId: "precise",
        tokenSlots: ["--color-accent-primary"],
        voiceRuleIds: [],
        rationale: "Precision means the accent color must read as decisive, not soft.",
      },
    ],
  };

  it("loads a valid brand.json and reports complete", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(dir, "brand.json"), JSON.stringify(validBrand));

    const bundle = readStrategy(dir);

    expect(bundle.brand).toEqual(validBrand);
    expect(bundle.issues).toEqual([]);
    expect(bundle.complete).toBe(true);
  });

  it("records retired brand-essence.json with a finding that names brand.json", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(dir, "brand-essence.json"), JSON.stringify({ statement: "Retired file should fail." }));

    const bundle = readStrategy(dir);

    expect(bundle.complete).toBe(false);
    expect(bundle.issues.some((issue) => issue.file === "brand-essence.json" && issue.detail.includes("brand.json"))).toBe(true);
  });

  it("surfaces a malformed brand.json in issues and flips complete to false", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ essence: { statement: "Fast." } }));

    const bundle = readStrategy(dir);

    expect(bundle.brand).toBeUndefined();
    expect(bundle.complete).toBe(false);
    expect(bundle.issues.find((i) => i.file === "brand.json")?.reason).toBe("invalid-schema");
  });

  it("leaves brand undefined with no issue when brand.json is absent", () => {
    writeFileSync(join(dir, "facts.json"), JSON.stringify([validFact]));

    const bundle = readStrategy(dir);

    expect(bundle.brand).toBeUndefined();
    expect(bundle.issues).toEqual([]);
    expect(bundle.complete).toBe(true);
  });
});
