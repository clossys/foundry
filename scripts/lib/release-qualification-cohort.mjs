import { createHash } from "node:crypto";

export const TRIO = Object.freeze(["advisor", "starter", "controller"]);
export const TRIO_RELEASE = Object.freeze({ target: "clossys-npmjs", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" });
export const TRIO_COHORT_PATH = "governance/release-qualification-cohorts/clossys-npmjs-trio.json";
export const TRIO_QUARANTINE_PATH = "governance/release-qualification-quarantines/clossys-npmjs-trio.json";

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function finding(findings, rule, message) { findings.push({ rule, message }); }
function closed(findings, value, keys, path) {
  if (!object(value)) { finding(findings, "shape", `${path} must be an object.`); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) finding(findings, "unknown-field", `${path}.${key}`);
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function release(findings, value, path) {
  closed(findings, value, ["target", "scope", "registry", "access"], path);
  if (!same(value, TRIO_RELEASE)) finding(findings, "release", `${path} must retain the exact public npm Trio release tuple.`);
}
function memberPath(key, version) { return `governance/release-qualifications/clossys-${key}-${version}.json`; }

/**
 * Validate an uninstantiated, future-only atomic Trio qualification cohort.
 * The cohort contains no authority to upload: it joins three independent
 * pre-publication records only after their exact future tarball bytes exist.
 */
export function validateTrioPrepublicationCohort(cohort, { records = new Map(), recordBytes = new Map() } = {}) {
  const findings = [];
  closed(findings, cohort, ["schemaVersion", "kind", "id", "release", "members"], "cohort");
  if (cohort?.schemaVersion !== 1 || cohort?.kind !== "clossys-npmjs-trio-prepublication-v1" || cohort?.id !== "clossys-npmjs-trio") finding(findings, "cohort", "closed Trio cohort identity required.");
  release(findings, cohort?.release, "cohort.release");
  if (!Array.isArray(cohort?.members) || cohort.members.length !== TRIO.length) {
    finding(findings, "members", "the cohort must contain the exact ordered Trio.");
    return findings;
  }
  for (let index = 0; index < TRIO.length; index += 1) {
    const key = TRIO[index], member = cohort.members[index];
    closed(findings, member, ["packageKey", "qualificationPath", "qualificationSha256", "candidate"], `cohort.members[${index}]`);
    if (member?.packageKey !== key || !SHA256.test(member?.qualificationSha256 ?? "")) finding(findings, "member", `cohort member ${index} must be ${key} with an exact record digest.`);
    closed(findings, member?.candidate, ["name", "version", "tarball"], `cohort.members[${index}].candidate`);
    closed(findings, member?.candidate?.tarball, ["sha1", "sha256", "sha512"], `cohort.members[${index}].candidate.tarball`);
    const candidate = member?.candidate;
    if (candidate?.name !== `@clossys/${key}` || !VERSION.test(candidate?.version ?? "") || !SHA1.test(candidate?.tarball?.sha1 ?? "") || !SHA256.test(candidate?.tarball?.sha256 ?? "") || !SHA512.test(candidate?.tarball?.sha512 ?? "")) finding(findings, "candidate", `cohort member ${key} must retain an exact @clossys candidate identity and tarball tuple.`);
    if (member?.qualificationPath !== memberPath(key, candidate?.version)) finding(findings, "member-path", `cohort member ${key} must use its namespace-qualified record path.`);
    const record = records.get(member?.qualificationPath);
    const bytes = recordBytes.get(member?.qualificationPath);
    if (!record || typeof bytes !== "string") { finding(findings, "record", `cohort member ${key} record bytes are required.`); continue; }
    if (digest(bytes) !== member.qualificationSha256) finding(findings, "record-digest", `cohort member ${key} record digest differs from retained bytes.`);
    if (record.timing !== "pre-publication" || !same(record.candidate, candidate)) finding(findings, "record-join", `cohort member ${key} must join one exact pre-publication record.`);
  }
  return findings;
}

/** A partial execution is terminally quarantined, never reinterpreted as a Trio release. */
export function validateTrioPartialFailureQuarantine(quarantine, { cohortBytes } = {}) {
  const findings = [];
  closed(findings, quarantine, ["schemaVersion", "kind", "cohortPath", "cohortSha256", "release", "completedPackages", "failedPackage", "disposition", "reference"], "quarantine");
  if (quarantine?.schemaVersion !== 1 || quarantine?.kind !== "clossys-npmjs-trio-partial-failure-v1" || quarantine?.cohortPath !== TRIO_COHORT_PATH || !SHA256.test(quarantine?.cohortSha256 ?? "") || quarantine?.disposition !== "quarantined" || !nonempty(quarantine?.reference)) finding(findings, "quarantine", "closed immutable partial-failure quarantine fields required.");
  release(findings, quarantine?.release, "quarantine.release");
  if (typeof cohortBytes === "string" && digest(cohortBytes) !== quarantine?.cohortSha256) finding(findings, "cohort-digest", "quarantine must bind exact cohort bytes.");
  const completed = quarantine?.completedPackages;
  if (!Array.isArray(completed) || !same(completed, TRIO.slice(0, completed.length)) || completed.length >= TRIO.length) finding(findings, "completed", "completed packages must be a strict ordered Trio prefix.");
  if (quarantine?.failedPackage !== TRIO[completed?.length]) finding(findings, "failed-package", "failed package must be the next exact Trio member.");
  return findings;
}

export function isTrioCandidate(candidate) {
  return TRIO.some((key) => candidate?.name === `@clossys/${key}`);
}
