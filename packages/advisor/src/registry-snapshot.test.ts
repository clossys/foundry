import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract, readContractDocument } from "./contract-schema.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { canonicalJson, snapshotDigest, snapshotDigestSubject, validateRegistrySnapshot } from "./index.js";
import type { RegistrySnapshot } from "./index.js";

/*
 * Issue #1178: the registry snapshot contract, its code rules N1-N3 and its
 * digest, checked against the shared corpus
 * docs/contracts/registry-snapshot.fixture.json, whose expected values were
 * computed outside this package.
 */
const CONTRACTS = new URL("../../../docs/contracts/", import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, CONTRACTS), "utf8"));

interface Corpus {
  digests: { name: string; snapshot: RegistrySnapshot; canonical: string; digest: string }[];
  invalid: { name: string; snapshot: unknown; violations: { rule: string; path: string }[] }[];
}
const CORPUS = readJson("registry-snapshot.fixture.json") as Corpus;
const digestOf = (name: string) => CORPUS.digests.find((entry) => entry.name === name)!.digest;
const sorted = (items: readonly { rule: string; path: string }[]) => [...items].sort((left, right) => `${left.rule} ${left.path}`.localeCompare(`${right.rule} ${right.path}`));

describe("the packed registry snapshot contract", () => {
  it("is the docs/contracts file, unchanged, and uses only keywords the checker implements", () => {
    expect(PLAN_CONTRACTS["registry-snapshot.json"]).toEqual(readJson("registry-snapshot.json"));
    expect(() => assertImplementedContract(PLAN_CONTRACTS["registry-snapshot.json"]!)).not.toThrow();
  });

  it("declares the two package statuses, so a later value fails closed in this reader", () => {
    const definitions = PLAN_CONTRACTS["registry-snapshot.json"]!.definitions as Record<string, { properties: Record<string, { enum: unknown }> }>;
    expect(definitions.packageEntry!.properties.status!.enum).toEqual(["found", "not-found"]);
  });
});

describe("the snapshot digest corpus", () => {
  it("accepts every digest case, and reproduces its canonical subject and digest exactly", () => {
    for (const entry of CORPUS.digests) {
      expect(validateRegistrySnapshot(entry.snapshot), entry.name).toEqual([]);
      expect(canonicalJson(snapshotDigestSubject(entry.snapshot)), entry.name).toBe(entry.canonical);
      expect(snapshotDigest(entry.snapshot), entry.name).toBe(entry.digest);
    }
  });

  it("gives a re-fetch of the same selection the same digest: fetchedAt, fetchedBy, responseSha256 and order are left out", () => {
    expect(digestOf("base-refetched")).toBe(digestOf("base"));
    expect(digestOf("two-versions-reordered")).toBe(digestOf("two-versions"));
  });

  it("changes the digest when any field a resolution reads changes", () => {
    const changes = CORPUS.digests.filter((entry) => entry.name.startsWith("change-"));
    expect(changes.map((entry) => entry.name).sort()).toEqual(
      ["change-attestations", "change-deprecated", "change-integrity", "change-latest", "change-name", "change-published-at", "change-registry", "change-status", "change-tarball", "change-version"],
    );
    const digests = new Set([digestOf("base"), ...changes.map((entry) => entry.digest)]);
    expect(digests.size).toBe(changes.length + 1);
  });

  it("is computed from the subject only: editing an excluded field in place leaves it unchanged", () => {
    const base = structuredClone(CORPUS.digests.find((entry) => entry.name === "base")!.snapshot) as { -readonly [K in keyof RegistrySnapshot]: unknown };
    base.fetchedAt = "2030-01-01T00:00:00Z";
    base.fetchedBy = { name: "@example/fetcher", version: "9.9.9-beta.1" };
    expect(snapshotDigest(base as RegistrySnapshot)).toBe(digestOf("base"));
  });
});

describe("invalid snapshots", () => {
  it("refuses every invalid case with exactly the corpus's rules at the corpus's positions", () => {
    for (const entry of CORPUS.invalid) {
      expect(sorted(validateRegistrySnapshot(entry.snapshot).map(({ rule, path }) => ({ rule, path }))), entry.name).toEqual(sorted(entry.violations));
    }
  });

  it("has no digest for an invalid snapshot", () => {
    for (const entry of CORPUS.invalid) expect(() => snapshotDigest(entry.snapshot as RegistrySnapshot), entry.name).toThrow(/invalid registry snapshot has no digest/);
  });

  it("covers every code rule and the schema", () => {
    const rules = new Set(CORPUS.invalid.flatMap((entry) => entry.violations.map((violation) => violation.rule)));
    for (const rule of ["N1", "N2", "N3", "schema"]) expect(rules, rule).toContain(rule);
  });

  it("never quotes an undeclared key or a value in a message", () => {
    for (const entry of CORPUS.invalid) {
      for (const violation of validateRegistrySnapshot(entry.snapshot)) {
        expect(violation.message, entry.name).not.toMatch(/founderNote|never be quoted|private repository name|use something else|clossys\.registry-packument|2026-02-30/);
        expect(violation.path, entry.name).not.toMatch(/founderNote|private repository name/);
      }
    }
  });

  it("is read strictly: a snapshot file that repeats a key is refused before it is validated", () => {
    const text = JSON.stringify(CORPUS.digests[0]!.snapshot).replace('"registry":', '"registry":"https://registry.example.com","registry":');
    expect(() => readContractDocument(new TextEncoder().encode(text))).toThrow(/^repeats a key \(key \d+ of the top-level object\); every key may appear once$/);
  });
});
