import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalJson, planDigest } from "./plan-digest.js";

/*
 * Issue #1586. This package's own implementation of the canonical plan
 * digest, checked against the shared corpus every other reader of a plan is
 * tested against, so all of them compute identical digests. Reading the
 * repository's docs here is test-only: nothing at runtime leaves this package.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

interface DigestCorpus {
  canonicalJson: { name: string; value: unknown; canonical: string }[];
  refused: { name: string; json: string }[];
  plans: { name: string; plan: Record<string, unknown> & { decisions: { subjectDigest?: string }[] }; canonical: string; digest: string }[];
}
const CORPUS = JSON.parse(read("docs/contracts/advisor-plan-digest.fixture.json")) as DigestCorpus;
const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!;

describe("canonical plan digest", () => {
  it("excludes exactly asOf and decisions", () => {
    expect(PLAN_DIGEST_EXCLUDED_FIELDS).toEqual(["asOf", "decisions"]);
  });

  it("serializes every corpus value to its expected canonical JSON", () => {
    expect(CORPUS.canonicalJson.length).toBeGreaterThan(0);
    for (const entry of CORPUS.canonicalJson) expect(canonicalJson(entry.value), entry.name).toBe(entry.canonical);
  });

  it("refuses every corpus value that is not well-formed Unicode", () => {
    expect(CORPUS.refused.length).toBeGreaterThan(0);
    for (const entry of CORPUS.refused) expect(() => canonicalJson(JSON.parse(entry.json)), entry.name).toThrow(/lone surrogate/);
  });

  it("refuses what JSON cannot carry instead of dropping it", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
    expect(() => canonicalJson(Symbol("x"))).toThrow(TypeError);
    expect(() => canonicalJson([1, , 3])).toThrow(TypeError);
  });

  it("writes negative zero as 0 and sorts keys by UTF-16 code units", () => {
    expect(canonicalJson(-0)).toBe("0");
    // U+1F600 is the surrogate pair D83D DE00, which sorts before U+FF5E by UTF-16 code units, though its code point is greater.
    expect(canonicalJson({ b: 1, a: 2, "\u{1F600}": 3, "\uFF5E": 4 })).toBe('{"a":2,"b":1,"\u{1F600}":3,"\uFF5E":4}');
  });

  it("computes every corpus plan's expected canonical form and digest", () => {
    expect(CORPUS.plans.length).toBeGreaterThan(0);
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

  it("covers kits, staffing, packages and resolution, and excludes a decision's subjectDigest", () => {
    const digest = (name: string) => planDigest(corpusPlan(name).plan);
    const base = digest("staffed-with-packages");
    expect(digest("staffed-with-packages-keys-reversed")).toBe(base);
    expect(digest("staffed-with-packages-new-subject-digest")).toBe(base);
    for (const name of ["staffed-with-packages-version-changed", "staffed-with-packages-integrity-changed", "staffed-with-packages-staffing-reordered", "staffed-without-packages"]) {
      expect(digest(name), name).not.toBe(base);
    }
  });

  it("covers delegatedCopyApproval and its scopes, and excludes asOf and decisions from them", () => {
    const digest = (name: string) => planDigest(corpusPlan(name).plan);
    const scoped = digest("delegated-copy-approval-scoped");
    expect(digest("delegated-copy-approval-unscoped")).not.toBe(digest("blockers-without-due"));
    expect(scoped).not.toBe(digest("delegated-copy-approval-unscoped"));
    expect(digest("delegated-copy-approval-scoped-keys-reversed")).toBe(scoped);
    expect(digest("delegated-copy-approval-scoped-new-decisions")).toBe(scoped);
    expect(digest("delegated-copy-approval-scopes-reordered")).not.toBe(scoped);
    expect(digest("delegated-copy-approval-scope-widened")).not.toBe(scoped);
    expect(digest("delegated-copy-approval-removed")).toBe(digest("blockers-without-due"));
    expect(corpusPlan("delegated-copy-approval-scoped").plan.decisions[0]?.subjectDigest).toBe(scoped);
  });

  it("has no digest for an invalid plan", () => {
    const plan = { ...corpusPlan("blockers-without-due").plan, extra: true };
    expect(() => planDigest(plan)).toThrow(/invalid plan has no digest: plan has a field the contract does not declare \(key \d+ of this object\)/);
    expect(() => planDigest(undefined)).toThrow(/invalid plan has no digest/);
  });
});
