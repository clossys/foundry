import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  ALL_PACKAGE_RELEASE_ORDER,
  AGGREGATE_EXTERNAL_TIMEOUT_MS,
  AggregateUnavailableError,
  assertAggregateRuntime,
  containedRegularDirectory,
  immutableRecordHistory,
  immutableRecordPaths,
  publicationCandidate,
} from "./public-npm-aggregate-canary.mjs";
import {
  strictQualificationIntroductionAncestor,
  trustedProvenanceSourceValid,
  trustedReplaySourceEvidence,
  validateLaterPublication,
} from "./release-later-publication.mjs";
import { currentQualificationJoins, qualificationPath, validateCandidateQualification } from "./candidate-qualification.mjs";
import { assertCredentialFree } from "./candidate-runner.mjs";
import { PUBLIC_NPM_REGISTRY, verifyPublicNpmArtifact } from "./public-npm-registry.mjs";

export const AGGREGATE_V2_CANARY_PATH = "governance/public-npm-aggregate-canary-v2.json";
export const AGGREGATE_V2_CLOSURE_DIRECTORY = "governance/public-npm-aggregate-closures-v2";
export const AGGREGATE_V2_TRANSCRIPT_DIRECTORY = "governance/public-npm-aggregate-transcripts-v2";
export const AGGREGATE_V2_SET = "current-release";
export const CURRENT_AGGREGATE_V2_RELEASES = Object.freeze([
  ["advisor", "0.1.6"], ["starter", "0.1.5"], ["controller", "0.8.24"], ["strategist", "0.1.2"], ["writer", "0.3.3"],
  ["designer", "0.2.7"], ["architect", "0.1.3"], ["bouncer", "0.1.2"], ["butler", "0.1.2"], ["giver", "0.1.3"],
  ["influencer", "0.1.3"], ["integrator", "0.6.3"], ["keeper", "0.1.3"], ["locksmith", "0.1.7"], ["messenger", "0.1.3"],
  ["observer", "0.2.4"], ["builder", "0.7.4"], ["inspector", "0.1.19"], ["publisher", "0.2.1"],
].map(function ([packageKey, version]) { return Object.freeze({ packageKey, name: "@clossys/" + packageKey, version }); }));

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const CLOSSID_SUBPATH = /^@clossys\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const OPTIONAL_OUTCOME = new Set(["imports", "rejects"]);
const OPTIONAL_CONDITION = new Set(["default", "react-server"]);
const DIRECT_PEER_REQUESTS = Object.freeze({
  "@clerk/nextjs": "7.7.5", "@internationalized/date": "3.12.3", "@types/node": "22.20.1", "@types/react": "19.2.18",
  next: "16.3.1", react: "19.2.8", "react-aria-components": "1.20.0", "react-dom": "19.2.8", resend: "6.19.0", svix: "1.99.1",
  "tailwind-merge": "3.0.0", tailwindcss: "4.3.3", typescript: "6.0.3",
});
const DIRECT_PEER_DISPOSITIONS = Object.freeze([
  { name: "react", requested: ["18.3.1", "19.2.8"], resolved: "19.2.8", reason: "all reviewed declared ranges must accept the one aggregate React runtime" },
  { name: "react-dom", requested: ["18.3.1", "19.2.8"], resolved: "19.2.8", reason: "all reviewed declared ranges must accept the one aggregate React DOM runtime" },
]);
const hash = function (value) { return createHash("sha256").update(value).digest("hex"); };
const object = function (value) { return value !== null && typeof value === "object" && !Array.isArray(value); };
const own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
const exact = function (value, keys) { return object(value) && Object.keys(value).length === keys.length && keys.every(function (key) { return own(value, key); }); };
const stable = function (value) {
  return Array.isArray(value)
    ? value.map(stable)
    : object(value)
      ? Object.fromEntries(Object.keys(value).sort().map(function (key) { return [key, stable(value[key])]; }))
      : value;
};
const finding = function (findings, rule, message) { findings.push({ rule, message }); };
const candidateBytesEqual = function (left, right) {
  return Boolean(left && right && left.name === right.name && left.version === right.version
    && left.packageManifestSha256 === right.packageManifestSha256
    && left.tarball && right.tarball
    && left.tarball.sha1 === right.tarball.sha1
    && left.tarball.sha256 === right.tarball.sha256
    && left.tarball.sha512 === right.tarball.sha512);
};

export const canonicalJson = function (value) { return JSON.stringify(stable(value), null, 2) + "\n"; };
export function aggregateV2PlanSha256(plan) { return hash(JSON.stringify(stable({ path: AGGREGATE_V2_CANARY_PATH, plan }))); }
/**
 * The direct current-release policy is part of v2 itself.  This digest is
 * intentionally independent of v1 so no mutable package manifest or old
 * plan can silently alter an aggregate v2 result.
 */
export function aggregateV2PolicySha256(plan) { return hash(JSON.stringify(stable({ peerResolution: plan?.peerResolution, optionalPeerMatrix: plan?.optionalPeerMatrix }))); }
export function aggregateV2ClosurePath(digest) { return AGGREGATE_V2_CLOSURE_DIRECTORY + "/" + AGGREGATE_V2_SET + "-" + digest + ".json"; }
export function aggregateV2TranscriptPath(digest) { return AGGREGATE_V2_TRANSCRIPT_DIRECTORY + "/" + AGGREGATE_V2_SET + "-" + digest + ".json"; }
export function isAggregateV2ClosurePath(path) { return new RegExp("^" + AGGREGATE_V2_CLOSURE_DIRECTORY + "/" + AGGREGATE_V2_SET + "-[a-f0-9]{64}\\.json$").test(path ?? ""); }
export function isAggregateV2TranscriptPath(path) { return new RegExp("^" + AGGREGATE_V2_TRANSCRIPT_DIRECTORY + "/" + AGGREGATE_V2_SET + "-[a-f0-9]{64}\\.json$").test(path ?? ""); }
export function parseAggregateV2Cli(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "--closure" || !isAggregateV2ClosurePath(args[1])) throw new Error("usage: run-public-npm-aggregate-canary-v2.mjs --closure governance/public-npm-aggregate-closures-v2/current-release-<sha256>.json");
  return { closurePath: args[1] };
}
export function readAggregateV2Head(root, path) { return execFileSync("git", ["show", "HEAD:" + path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
export function aggregateV2ErrorExitCode(error) { return error instanceof AggregateUnavailableError ? 2 : 1; }
const readCommittedHead = function (path) { return readAggregateV2Head(process.cwd(), path); };

function parse(read, path) {
  try { return JSON.parse(read(path)); }
  catch { return null; }
}

function boundedExternal(label, callback, timeoutMs = AGGREGATE_EXTERNAL_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  return Promise.race([
    callback(controller.signal),
    new Promise(function (_, reject) {
      timer = setTimeout(function () {
        const unavailable = new AggregateUnavailableError(label + " timed out");
        controller.abort(unavailable);
        reject(unavailable);
      }, timeoutMs);
    }),
  ]).catch(function (error) {
    if (controller.signal.aborted) throw new AggregateUnavailableError(label + " timed out");
    throw error;
  }).finally(function () { clearTimeout(timer); });
}

function abortableFetch(fetchImpl, signal) {
  return function (url, options = {}) { return fetchImpl(url, { ...options, signal }); };
}

function gitHeadBlob(root, ref, path) {
  return execFileSync("git", ["show", ref + ":" + path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function gitBlobOid(root, ref, path) {
  try { return execFileSync("git", ["rev-parse", "--verify", ref + ":" + path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function commitParents(root, commit) {
  const [resolved, ...parents] = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/);
  if (resolved !== commit) throw new Error("unexpected retained-record commit");
  return parents;
}

function hasCommittedPathHistory(root, ref, path) {
  return execFileSync("git", ["log", "--full-history", "-1", "--format=%H", ref, "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
}

function headIntroduction(root, path) {
  const commits = execFileSync("git", ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) throw new Error(path + " must have one immutable introduction");
  const introduction = commits[0];
  const introduced = gitHeadBlob(root, introduction, path);
  const current = gitHeadBlob(root, "HEAD", path);
  if (hash(introduced) !== hash(current)) throw new Error(path + " HEAD bytes differ from their immutable introduction");
  const introducedBlob = gitBlobOid(root, introduction, path);
  const traversed = execFileSync("git", ["rev-list", "--full-history", introduction + "..HEAD", "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  for (const commit of traversed) {
    const parents = commitParents(root, commit);
    if (parents.length < 2 || gitBlobOid(root, commit, path) !== introducedBlob) throw new Error(path + " was touched after its introduction");
    for (const parent of parents) {
      const parentBlob = gitBlobOid(root, parent, path);
      if (parentBlob !== null && parentBlob !== introducedBlob) throw new Error(path + " was touched after its introduction");
      if (parentBlob === null && hasCommittedPathHistory(root, parent, path)) throw new Error(path + " was deleted after its introduction");
    }
  }
  return introduction;
}

/**
 * Replays the repository's complete later-publication validator strictly from
 * committed blobs.  The runner never substitutes a working-tree catalogue,
 * source policy, qualification, or publication record for this evidence.
 */
export function validateCommittedV2LaterPublication({ root, path, read = function (item) { return readAggregateV2Head(root, item); } } = {}) {
  const findings = [];
  try {
    if (typeof root !== "string" || !/^governance\/release-publications\/later\/[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(path ?? "")) throw new Error("later publication path is outside the closed namespace");
    const recordBytes = read(path);
    if (hash(recordBytes) !== hash(gitHeadBlob(root, "HEAD", path))) finding(findings, "publication-head-bytes", path + " differs from committed HEAD evidence");
    const record = JSON.parse(recordBytes);
    const publicationIntroduction = headIntroduction(root, path);
    const qualificationRecordPath = record?.qualification?.path;
    if (typeof qualificationRecordPath !== "string" || !/^governance\/release-qualifications\/[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(qualificationRecordPath)) throw new Error("publication qualification path is outside the closed namespace");
    const qualificationBytes = read(qualificationRecordPath);
    if (hash(qualificationBytes) !== hash(gitHeadBlob(root, "HEAD", qualificationRecordPath))) finding(findings, "qualification-head-bytes", qualificationRecordPath + " differs from committed HEAD evidence");
    const qualification = JSON.parse(qualificationBytes);
    const qualificationIntroduction = headIntroduction(root, qualificationRecordPath);
    if (qualificationRecordPath !== qualificationPath(root, qualification.candidate, publicationIntroduction)) throw new Error("publication qualification path does not match its immutable candidate policy");
    strictQualificationIntroductionAncestor(root, qualificationIntroduction, publicationIntroduction);
    const expectedQualification = {
      name: qualification.candidate?.name,
      version: qualification.candidate?.version,
      ...currentQualificationJoins(root, qualification.candidate, qualificationIntroduction),
    };
    const qualificationFindings = validateCandidateQualification(qualification, { expected: expectedQualification });
    const catalogBytes = gitHeadBlob(root, publicationIntroduction, "governance/release-catalog.json");
    const catalog = JSON.parse(catalogBytes);
    const currentCatalog = JSON.parse(read("governance/release-catalog.json"));
    const historical = record?.publication?.provenance?.repository === "https://github.com/clossys/" + "platform";
    const sourceValid = historical || trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, record?.publication?.provenance?.sourceSha);
    const replaySourceEvidence = record?.schemaVersion === 3 && record?.kind === "foundry-trusted-publication-replay-v3"
      ? trustedReplaySourceEvidence(root, qualification, qualificationIntroduction, publicationIntroduction, record?.source)
      : { valid: false };
    const publicationFindings = validateLaterPublication(record, {
      recordPath: path,
      recordBytes,
      qualification,
      qualificationBytes,
      qualificationPath: qualificationRecordPath,
      catalogBytes,
      catalog,
      currentCatalog,
      provenanceSourceValid: sourceValid,
      replaySourceEvidence,
    });
    for (const item of qualificationFindings) finding(findings, "publication-qualification-" + item.rule, item.message);
    for (const item of replaySourceEvidence.findings ?? []) finding(findings, "publication-" + item.rule, item.message);
    for (const item of publicationFindings) finding(findings, "publication-" + item.rule, item.message);
  } catch (error) {
    finding(findings, "publication-committed-validation", error instanceof Error ? error.message : "committed later-publication validation failed");
  }
  return findings;
}

function validOptionalOutcome(value) {
  return typeof value === "string"
    ? OPTIONAL_OUTCOME.has(value)
    : exact(value, Object.keys(value ?? {})) && Object.keys(value).length > 0
      && Object.entries(value).every(function ([condition, outcome]) { return OPTIONAL_CONDITION.has(condition) && OPTIONAL_OUTCOME.has(outcome); });
}

function validateDirectV2Policy(plan, findings) {
  const requested = plan.peerResolution?.requested;
  const disposition = plan.peerResolution?.disposition;
  if (!exact(plan.peerResolution, ["requested", "disposition"])
    || JSON.stringify(stable(requested)) !== JSON.stringify(stable(DIRECT_PEER_REQUESTS))
    || JSON.stringify(stable(disposition)) !== JSON.stringify(stable(DIRECT_PEER_DISPOSITIONS))) {
    finding(findings, "peer-resolution", "v2 must retain its one closed direct current-release peer-resolution policy");
  }
  const rows = plan.optionalPeerMatrix;
  if (!Array.isArray(rows) || rows.length !== CURRENT_AGGREGATE_V2_RELEASES.length) {
    finding(findings, "optional-peer-matrix", "v2 must retain exactly one direct optional-peer row for each current release");
    return;
  }
  let relationships = 0;
  for (const [index, row] of rows.entries()) {
    const selected = CURRENT_AGGREGATE_V2_RELEASES[index];
    const peers = row?.peers;
    if (!exact(row, ["set", "packageKey", "name", "version", "peers"])
      || row.set !== AGGREGATE_V2_SET || row.packageKey !== selected?.packageKey || row.name !== selected?.name || row.version !== selected?.version
      || !Array.isArray(peers) || new Set(peers.map(function (peer) { return peer?.peer; })).size !== peers.length) {
      finding(findings, "optional-peer-row", "v2 optional-peer rows must exactly match direct current-release identities");
      continue;
    }
    relationships += peers.length;
    for (const peer of peers) {
      if (!exact(peer, ["peer", "outcomes"]) || !NPM_PACKAGE.test(peer.peer ?? "") || !own(DIRECT_PEER_REQUESTS, peer.peer)
        || !object(peer.outcomes) || Object.keys(peer.outcomes).length === 0
        || Object.entries(peer.outcomes).some(function ([specifier, outcome]) { return !CLOSSID_SUBPATH.test(specifier) || !(specifier === row.name || specifier.startsWith(row.name + "/")) || !validOptionalOutcome(outcome); })) {
        finding(findings, "optional-peer-row", row.name + " optional-peer row is not a closed direct execution policy");
      }
    }
  }
  if (relationships !== 23) finding(findings, "optional-peer-coverage", "v2 must retain all twenty-three reviewed direct optional-peer relationships");
}

/**
 * V2 owns this tuple directly. The optional v1 document is historical
 * supersession metadata only and is never read to select, transform, or
 * execute v2 evidence.
 */
export function validateAggregateV2Plan(plan, { read = readCommittedHead } = {}) {
  const findings = [];
  if (!exact(plan, ["schemaVersion", "kind", "registry", "peerResolution", "optionalPeerMatrix", "packages", "selectedEvidence"])
    || plan.schemaVersion !== 2
    || plan.kind !== "foundry-public-npm-aggregate-canary-plan-v2"
    || plan.registry !== PUBLIC_NPM_REGISTRY) return [{ rule: "plan-identity", message: "v2 plan must use its closed direct current-release schema and public npm registry" }];
  validateDirectV2Policy(plan, findings);
  if (!Array.isArray(plan.packages) || plan.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length
    || new Set(plan.packages.map(function (entry) { return entry && entry.packageKey; })).size !== ALL_PACKAGE_RELEASE_ORDER.length) finding(findings, "package-set", "v2 must own exactly one ordered nineteen-package current-release set");
  for (const [index, entry] of (plan.packages ?? []).entries()) {
    const expected = CURRENT_AGGREGATE_V2_RELEASES[index];
    if (!exact(entry, ["packageKey", "name", "version"]) || JSON.stringify(entry) !== JSON.stringify(expected) || !VERSION.test(entry.version ?? "")) finding(findings, "package-identity", "v2 package " + (index + 1) + " is not the frozen current-release identity");
  }
  if (!Array.isArray(plan.selectedEvidence) || plan.selectedEvidence.length !== ALL_PACKAGE_RELEASE_ORDER.length
    || new Set(plan.selectedEvidence.map(function (entry) { return entry && entry.packageKey; })).size !== ALL_PACKAGE_RELEASE_ORDER.length) finding(findings, "qualification-selection", "v2 requires exactly one immutable qualification selection per package");
  for (const entry of plan.packages ?? []) {
    const evidence = plan.selectedEvidence && plan.selectedEvidence.find(function (item) { return item && item.packageKey === entry.packageKey; });
    const expectedPath = "governance/release-qualifications/clossys-" + entry.packageKey + "-" + entry.version + ".json";
    if (!exact(evidence, ["packageKey", "path", "sha256"]) || evidence.path !== expectedPath || !SHA256.test(evidence.sha256 ?? "")) {
      finding(findings, "qualification-selection", entry.packageKey + " qualification reference is not closed");
      continue;
    }
    const bytes = (function () { try { return read(evidence.path); } catch { return null; } }());
    const qualification = bytes === null ? null : parse(function () { return bytes; }, evidence.path);
    if (!qualification || hash(bytes) !== evidence.sha256 || qualification.timing !== "pre-publication"
      || qualification.candidate?.name !== entry.name || qualification.candidate?.version !== entry.version
      || qualification.transcript?.schema !== "foundry-candidate-qualification-transcript-v3"
      || qualification.transcript?.version !== 3 || qualification.transcript?.ok !== true
      || !Array.isArray(qualification.transcript?.observations) || qualification.findings?.length) finding(findings, "qualification-selection", entry.name + "@" + entry.version + " is not a satisfied immutable v3 exact-candidate qualification");
  }
  return findings;
}

export function validateAggregateV2PlanHistory({ history, parentCount = function () { return 1; } } = {}) {
  if (!Array.isArray(history) || history.length === 0) return [];
  if (history.length !== 1 || history[0]?.status !== "A" || !SHA256.test(history[0]?.sha256 ?? "") || parentCount(history[0].commit) !== 1) return [{ rule: "plan-history", message: "v2 plan must be introduced once in a direct single-parent commit and never rewritten, moved, copied, or deleted" }];
  return [];
}

function v2HistoryParents(root, commit) {
  const [resolved, ...parents] = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/);
  if (resolved !== commit) throw new Error("git returned an unexpected aggregate-v2 history commit");
  return parents;
}

function v2HistoryBlob(root, commit) {
  try { return execFileSync("git", ["rev-parse", "--verify", commit + ":" + AGGREGATE_V2_CANARY_PATH], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function v2HistoryBytes(root, commit, blob) {
  if (blob === null) return Buffer.alloc(0);
  return execFileSync("git", ["cat-file", "blob", blob], { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * Follow every reachable commit through its real parent graph.  A GitHub
 * synthetic merge is merely a propagated tree when one parent already owns
 * the exact plan blob; its ordinary single-parent ancestor remains the one
 * introduction.  A merge that manufactures a novel target blob, or a branch
 * rewrite/delete/recreate, remains visible as a failed immutable history.
 */
export function aggregateV2GitHistory({ root }) {
  try {
    // Only commits that changed the plan relative to at least one parent can
    // carry a status: a commit TREESAME to every parent is skipped by the loop
    // below anyway, so restricting the walk to `--full-history -- <path>` is
    // exactly equivalent and keeps this O(commits touching the plan) instead of
    // O(every commit in the repository).
    const commits = execFileSync("git", ["log", "--full-history", "--topo-order", "--format=%H", "HEAD", "--", AGGREGATE_V2_CANARY_PATH], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
    const history = [];
    for (const commit of commits) {
      const parents = v2HistoryParents(root, commit);
      const current = v2HistoryBlob(root, commit);
      const parentBlobs = parents.map(function (parent) { return v2HistoryBlob(root, parent); });
      if (parents.length > 1 && parentBlobs.includes(current)) continue;
      let status = null;
      if (parents.length > 1) {
        if (current !== null || parentBlobs.some(function (blob) { return blob !== null; })) status = current === null ? "D" : "M";
      } else if (parents.length === 0) {
        if (current !== null) status = "A";
      } else if (current !== parentBlobs[0]) {
        status = current === null ? "D" : parentBlobs[0] === null ? "A" : "M";
      }
      if (status !== null) history.push({ commit, status, sha256: hash(v2HistoryBytes(root, commit, current)) });
    }
    return history;
  } catch { /* malformed Git evidence below is fail-closed */ }
  return [{ commit: "0".repeat(40), status: "M", sha256: "0".repeat(64) }];
}

export function aggregateV2RecordPaths({ root, directory }) { return immutableRecordPaths({ root, directory }); }
export function aggregateV2RecordHistory({ root, path }) { return immutableRecordHistory({ root, path }); }

export function validateAggregateV2RecordSets({ closureRecords = {}, transcriptRecords = {} } = {}) {
  const findings = [];
  for (const [kind, records, isPath] of [
    ["closure", closureRecords, isAggregateV2ClosurePath],
    ["transcript", transcriptRecords, isAggregateV2TranscriptPath],
  ]) {
    const current = Array.isArray(records.current) ? records.current : [];
    const introduced = Array.isArray(records.introduced) ? records.introduced : [];
    if (current.some(function (path) { return !isPath(path); }) || introduced.some(function (path) { return !isPath(path); })) finding(findings, kind + "-path", "v2 " + kind + " records must use the exact content-addressed current-release namespace");
    if (current.length > 1 || introduced.length > 1) finding(findings, kind + "-singularity", "current-release has competing immutable v2 " + kind + " records");
    if (current.some(function (path) { return !introduced.includes(path); }) || introduced.some(function (path) { return !current.includes(path); })) finding(findings, kind + "-presence", "v2 " + kind + " history and HEAD presence must agree exactly");
  }
  const closures = Array.isArray(closureRecords.current) ? closureRecords.current.length : 0;
  const transcripts = Array.isArray(transcriptRecords.current) ? transcriptRecords.current.length : 0;
  if (transcripts > 0 && closures !== 1) finding(findings, "transcript-closure", "a current v2 transcript requires exactly one current v2 closure");
  return findings;
}

export function validateAggregateV2Closure(closure, plan, { read = readCommittedHead, root = process.cwd() } = {}) {
  const findings = [];
  if (closure === null || closure === undefined) return [{ rule: "closure-indeterminate", message: "all nineteen immutable publication joins are required before a v2 registry operation can run" }];
  if (!exact(closure, ["schema", "version", "plan", "set", "policySha256", "packages", "canonicalSha256"])
    || closure.schema !== "foundry-public-npm-aggregate-closure-v2" || closure.version !== 2
    || closure.set !== AGGREGATE_V2_SET || !exact(closure.plan, ["path", "sha256"])
    || closure.plan.path !== AGGREGATE_V2_CANARY_PATH || closure.plan.sha256 !== aggregateV2PlanSha256(plan)
    || closure.policySha256 !== aggregateV2PolicySha256(plan)
    || !Array.isArray(closure.packages) || closure.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length
    || !SHA256.test(closure.canonicalSha256 ?? "")) return [{ rule: "closure-identity", message: "v2 closure must directly close exactly nineteen qualification/publication joins" }];
  const copy = structuredClone(closure); delete copy.canonicalSha256;
  if (closure.canonicalSha256 !== hash(JSON.stringify(stable(copy)))) finding(findings, "closure-digest", "v2 closure digest does not cover complete content");
  for (const [index, entry] of closure.packages.entries()) {
    const expected = plan.packages[index];
    const qualification = plan.selectedEvidence.find(function (item) { return item.packageKey === expected?.packageKey; });
    if (!exact(entry, ["name", "version", "qualification", "publication"]) || entry.name !== expected?.name || entry.version !== expected?.version
      || !exact(entry.qualification, ["path", "sha256"]) || entry.qualification.path !== qualification?.path || entry.qualification.sha256 !== qualification?.sha256
      || !exact(entry.publication, ["path", "sha256", "member"]) || entry.publication.member !== expected?.packageKey || !SHA256.test(entry.publication.sha256 ?? "")) {
      finding(findings, "closure-selection", "v2 closure row " + (index + 1) + " is not the direct selected qualification/publication join");
      continue;
    }
    try {
      const publicationBytes = read(entry.publication.path);
      const qualificationBytes = read(entry.qualification.path);
      const publication = JSON.parse(publicationBytes);
      const qualified = JSON.parse(qualificationBytes);
      const published = publicationCandidate(publication, entry.publication.member);
      if (root !== null) for (const item of validateCommittedV2LaterPublication({ root, path: entry.publication.path, read })) finding(findings, "closure-" + item.rule, entry.name + "@" + entry.version + " " + item.message);
      if (hash(publicationBytes) !== entry.publication.sha256 || hash(qualificationBytes) !== entry.qualification.sha256 || !candidateBytesEqual(qualified.candidate, published)) finding(findings, "closure-bytes", entry.name + "@" + entry.version + " publication does not retain its exact qualified candidate bytes");
      if (!exact(publication.qualification, ["path", "sha256"]) || publication.qualification.path !== entry.qualification.path || publication.qualification.sha256 !== entry.qualification.sha256) finding(findings, "closure-publication-qualification", entry.name + "@" + entry.version + " publication does not bind the exact selected qualification path and digest");
    } catch { finding(findings, "closure-bytes", entry.name + "@" + entry.version + " retained evidence is unavailable"); }
  }
  return findings;
}

export function validateAggregateV2Transcript(transcript, plan, closure, { read = readCommittedHead } = {}) {
  if (!object(transcript)) return [{ rule: "transcript-indeterminate", message: "no immutable v2 execution transcript is retained" }];
  if (!exact(transcript, ["schema", "version", "plan", "closure", "execution", "canonicalSha256"])
    || transcript.schema !== "foundry-public-npm-aggregate-transcript-v2" || transcript.version !== 2
    || !exact(transcript.plan, ["path", "sha256"]) || transcript.plan.path !== AGGREGATE_V2_CANARY_PATH || transcript.plan.sha256 !== aggregateV2PlanSha256(plan)
    || !exact(transcript.closure, ["path", "sha256"]) || transcript.closure.path !== aggregateV2ClosurePath(closure?.canonicalSha256) || transcript.closure.sha256 !== closure?.canonicalSha256
    || !exact(transcript.execution, ["policySha256", "peerResolution", "optionalPeerRelationships", "packages"])
    || transcript.execution.policySha256 !== aggregateV2PolicySha256(plan)
    || JSON.stringify(stable(transcript.execution.peerResolution)) !== JSON.stringify(stable(plan.peerResolution))
    || transcript.execution.optionalPeerRelationships !== plan.optionalPeerMatrix.reduce(function (total, row) { return total + row.peers.length; }, 0)
    || !Array.isArray(transcript.execution.packages) || transcript.execution.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length
    || !SHA256.test(transcript.canonicalSha256 ?? "")) return [{ rule: "transcript-identity", message: "v2 transcript must bind its exact direct plan, closure, and nineteen package executions" }];
  const copy = structuredClone(transcript); delete copy.canonicalSha256;
  const findings = transcript.canonicalSha256 === hash(JSON.stringify(stable(copy)) ) ? [] : [{ rule: "transcript-digest", message: "v2 transcript digest does not cover complete execution evidence" }];
  for (const [index, result] of transcript.execution.packages.entries()) {
    const expected = closure?.packages?.[index];
    const verificationKeys = ["repository", "metadataUrl", "tarballUrl", "integrity", "sha1", "sha256", "sha512", "packageManifestSha256"];
    if (!exact(result, ["name", "version", "verification"]) || result.name !== expected?.name || result.version !== expected?.version || !exact(result.verification, verificationKeys)) {
      finding(findings, "transcript-package", "v2 transcript package row " + (index + 1) + " does not retain direct verification evidence");
      continue;
    }
    try {
      const publication = JSON.parse(read(expected.publication.path));
      const qualified = JSON.parse(read(expected.qualification.path));
      const candidate = publicationCandidate(publication, expected.publication.member);
      const proof = publication?.registryProof?.evidence;
      const expectedVerification = {
        repository: proof?.repository,
        metadataUrl: proof?.metadataUrl ?? proof?.packumentUrl,
        tarballUrl: proof?.tarballUrl,
        integrity: proof?.integrity,
        sha1: candidate?.tarball?.sha1,
        sha256: candidate?.tarball?.sha256,
        sha512: candidate?.tarball?.sha512,
        packageManifestSha256: candidate?.packageManifestSha256,
      };
      if (!candidateBytesEqual(qualified.candidate, candidate)
        || JSON.stringify(stable(result.verification)) !== JSON.stringify(stable(expectedVerification))) finding(findings, "transcript-verification", result.name + "@" + result.version + " execution verification does not exactly join its closed qualification/publication candidate and registry proof");
    } catch { finding(findings, "transcript-verification", result.name + "@" + result.version + " closed execution evidence is unavailable"); }
  }
  return findings;
}

async function retainV2Record({ root, directory: relativeDirectory, path, value, prefix }) {
  const contained = await containedRegularDirectory(root, relativeDirectory);
  if (path !== relativeDirectory + "/" + basename(path)) throw new Error("v2 record path escapes its closed directory");
  const target = join(contained.directory, basename(path));
  const temporary = join(contained.directory, "." + prefix + "-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".tmp");
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(canonicalJson(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, target);
    const directoryHandle = await open(contained.directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return path;
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(function () {});
  }
}

export async function retainAggregateV2Closure({ root, closure }) {
  if (!SHA256.test(closure?.canonicalSha256 ?? "")) throw new Error("v2 closure has no closed digest");
  return retainV2Record({ root, directory: AGGREGATE_V2_CLOSURE_DIRECTORY, path: aggregateV2ClosurePath(closure.canonicalSha256), value: closure, prefix: "v2-closure" });
}

export async function retainAggregateV2Transcript({ root, transcript }) {
  if (!SHA256.test(transcript?.canonicalSha256 ?? "")) throw new Error("v2 transcript has no closed digest");
  return retainV2Record({ root, directory: AGGREGATE_V2_TRANSCRIPT_DIRECTORY, path: aggregateV2TranscriptPath(transcript.canonicalSha256), value: transcript, prefix: "v2-transcript" });
}

export function buildAggregateV2Closure({ root = process.cwd(), plan, read = readCommittedHead, publicationPaths } = {}) {
  const planFindings = validateAggregateV2Plan(plan, { read });
  if (planFindings.length) throw new Error("v2 plan invalid: " + planFindings.map(function (item) { return item.rule; }).join(","));
  if (!Array.isArray(publicationPaths) || new Set(publicationPaths).size !== publicationPaths.length
    || publicationPaths.some(function (path) { return typeof path !== "string" || !/^governance\/release-publications\/later\/[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(path); })) throw new Error("v2 closure creation requires one complete canonical committed later-publication path list");
  const publications = publicationPaths.map(function (path) {
    const bytes = read(path);
    const value = JSON.parse(bytes);
    return { path, bytes, value };
  });
  if (root !== null) for (const publication of publications) {
    const findings = validateCommittedV2LaterPublication({ root, path: publication.path, read });
    if (findings.length) throw new Error(publication.path + " is not a fully validated committed later-publication record: " + findings.map(function (item) { return item.rule; }).join(","));
  }
  const packages = plan.packages.map(function (entry) {
    const qualification = plan.selectedEvidence.find(function (item) { return item.packageKey === entry.packageKey; });
    const qualified = JSON.parse(read(qualification.path));
    const matches = publications.filter(function (publication) {
      const candidate = publicationCandidate(publication.value, entry.packageKey);
      return candidate?.name === entry.name && candidate?.version === entry.version;
    });
    if (matches.length !== 1) throw new Error(entry.name + "@" + entry.version + " requires exactly one committed publication record (found " + matches.length + ")");
    const publication = matches[0];
    if (!exact(publication.value?.qualification, ["path", "sha256"]) || publication.value.qualification.path !== qualification.path || publication.value.qualification.sha256 !== qualification.sha256) throw new Error(entry.name + "@" + entry.version + " publication does not bind the exact selected qualification record");
    const candidate = publicationCandidate(publication.value, entry.packageKey);
    if (!candidateBytesEqual(qualified.candidate, candidate)) throw new Error(entry.name + "@" + entry.version + " publication candidate bytes do not equal the exact selected qualification");
    return {
      name: entry.name,
      version: entry.version,
      qualification: { path: qualification.path, sha256: qualification.sha256 },
      publication: { path: publication.path, sha256: hash(publication.bytes), member: entry.packageKey },
    };
  });
  const closure = {
    schema: "foundry-public-npm-aggregate-closure-v2",
    version: 2,
    plan: { path: AGGREGATE_V2_CANARY_PATH, sha256: aggregateV2PlanSha256(plan) },
    set: AGGREGATE_V2_SET,
    policySha256: aggregateV2PolicySha256(plan),
    packages,
  };
  closure.canonicalSha256 = hash(JSON.stringify(stable(closure)));
  const findings = validateAggregateV2Closure(closure, plan, { read, root });
  if (findings.length) throw new Error("generated v2 closure is invalid: " + findings.map(function (item) { return item.rule; }).join(","));
  return { closurePath: aggregateV2ClosurePath(closure.canonicalSha256), closure };
}

export async function runAggregatePublicNpmCanaryV2({ root, plan, closure, closurePath, read = function (path) { return readAggregateV2Head(root, path); }, verifyArtifact = verifyPublicNpmArtifact, fetchImpl = fetch, requirePinnedRuntime = false, environment = process.env, externalTimeoutMs = AGGREGATE_EXTERNAL_TIMEOUT_MS, validationRoot = root } = {}) {
  if (requirePinnedRuntime) assertAggregateRuntime();
  assertCredentialFree(environment);
  if (Object.entries(environment).some(function ([key, value]) { return /(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i.test(key) && typeof value === "string" && value.length > 0; })) throw new Error("v2 aggregate canary refuses credential-bearing parent environment");
  const planFindings = validateAggregateV2Plan(plan, { read });
  if (planFindings.length) throw new Error("v2 plan invalid: " + planFindings.map(function (item) { return item.rule; }).join(","));
  const closureFindings = validateAggregateV2Closure(closure, plan, { read, root: validationRoot });
  if (closureFindings.some(function (item) { return item.rule !== "closure-indeterminate"; })) throw new Error("v2 closure invalid: " + closureFindings.map(function (item) { return item.rule; }).join(","));
  if (closureFindings.length) return { verdict: "indeterminate", reason: "publication closure absent", pending: plan.packages };
  if (closurePath !== aggregateV2ClosurePath(closure.canonicalSha256)) throw new Error("v2 closure path is not its content-addressed identity");
  const packages = [];
  for (const entry of closure.packages) {
    const publication = JSON.parse(read(entry.publication.path));
    const repository = publication.registryProof?.evidence?.repository;
    const result = await boundedExternal("registry verification " + entry.name + "@" + entry.version, function (signal) {
      return verifyArtifact({ registry: PUBLIC_NPM_REGISTRY, name: entry.name, version: entry.version, repository, fetchImpl: abortableFetch(fetchImpl, signal) });
    }, externalTimeoutMs);
    if (result?.kind === "unreachable") throw new AggregateUnavailableError(entry.name + "@" + entry.version + " anonymous registry verification is unavailable");
    if (result?.kind !== "verified") throw new Error(entry.name + "@" + entry.version + " anonymous registry verification did not complete: " + result?.kind);
    const qualification = JSON.parse(read(entry.qualification.path));
    if (!candidateBytesEqual(qualification.candidate, {
      name: entry.name,
      version: entry.version,
      packageManifestSha256: result.evidence.packedManifestSha256,
      tarball: { sha1: result.evidence.shasum, sha256: result.evidence.sha256, sha512: result.evidence.sha512 },
    })) throw new Error(entry.name + "@" + entry.version + " served bytes do not join the exact selected qualification");
    packages.push({ name: entry.name, version: entry.version, verification: {
      repository: result.evidence.repository,
      metadataUrl: result.evidence.metadataUrl,
      tarballUrl: result.evidence.tarballUrl,
      integrity: result.evidence.integrity,
      sha1: result.evidence.shasum,
      sha256: result.evidence.sha256,
      sha512: result.evidence.sha512,
      packageManifestSha256: result.evidence.packedManifestSha256,
    } });
  }
  const transcript = {
    schema: "foundry-public-npm-aggregate-transcript-v2",
    version: 2,
    plan: { path: AGGREGATE_V2_CANARY_PATH, sha256: aggregateV2PlanSha256(plan) },
    closure: { path: closurePath, sha256: closure.canonicalSha256 },
    execution: {
      policySha256: aggregateV2PolicySha256(plan),
      peerResolution: plan.peerResolution,
      optionalPeerRelationships: plan.optionalPeerMatrix.reduce(function (total, row) { return total + row.peers.length; }, 0),
      packages,
    },
  };
  transcript.canonicalSha256 = hash(JSON.stringify(stable(transcript)));
  const findings = validateAggregateV2Transcript(transcript, plan, closure, { read });
  if (findings.length) throw new Error("generated v2 transcript invalid: " + findings.map(function (item) { return item.rule; }).join(","));
  return { verdict: "satisfied", transcript };
}
