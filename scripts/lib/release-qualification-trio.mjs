import { createHash } from "node:crypto";

export const TRIO = Object.freeze(["advisor", "starter", "controller"]);
export const TRIO_RELEASE = Object.freeze({ target: "clossys-npmjs", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" });
export const TRIO_COHORT_PATH = "governance/release-qualification-cohorts/clossys-npmjs-trio.json";
export const TRIO_QUARANTINE_PATH = "governance/release-qualification-quarantines/clossys-npmjs-trio.json";
export const TRIO_CONTROL_TAIL_AUTHORIZATION_PATH = "governance/release-qualification-tail-authorizations/clossys-npmjs-trio.json";
export const TRIO_CONTROL_TAIL_BASE_COMMIT = "9760d6b63ce9347aa528b5ba3625b924c792f9a2";
export const TRIO_CONTROL_TAIL_PATHS = Object.freeze([
  "docs/PUBLISHING.md",
  "scripts/check-candidate-qualification.mjs",
  "scripts/lib/candidate-qualification.mjs",
  "scripts/lib/candidate-qualification.test.mjs",
  "scripts/lib/release-qualification-cohort.mjs",
  "scripts/lib/release-qualification-trio.mjs",
]);

const SHA256 = /^[a-f0-9]{64}$/;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const finding = (findings, rule, message) => findings.push({ rule, message });

function closed(findings, value, keys, path) {
  if (!object(value)) { finding(findings, "shape", `${path} must be an object.`); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) finding(findings, "unknown-field", `${path}.${key}`);
}

/** Validate the immutable failure record shared by cohort and git-tail gates. */
export function validateTrioPartialFailureQuarantine(quarantine, { cohortBytes } = {}) {
  const findings = [];
  closed(findings, quarantine, ["schemaVersion", "kind", "cohortPath", "cohortSha256", "release", "completedPackages", "failedPackage", "disposition", "reference"], "quarantine");
  if (quarantine?.schemaVersion !== 1 || quarantine?.kind !== "clossys-npmjs-trio-partial-failure-v1" || quarantine?.cohortPath !== TRIO_COHORT_PATH || !SHA256.test(quarantine?.cohortSha256 ?? "") || quarantine?.disposition !== "quarantined" || !nonempty(quarantine?.reference)) finding(findings, "quarantine", "closed immutable partial-failure quarantine fields required.");
  closed(findings, quarantine?.release, ["target", "scope", "registry", "access"], "quarantine.release");
  if (!same(quarantine?.release, TRIO_RELEASE)) finding(findings, "release", "quarantine.release must retain the exact public npm Trio release tuple.");
  if (typeof cohortBytes !== "string" || digest(cohortBytes) !== quarantine?.cohortSha256) finding(findings, "cohort-digest", "quarantine must bind exact cohort bytes.");
  const completed = quarantine?.completedPackages;
  if (!Array.isArray(completed) || !same(completed, TRIO.slice(0, completed.length)) || completed.length >= TRIO.length) finding(findings, "completed", "completed packages must be a strict ordered Trio prefix.");
  if (quarantine?.failedPackage !== TRIO[completed?.length]) finding(findings, "failed-package", "failed package must be the next exact Trio member.");
  return findings;
}

export function isTrioCandidate(candidate) {
  return TRIO.some((key) => candidate?.name === `@clossys/${key}`);
}
