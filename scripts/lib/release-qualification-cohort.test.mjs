import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TRIO, TRIO_COHORT_PATH, TRIO_QUARANTINE_PATH, TRIO_RELEASE, validateTrioPartialFailureQuarantine, validateTrioPrepublicationCohort } from "./release-qualification-cohort.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const hex = (character, length) => character.repeat(length);
function fixture() {
  const records = new Map(), recordBytes = new Map();
  const members = TRIO.map((packageKey, index) => {
    const candidate = { name: `@clossys/${packageKey}`, version: `1.0.${index}`, tarball: { sha1: hex(String(index + 1), 40), sha256: hex(String(index + 2), 64), sha512: hex(String(index + 3), 128) } };
    const qualificationPath = `governance/release-qualifications/clossys-${packageKey}-${candidate.version}.json`;
    const record = { timing: "pre-publication", candidate };
    const bytes = JSON.stringify(record);
    records.set(qualificationPath, record); recordBytes.set(qualificationPath, bytes);
    return { packageKey, qualificationPath, qualificationSha256: sha(bytes), candidate };
  });
  return { cohort: { schemaVersion: 1, kind: "clossys-npmjs-trio-prepublication-v1", id: "clossys-npmjs-trio", release: structuredClone(TRIO_RELEASE), members }, records, recordBytes };
}

test("the future Trio cohort is closed, ordered, and joins exact namespaced records", () => {
  const value = fixture();
  assert.deepEqual(validateTrioPrepublicationCohort(value.cohort, value), []);
});

test("the cohort rejects reordered, partial, extra, historical, and digest-substituted members", () => {
  for (const mutate of [
    (copy) => { copy.members.reverse(); },
    (copy) => { copy.members.pop(); },
    (copy) => { copy.members.push(structuredClone(copy.members[0])); },
    (copy) => { copy.members[0].candidate.name = "@acme/advisor"; },
    (copy) => { copy.members[1].qualificationSha256 = hex("f", 64); },
    (copy) => { copy.members[2].qualificationPath = "governance/release-qualifications/controller-1.0.2.json"; },
  ]) {
    const value = fixture(); mutate(value.cohort);
    assert.ok(validateTrioPrepublicationCohort(value.cohort, value).length > 0);
  }
});

test("partial failure quarantine is closed and only names the next ordered member", () => {
  const value = fixture(), bytes = JSON.stringify(value.cohort);
  const quarantine = { schemaVersion: 1, kind: "clossys-npmjs-trio-partial-failure-v1", cohortPath: TRIO_COHORT_PATH, cohortSha256: sha(bytes), release: structuredClone(TRIO_RELEASE), completedPackages: ["advisor"], failedPackage: "starter", disposition: "quarantined", reference: "public incident record" };
  assert.deepEqual(validateTrioPartialFailureQuarantine(quarantine, { cohortBytes: bytes }), []);
  assert.equal(TRIO_QUARANTINE_PATH, "governance/release-qualification-quarantines/clossys-npmjs-trio.json");
  for (const mutate of [(copy) => { copy.completedPackages = ["starter"]; }, (copy) => { copy.failedPackage = "controller"; }, (copy) => { copy.disposition = "resolved"; }, (copy) => { copy.cohortSha256 = hex("0", 64); }]) {
    const copy = structuredClone(quarantine); mutate(copy);
    assert.ok(validateTrioPartialFailureQuarantine(copy, { cohortBytes: bytes }).length > 0);
  }
});
