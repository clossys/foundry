import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseStrictJson } from "./candidate-qualification.mjs";
import {
  TRIO_PUBLICATION_PATH,
  TRIO_PUBLICATION_TRANSITION_BASE,
  TRIO_PUBLICATION_TRANSITION_PATHS,
  validateTrioFirstPublication,
  validateTrioPublicationTransition,
} from "./release-publication-cohort.mjs";
import { TRIO, TRIO_COHORT_PATH } from "./release-qualification-trio.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const publicationBytes = read(TRIO_PUBLICATION_PATH);
const cohortBytes = read(TRIO_COHORT_PATH);
const publication = parseStrictJson(publicationBytes);
const cohort = parseStrictJson(cohortBytes);
const qualificationPaths = cohort.members.map((member) => member.qualificationPath);
const recordBytes = new Map(qualificationPaths.map((path) => [path, read(path)]));
const records = new Map([...recordBytes].map(([path, bytes]) => [path, parseStrictJson(bytes)]));
const transitionFileBytes = new Map(TRIO_PUBLICATION_TRANSITION_PATHS
  .filter((path) => path !== TRIO_PUBLICATION_PATH)
  .map((path) => [path, read(path)]));

function context(overrides = {}) {
  return {
    cohort,
    cohortBytes,
    records,
    recordBytes,
    validatedRecordPaths: new Set(qualificationPaths),
    ...overrides,
  };
}

function rules(value, overrides) {
  return validateTrioFirstPublication(value, context(overrides)).map((item) => item.rule);
}

function changed(mutator) {
  const value = structuredClone(publication);
  mutator(value);
  return value;
}

test("retained first-publication record joins the exact sealed Trio and anonymous public npm artifacts", () => {
  assert.deepEqual(validateTrioFirstPublication(publication, context()), []);
  assert.deepEqual(publication.members.map((member) => member.packageKey), TRIO);
});

test("publication record closes one exact atomic transition from the sealed pre-publication base", () => {
  assert.equal(TRIO_PUBLICATION_TRANSITION_BASE, "30519295222964c91b4f3b6af6cef8837c9c734f");
  assert.deepEqual(publication.transition.changedPaths, TRIO_PUBLICATION_TRANSITION_PATHS);
  assert.equal(publication.transition.fileDigests.some(({ path }) => path === TRIO_PUBLICATION_PATH), false);
  assert.deepEqual(validateTrioPublicationTransition(publication, { fileBytes: transitionFileBytes }), []);
});

test("publication transition fails closed on base, reference, path, digest, and shape drift", () => {
  const transitionRules = (value, fileBytes = transitionFileBytes) => validateTrioPublicationTransition(value, { fileBytes }).map((item) => item.rule);
  assert.ok(transitionRules(changed((value) => { value.transition.baseCommit = "0".repeat(40); })).includes("transition-base"));
  assert.ok(transitionRules(changed((value) => { value.transition.reference = "https://example.invalid"; })).includes("transition-reference"));
  assert.ok(transitionRules(changed((value) => { value.transition.changedPaths.reverse(); })).includes("transition-paths"));
  assert.ok(transitionRules(changed((value) => { value.transition.fileDigests.reverse(); })).includes("transition-digest"));
  assert.ok(transitionRules(changed((value) => { value.transition.fileDigests[0].sha256 = "0".repeat(64); })).includes("transition-digest"));
  assert.ok(transitionRules(changed((value) => { value.transition.fileDigests.push({ path: TRIO_PUBLICATION_PATH, sha256: "0".repeat(64) }); })).includes("transition-digests"));
  assert.ok(transitionRules(changed((value) => { value.transition.extra = true; })).includes("unknown-field"));
  const missingBytes = new Map(transitionFileBytes);
  missingBytes.delete(TRIO_PUBLICATION_TRANSITION_PATHS[0]);
  assert.ok(transitionRules(publication, missingBytes).includes("transition-digest"));
});

test("first-publication record is closed, ordered, and bound to immutable qualification bytes", () => {
  assert.ok(rules(changed((value) => { value.provenance = {}; })).includes("unknown-field"));
  assert.ok(rules(changed((value) => { value.members[0].provenance = {}; })).includes("unknown-field"));
  assert.ok(rules(changed((value) => { value.cohort.sha256 = "0".repeat(64); })).includes("cohort-digest"));
  assert.ok(rules(changed((value) => { value.members.reverse(); })).includes("member-order"));
  assert.ok(rules(changed((value) => { value.members.pop(); })).includes("members"));
  assert.ok(rules(changed((value) => { value.members[0].qualification.path = qualificationPaths[1]; })).includes("qualification"));
  assert.ok(rules(changed((value) => { value.members[0].qualification.sha256 = "0".repeat(64); })).includes("qualification"));
  assert.ok(rules(publication, { validatedRecordPaths: new Set() }).includes("qualification-record"));
  assert.ok(rules(publication, { records: new Map() }).includes("qualification-record"));
  const alteredBytes = new Map(recordBytes);
  alteredBytes.set(qualificationPaths[0], `${recordBytes.get(qualificationPaths[0])}\n`);
  assert.ok(rules(publication, { recordBytes: alteredBytes }).includes("qualification-record"));
});

test("publication evidence retains exact owner-present chronology", () => {
  assert.ok(rules(changed((value) => { value.members[0].publication.mode = "automated"; })).includes("publication-evidence"));
  assert.ok(rules(changed((value) => { value.members[0].publication.reference = "https://example.invalid"; })).includes("publication-evidence"));
  assert.ok(rules(changed((value) => { value.members[0].publication.disposition = "published"; })).includes("publication-evidence"));
  assert.ok(rules(changed((value) => { value.members[0].publication.publishedAt = "2026-99-30T06:31:58.838Z"; })).includes("publication-evidence"));
  assert.ok(rules(changed((value) => { value.members[1].publication.publishedAt = value.members[0].publication.publishedAt; })).includes("publication-order"));
});

test("anonymous registry proof cannot drift from the sealed candidate artifact", () => {
  const mutations = [
    (evidence) => { evidence.registry = "https://registry.example.invalid"; },
    (evidence) => { evidence.access = "authenticated"; },
    (evidence) => { evidence.name = "@clossys/other"; },
    (evidence) => { evidence.version = "9.9.9"; },
    (evidence) => { evidence.packumentUrl += "/drift"; },
    (evidence) => { evidence.tarballUrl += "/drift"; },
    (evidence) => { evidence.integrity = "sha512-drift"; },
    (evidence) => { evidence.shasum = "0".repeat(40); },
    (evidence) => { evidence.sha256 = "0".repeat(64); },
    (evidence) => { evidence.sha512 = "0".repeat(128); },
    (evidence) => { evidence.packedManifestSha256 = "0".repeat(64); },
    (evidence) => { evidence.size = 0; },
  ];
  for (const mutate of mutations) {
    const value = changed((candidate) => mutate(candidate.members[0].registryProof.evidence));
    assert.ok(rules(value).includes("registry-join"));
  }
  assert.ok(rules(changed((value) => { value.members[0].registryProof.kind = "other"; })).includes("registry-proof"));
});

test("retained cohort candidate projection remains an exact join", () => {
  const changedCohort = structuredClone(cohort);
  changedCohort.members[0].candidate.version = "9.9.9";
  assert.ok(rules(publication, { cohort: changedCohort }).includes("candidate-join"));
});
