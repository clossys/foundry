import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TRIO, TRIO_COHORT_PATH, TRIO_QUARANTINE_PATH, TRIO_RELEASE, validateTrioPartialFailureQuarantine, validateTrioPrepublicationCohort, validateTrioQualificationState } from "./release-qualification-cohort.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const hex = (character, length) => character.repeat(length);
function schemaV2Record(candidate, index) {
  const record = JSON.parse(readFileSync("governance/release-qualifications/controller-0.8.20.json", "utf8"));
  record.timing = "pre-publication";
  record.reviewedCommit = hex(String(index + 4), 40);
  record.rootPackageJsonSha256 = hex(String(index + 5), 64);
  record.rootPackageLockSha256 = hex(String(index + 6), 64);
  record.candidateReview = { headSha: record.reviewedCommit, reference: "fixture review" };
  delete record.publishedCommit;
  delete record.registry;
  record.candidate.name = candidate.name;
  record.candidate.version = candidate.version;
  record.candidate.tarball = structuredClone(candidate.tarball);
  record.transcript.candidate = { name: candidate.name, version: candidate.version };
  record.transcript.tarball = structuredClone(candidate.tarball);
  const transcript = structuredClone(record.transcript);
  delete transcript.canonicalSha256;
  record.transcript.canonicalSha256 = sha(JSON.stringify(transcript));
  return record;
}
function fixture() {
  const records = new Map(), recordBytes = new Map(), validatedRecordPaths = new Set();
  const members = TRIO.map((packageKey, index) => {
    const candidate = { name: `@clossys/${packageKey}`, version: `1.0.${index}`, tarball: { sha1: hex(String(index + 1), 40), sha256: hex(String(index + 2), 64), sha512: hex(String(index + 3), 128) } };
    const qualificationPath = `governance/release-qualifications/clossys-${packageKey}-${candidate.version}.json`;
    const record = schemaV2Record(candidate, index);
    const bytes = JSON.stringify(record);
    records.set(qualificationPath, record); recordBytes.set(qualificationPath, bytes); validatedRecordPaths.add(qualificationPath);
    return { packageKey, qualificationPath, qualificationSha256: sha(bytes), candidate };
  });
  return { cohort: { schemaVersion: 1, kind: "clossys-npmjs-trio-prepublication-v1", id: "clossys-npmjs-trio", release: structuredClone(TRIO_RELEASE), members }, records, recordBytes, validatedRecordPaths };
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

test("the cohort requires the exact projection from a fully validated schema-v2 record", () => {
  const value = fixture();
  const path = value.cohort.members[0].qualificationPath;
  assert.deepEqual(validateTrioPrepublicationCohort(value.cohort, { ...value, validatedRecordPaths: new Set() }).map((item) => item.rule), ["record-validation", "record-validation", "record-validation"]);
  value.records.get(path).schemaVersion = 3;
  assert.ok(validateTrioPrepublicationCohort(value.cohort, value).some((item) => item.rule === "record-validation"));
  const fresh = fixture();
  fresh.cohort.members[0].candidate.tarball.sha256 = "0".repeat(64);
  assert.ok(validateTrioPrepublicationCohort(fresh.cohort, fresh).some((item) => item.rule === "record-join"));
});

test("orphaned cohort state and cohort-plus-quarantine without an exact joined Trio fail", () => {
  const value = fixture();
  const quarantine = { schemaVersion: 1, kind: "clossys-npmjs-trio-partial-failure-v1", cohortPath: TRIO_COHORT_PATH, cohortSha256: sha(JSON.stringify(value.cohort)), release: structuredClone(TRIO_RELEASE), completedPackages: [], failedPackage: "advisor", disposition: "quarantined", reference: "public incident record" };
  assert.ok(validateTrioQualificationState({ cohort: value.cohort, cohortBytes: JSON.stringify(value.cohort), records: new Map(), recordBytes: new Map(), validatedRecordPaths: new Set() }).length > 0);
  assert.ok(validateTrioQualificationState({ cohort: value.cohort, cohortBytes: JSON.stringify(value.cohort), quarantine, records: new Map(), recordBytes: new Map(), validatedRecordPaths: new Set() }).length > 0);
  assert.ok(validateTrioQualificationState({ records: value.records, recordBytes: value.recordBytes, validatedRecordPaths: value.validatedRecordPaths }).some((item) => item.rule === "trio-cohort"));
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
