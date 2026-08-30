import { createHash } from "node:crypto";
import { publicNpmPackageUrl, PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";
import { TRIO, TRIO_COHORT_PATH, TRIO_RELEASE } from "./release-qualification-trio.mjs";

export const TRIO_PUBLICATION_PATH = "governance/release-publications/clossys-npmjs-trio.json";
export const TRIO_PUBLICATION_TRANSITION_BASE = "30519295222964c91b4f3b6af6cef8837c9c734f";
export const TRIO_PUBLICATION_TRANSITION_PATHS = Object.freeze([
  "README.md",
  "docs/DECISIONS.md",
  "docs/LIFECYCLE.md",
  "docs/PUBLISHING.md",
  "docs/contracts/package-evidence.json",
  TRIO_PUBLICATION_PATH,
  "package.json",
  "scripts/check-candidate-qualification.mjs",
  "scripts/check-package-evidence.mjs",
  "scripts/check-package-evidence.test.mjs",
  "scripts/lib/candidate-qualification.mjs",
  "scripts/lib/candidate-qualification.test.mjs",
  "scripts/lib/release-publication-cohort.mjs",
  "scripts/lib/release-publication-cohort.test.mjs",
]);

const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PUBLICATION_REFERENCE = "https://github.com/clossys/platform/issues/594#issuecomment-5467255442";
const MAX_TARBALL_BYTES = 20_000_000;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function finding(findings, rule, message) { findings.push({ rule, message }); }
function closed(findings, value, keys, path) {
  if (!object(value)) { finding(findings, "shape", `${path} must be an object.`); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) finding(findings, "unknown-field", `${path}.${key}`);
}
function canonicalInstant(value) {
  if (!CANONICAL_INSTANT.test(value ?? "")) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function candidateProjection(candidate) {
  return { name: candidate?.name, version: candidate?.version, tarball: candidate?.tarball };
}
function expectedTarballUrl(name, version) {
  const key = name.slice(name.indexOf("/") + 1);
  return `${PUBLIC_NPM_REGISTRY}/@clossys/${key}/-/${key}-${version}.tgz`;
}

/**
 * Validate the one-time atomic transition from sealed pre-publication state to
 * the retained publication/lifecycle state. The publication record is in the
 * exact change set but cannot digest itself; every other changed path is bound
 * byte-for-byte.
 */
export function validateTrioPublicationTransition(publication, { fileBytes = new Map() } = {}) {
  const findings = [];
  const transition = publication?.transition;
  closed(findings, transition, ["schemaVersion", "kind", "baseCommit", "reference", "changedPaths", "fileDigests"], "publication.transition");
  if (transition?.schemaVersion !== 1 || transition?.kind !== "clossys-npmjs-trio-publication-transition-v1") finding(findings, "transition", "closed Trio publication transition identity required.");
  if (transition?.baseCommit !== TRIO_PUBLICATION_TRANSITION_BASE) finding(findings, "transition-base", "publication transition must bind its exact sealed pre-publication base.");
  if (transition?.reference !== PUBLICATION_REFERENCE) finding(findings, "transition-reference", "publication transition must bind the exact owner evidence comment.");
  if (!same(transition?.changedPaths, TRIO_PUBLICATION_TRANSITION_PATHS)) finding(findings, "transition-paths", "publication transition must retain the exact ordered atomic changed path set.");

  const digestPaths = TRIO_PUBLICATION_TRANSITION_PATHS.filter((path) => path !== TRIO_PUBLICATION_PATH);
  if (!Array.isArray(transition?.fileDigests) || transition.fileDigests.length !== digestPaths.length) {
    finding(findings, "transition-digests", "publication transition must bind every non-record changed path exactly once and must not self-digest.");
    return findings;
  }
  for (let index = 0; index < digestPaths.length; index += 1) {
    const expectedPath = digestPaths[index];
    const entry = transition.fileDigests[index];
    closed(findings, entry, ["path", "sha256"], `publication.transition.fileDigests[${index}]`);
    const bytes = fileBytes instanceof Map ? fileBytes.get(expectedPath) : undefined;
    if (entry?.path !== expectedPath || !SHA256.test(entry?.sha256 ?? "") || typeof bytes !== "string" || digest(bytes) !== entry?.sha256) finding(findings, "transition-digest", `publication transition must bind exact bytes for ${expectedPath}.`);
  }
  return findings;
}

/**
 * Validate the immutable first-publication record without contacting npm.
 * The anonymous proof is joined to the exact sealed qualification bytes, so
 * it cannot substitute a different registry artifact or rewrite pre-publication
 * evidence. Provenance is deliberately outside this owner-present record.
 */
export function validateTrioFirstPublication(publication, {
  cohort,
  cohortBytes,
  records = new Map(),
  recordBytes = new Map(),
  validatedRecordPaths = new Set(),
} = {}) {
  const findings = [];
  closed(findings, publication, ["schemaVersion", "kind", "id", "release", "cohort", "members", "transition"], "publication");
  if (publication?.schemaVersion !== 1 || publication?.kind !== "clossys-npmjs-trio-first-publication-v1" || publication?.id !== "clossys-npmjs-trio") finding(findings, "publication", "closed Trio first-publication identity required.");
  closed(findings, publication?.release, ["target", "scope", "registry", "access"], "publication.release");
  if (!same(publication?.release, TRIO_RELEASE)) finding(findings, "release", "publication.release must retain the exact public npm Trio release tuple.");

  closed(findings, publication?.cohort, ["path", "sha256"], "publication.cohort");
  if (publication?.cohort?.path !== TRIO_COHORT_PATH || !SHA256.test(publication?.cohort?.sha256 ?? "") || typeof cohortBytes !== "string" || digest(cohortBytes) !== publication?.cohort?.sha256) finding(findings, "cohort-digest", "publication must bind the exact retained pre-publication cohort bytes.");

  if (!Array.isArray(publication?.members) || publication.members.length !== TRIO.length || !Array.isArray(cohort?.members) || cohort.members.length !== TRIO.length) {
    finding(findings, "members", "publication and retained cohort must contain the exact ordered Trio.");
    return findings;
  }

  let previousPublishedAt = null;
  for (let index = 0; index < TRIO.length; index += 1) {
    const key = TRIO[index], member = publication.members[index], cohortMember = cohort.members[index];
    const path = `publication.members[${index}]`;
    closed(findings, member, ["packageKey", "qualification", "publication", "registryProof"], path);
    if (member?.packageKey !== key || cohortMember?.packageKey !== key) finding(findings, "member-order", `${path} must retain ${key} in fixed Trio order.`);

    closed(findings, member?.qualification, ["path", "sha256"], `${path}.qualification`);
    const qualificationPath = member?.qualification?.path;
    const qualificationSha256 = member?.qualification?.sha256;
    if (!SHA256.test(qualificationSha256 ?? "") || qualificationPath !== cohortMember?.qualificationPath || qualificationSha256 !== cohortMember?.qualificationSha256) finding(findings, "qualification", `${path} must bind the exact cohort qualification path and digest.`);
    const record = records.get(qualificationPath), bytes = recordBytes.get(qualificationPath);
    if (!record || typeof bytes !== "string" || digest(bytes) !== qualificationSha256 || !(validatedRecordPaths instanceof Set) || !validatedRecordPaths.has(qualificationPath)) finding(findings, "qualification-record", `${path} must join one fully validated retained qualification record.`);

    closed(findings, member?.publication, ["mode", "publishedAt", "reference", "disposition"], `${path}.publication`);
    const publishedAt = member?.publication?.publishedAt;
    if (member?.publication?.mode !== "owner-present" || member?.publication?.reference !== PUBLICATION_REFERENCE || member?.publication?.disposition !== "published-verified" || !canonicalInstant(publishedAt)) finding(findings, "publication-evidence", `${path} must retain the owner-present publication reference, canonical time, and verified disposition.`);
    if (canonicalInstant(publishedAt) && previousPublishedAt !== null && Date.parse(publishedAt) <= previousPublishedAt) finding(findings, "publication-order", `${path} must have been published after the prior Trio member.`);
    if (canonicalInstant(publishedAt)) previousPublishedAt = Date.parse(publishedAt);

    const proof = member?.registryProof;
    closed(findings, proof, ["schemaVersion", "kind", "evidence"], `${path}.registryProof`);
    if (proof?.schemaVersion !== 1 || proof?.kind !== "public-npm-anonymous-registry-proof-v1") finding(findings, "registry-proof", `${path} must retain one closed anonymous public npm proof.`);
    const evidence = proof?.evidence;
    const evidenceFields = ["registry", "access", "name", "version", "packumentUrl", "tarballUrl", "integrity", "shasum", "sha256", "sha512", "packedManifestSha256", "size"];
    closed(findings, evidence, evidenceFields, `${path}.registryProof.evidence`);
    const candidate = record?.candidate;
    if (!same(candidateProjection(candidate), cohortMember?.candidate)) finding(findings, "candidate-join", `${path} must join the exact candidate projection retained by the cohort.`);
    const expectedIntegrity = typeof candidate?.tarball?.sha512 === "string" ? `sha512-${Buffer.from(candidate.tarball.sha512, "hex").toString("base64")}` : null;
    if (evidence?.registry !== PUBLIC_NPM_REGISTRY || evidence?.access !== "anonymous" || evidence?.name !== candidate?.name || evidence?.version !== candidate?.version || evidence?.packumentUrl !== publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, candidate?.name) || evidence?.tarballUrl !== expectedTarballUrl(candidate?.name ?? "", candidate?.version ?? "") || evidence?.integrity !== expectedIntegrity || evidence?.shasum !== candidate?.tarball?.sha1 || evidence?.sha256 !== candidate?.tarball?.sha256 || evidence?.sha512 !== candidate?.tarball?.sha512 || evidence?.packedManifestSha256 !== candidate?.packageManifestSha256 || !Number.isSafeInteger(evidence?.size) || evidence.size < 1 || evidence.size > MAX_TARBALL_BYTES) finding(findings, "registry-join", `${path} anonymous registry proof must exactly match the sealed candidate identity, tarball, and packed manifest.`);
  }
  return findings;
}
