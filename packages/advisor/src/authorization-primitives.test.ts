import { describe, expect, it } from "vitest";
import { BASIS_DIGEST_FIELDS, BASIS_FIELDS, packageKey, sameBasis, sameStrings } from "./index.js";
import type { AssessmentBasis, ImmutablePackageRef } from "./types.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const integrity = (letter = "a") => `sha512-${letter.repeat(86)}==`;
function basis(overrides: Partial<AssessmentBasis> = {}): AssessmentBasis {
  return {
    snapshotDigest: hash("1"),
    grantDigest: hash("2"),
    catalogDigest: hash("3"),
    planDigest: hash("4"),
    blockerDigest: hash("5"),
    clearanceDigest: hash("6"),
    conflictDigest: hash("7"),
    baselineDigest: hash("8"),
    completionDefinitionDigest: hash("9"),
    assessedAt: "2026-08-24T12:00:00Z",
    freshUntil: "2026-08-31T12:00:00Z",
    ...overrides,
  };
}
function ref(overrides: Partial<ImmutablePackageRef> = {}): ImmutablePackageRef {
  return { name: "example-package", version: "1.2.3", integrity: integrity(), ...overrides };
}

describe("BASIS_FIELDS and BASIS_DIGEST_FIELDS", () => {
  it("BASIS_FIELDS is exactly BASIS_DIGEST_FIELDS plus the two timestamp fields, in a stable order", () => {
    expect(BASIS_FIELDS).toEqual([...BASIS_DIGEST_FIELDS, "assessedAt", "freshUntil"]);
  });

  it("BASIS_DIGEST_FIELDS contains only sha256 digest fields, none of the timestamps", () => {
    expect(BASIS_DIGEST_FIELDS).not.toContain("assessedAt");
    expect(BASIS_DIGEST_FIELDS).not.toContain("freshUntil");
    expect(BASIS_DIGEST_FIELDS).toHaveLength(9);
  });
});

describe("sameBasis", () => {
  it("is true for two independently constructed but field-identical bases", () => {
    expect(sameBasis(basis(), basis())).toBe(true);
  });

  it("is false when a single digest field differs", () => {
    expect(sameBasis(basis(), basis({ planDigest: hash("changed") }))).toBe(false);
  });

  it("is false when only the freshness window differs", () => {
    expect(sameBasis(basis(), basis({ freshUntil: "2026-09-30T12:00:00Z" }))).toBe(false);
    expect(sameBasis(basis(), basis({ assessedAt: "2026-08-20T12:00:00Z" }))).toBe(false);
  });

  it("treats digests as opaque strings rather than re-deriving them", () => {
    expect(sameBasis(basis({ snapshotDigest: "sha256:not-actually-hex" }), basis({ snapshotDigest: "sha256:not-actually-hex" }))).toBe(true);
  });
});

describe("sameStrings", () => {
  it("is true for the same values in a different order", () => {
    expect(sameStrings(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("is true for two empty arrays", () => {
    expect(sameStrings([], [])).toBe(true);
  });

  it("is false when lengths differ, even with an overlapping prefix", () => {
    expect(sameStrings(["a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("is false when an unmatched duplicate appears on one side", () => {
    expect(sameStrings(["a", "a", "b"], ["a", "b", "b"])).toBe(false);
  });

  it("does not mutate either input array", () => {
    const left = ["b", "a"];
    const right = ["a", "b"];
    sameStrings(left, right);
    expect(left).toEqual(["b", "a"]);
    expect(right).toEqual(["a", "b"]);
  });
});

describe("packageKey", () => {
  it("derives name@version#integrity", () => {
    expect(packageKey(ref())).toBe(`example-package@1.2.3#${integrity()}`);
  });

  it("differs when only the version changes", () => {
    expect(packageKey(ref({ version: "1.2.4" }))).not.toBe(packageKey(ref()));
  });

  it("differs when only the integrity value changes", () => {
    expect(packageKey(ref({ integrity: integrity("b") }))).not.toBe(packageKey(ref()));
  });

  it("differs when only the name changes", () => {
    expect(packageKey(ref({ name: "other-package" }))).not.toBe(packageKey(ref()));
  });

  it("combines with sameStrings to compare package-reference arrays independent of order", () => {
    const approved = [ref({ name: "package-one" }), ref({ name: "package-two", version: "2.0.0" })];
    const authorized = [approved[1] as ImmutablePackageRef, approved[0] as ImmutablePackageRef];
    expect(sameStrings(approved.map(packageKey), authorized.map(packageKey))).toBe(true);
    expect(sameStrings(approved.map(packageKey), [ref({ name: "package-three" })].map(packageKey))).toBe(false);
  });
});
