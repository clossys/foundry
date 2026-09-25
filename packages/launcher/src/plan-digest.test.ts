import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalJson, planDigest } from "./plan-digest.js";
import type { AdvisorPlan } from "./plan-contract.js";

/*
 * Issue #1475. This package's own implementation of the canonical plan
 * digest, checked against the shared corpus @clossys/advisor is tested
 * against too, so the two packages compute identical digests; and the
 * build-time packing that lets this package validate against Advisor's
 * contracts with no runtime dependency on Advisor. Reading sibling source
 * here is test-only: nothing at runtime leaves this package.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

interface DigestCorpus {
  canonicalJson: { name: string; value: unknown; canonical: string }[];
  refused: { name: string; json: string }[];
  plans: { name: string; plan: AdvisorPlan; canonical: string; digest: string }[];
}
const CORPUS = JSON.parse(read("docs/contracts/advisor-plan-digest.fixture.json")) as DigestCorpus;
const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!;

describe("canonical plan digest (docs/contracts/advisor-plan-digest.md)", () => {
  it("excludes exactly asOf and decisions", () => {
    expect(PLAN_DIGEST_EXCLUDED_FIELDS).toEqual(["asOf", "decisions"]);
  });

  it("serializes every corpus value to its expected canonical JSON", () => {
    for (const entry of CORPUS.canonicalJson) expect(canonicalJson(entry.value), entry.name).toBe(entry.canonical);
  });

  it("refuses every corpus value that is not well-formed Unicode", () => {
    for (const entry of CORPUS.refused) expect(() => canonicalJson(JSON.parse(entry.json)), entry.name).toThrow(/lone surrogate/);
  });

  it("refuses what JSON cannot carry instead of dropping it", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
  });

  it("computes every corpus plan's expected canonical form and digest", () => {
    for (const entry of CORPUS.plans) {
      const subject = Object.fromEntries(Object.entries(entry.plan).filter(([key]) => !PLAN_DIGEST_EXCLUDED_FIELDS.includes(key)));
      expect(canonicalJson(subject), entry.name).toBe(entry.canonical);
      expect(planDigest(entry.plan), entry.name).toBe(entry.digest);
    }
  });

  it("gives the same digest across key order, asOf and decisions, and a different one when content changes", () => {
    const digest = (name: string) => planDigest(corpusPlan(name).plan);
    expect(digest("every-key-order-reversed")).toBe(digest("blockers-without-due"));
    expect(digest("later-asof-and-new-decisions")).toBe(digest("blockers-without-due"));
    expect(digest("roles-reordered")).not.toBe(digest("blockers-without-due"));
    expect(digest("unicode-decomposed")).not.toBe(digest("unicode-precomposed"));
  });

  it("covers kits, staffing, packages and resolution, and excludes a decision's subjectDigest (#1178)", () => {
    const digest = (name: string) => planDigest(corpusPlan(name).plan);
    const base = digest("staffed-with-packages");
    expect(digest("staffed-with-packages-keys-reversed")).toBe(base);
    expect(digest("staffed-with-packages-new-subject-digest")).toBe(base);
    for (const name of ["staffed-with-packages-version-changed", "staffed-with-packages-integrity-changed", "staffed-with-packages-staffing-reordered", "staffed-without-packages"]) {
      expect(digest(name), name).not.toBe(base);
    }
  });

  it("has no digest for an invalid plan", () => {
    const plan = { ...corpusPlan("blockers-without-due").plan, extra: true } as unknown as AdvisorPlan;
    expect(() => planDigest(plan)).toThrow(/invalid plan has no digest: plan has a field the contract does not declare \(key \d+ of this object\)/);
  });
});

describe("packed plan and brief contracts", () => {
  it("are the docs/contracts files, unchanged, with the registry snapshot, change-set and bundle contracts after them (#1178)", () => {
    expect(Object.keys(PLAN_CONTRACTS)).toEqual(["advisor-plan.json", "engagement-brief.json", "engagement-context.json", "registry-snapshot.json", "repository-change-set.json", "apply-bundle.json"]);
    for (const [name, contract] of Object.entries(PLAN_CONTRACTS)) expect(contract).toEqual(JSON.parse(read(`docs/contracts/${name}`)));
  });

  it("use only keywords the checker implements, in every subschema", () => {
    for (const contract of Object.values(PLAN_CONTRACTS)) expect(() => assertImplementedContract(contract)).not.toThrow();
  });

  it("carry a byte-identical copy of Advisor's one contract checker, under a generated-file header", () => {
    const copy = readFileSync(new URL("./generated/contract-schema.generated.ts", import.meta.url), "utf8");
    const canonical = read("packages/advisor/src/contract-schema.ts");
    expect(copy.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(copy.endsWith(canonical)).toBe(true);
    expect(copy.slice(0, copy.length - canonical.length).split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
  });
});
