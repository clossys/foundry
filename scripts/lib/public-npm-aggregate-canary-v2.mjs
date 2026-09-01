import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_PACKAGE_RELEASE_ORDER,
  aggregateCanaryGitHistory,
  immutableRecordPaths,
  immutableRecordHistory,
} from "./public-npm-aggregate-canary.mjs";

export const AGGREGATE_V2_CANARY_PATH = "governance/public-npm-aggregate-canary-v2.json";
export const AGGREGATE_V2_CLOSURE_DIRECTORY = "governance/public-npm-aggregate-closures-v2";
export const AGGREGATE_V2_TRANSCRIPT_DIRECTORY = "governance/public-npm-aggregate-transcripts-v2";
export const AGGREGATE_V2_SET = "current-release";
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const PACKAGE_KEY = /^[a-z0-9][a-z0-9-]*$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const finding = (findings, rule, message) => findings.push({ rule, message });
const json = (read, path) => { try { return JSON.parse(read(path)); } catch { return null; } };

// The digest covers the complete plan and its canonical path. It deliberately
// does not reuse v1's partial projection: changing schema, kind, registry, or
// evidence is a different plan identity.
export function aggregateV2PlanSha256(plan) {
  return hash(JSON.stringify(stable({ path: AGGREGATE_V2_CANARY_PATH, plan })));
}
export function aggregateV2ClosurePath(set, sha256) { return `${AGGREGATE_V2_CLOSURE_DIRECTORY}/${set}-${sha256}.json`; }
export function aggregateV2TranscriptPath(set, sha256) { return `${AGGREGATE_V2_TRANSCRIPT_DIRECTORY}/${set}-${sha256}.json`; }
export function isAggregateV2ClosurePath(path) { return new RegExp(`^${AGGREGATE_V2_CLOSURE_DIRECTORY}/${AGGREGATE_V2_SET}-[a-f0-9]{64}\\.json$`).test(path ?? ""); }

function targetIds(evidence) {
  const ids = new Set();
  for (const observation of evidence?.transcript?.observations ?? []) {
    if (typeof observation?.id !== "string") continue;
    const match = /^import:import:(.+)$/.exec(observation.id);
    if (match) ids.add(match[1]);
    const server = /^import:react-server:(.+)$/.exec(observation.id);
    if (server) ids.add(`${server[1]}#react-server`);
    const framework = /^framework:[^:]+:[^:]+:(.+)$/.exec(observation.id);
    if (framework) ids.add(framework[1]);
    const proxy = /^framework:[^:]+:[^:]+:[^:]+:(.+)$/.exec(observation.id);
    if (proxy) ids.add(proxy[1]);
  }
  return ids;
}
function outcomeNames(outcomes) { return object(outcomes) ? Object.keys(outcomes).sort() : []; }
function validOutcome(value) {
  const okay = new Set(["imports", "rejects"]);
  return typeof value === "string" ? okay.has(value) : object(value) && Object.keys(value).length > 0 && Object.entries(value).every(([condition, result]) => ["default", "react-server"].includes(condition) && okay.has(result));
}

/** Validate v2 exclusively against committed qualification evidence. */
export function validateAggregateV2Plan(plan, { read = readFileSync } = {}) {
  const findings = [];
  if (!exact(plan, ["schemaVersion", "kind", "registry", "peerResolution", "sets", "optionalPeerMatrix", "selectedEvidence"]) || plan.schemaVersion !== 2 || plan.kind !== "foundry-public-npm-aggregate-canary-plan-v2" || plan.registry !== "https://registry.npmjs.org") return [{ rule: "plan-identity", message: "v2 plan has an unknown schema, kind, registry, or field" }];
  if (!object(plan.peerResolution) || !object(plan.peerResolution.requested) || !Array.isArray(plan.peerResolution.disposition)) finding(findings, "peer-resolution", "v2 plan must declare peer requests and dispositions");
  const react = plan.peerResolution?.disposition?.filter((item) => item?.name === "react" || item?.name === "react-dom");
  for (const name of ["react", "react-dom"]) {
    const item = react.find((entry) => entry.name === name);
    if (!item || JSON.stringify(item.requested) !== JSON.stringify(["18.3.1", "19.2.8"]) || item.resolved !== "19.2.8") finding(findings, "react-resolution", `${name} must retain 18.3.1 and 19.2.8 requests and resolve only 19.2.8`);
  }
  const set = plan.sets?.length === 1 ? plan.sets[0] : null;
  if (!set || !exact(set, ["id", "packages"]) || set.id !== AGGREGATE_V2_SET || !Array.isArray(set.packages) || set.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length) finding(findings, "package-set", "v2 must contain exactly one ordered 19-package current-release set");
  const packages = set?.packages ?? [];
  const byKey = new Map(packages.map((entry) => [entry?.packageKey, entry]));
  if (new Set(packages.map((entry) => entry?.packageKey)).size !== packages.length) finding(findings, "package-set", "v2 package keys must be unique");
  for (const [index, entry] of packages.entries()) if (!exact(entry, ["packageKey", "name", "version"]) || entry.packageKey !== ALL_PACKAGE_RELEASE_ORDER[index] || !PACKAGE_KEY.test(entry.packageKey ?? "") || entry.name !== `@clossys/${entry.packageKey}` || !VERSION.test(entry.version ?? "")) finding(findings, "package-identity", `current-release package ${index + 1} is not canonical`);
  const evidence = Array.isArray(plan.selectedEvidence) ? plan.selectedEvidence : [];
  if (evidence.length !== packages.length || new Set(evidence.map((item) => item?.packageKey)).size !== evidence.length) finding(findings, "selected-evidence", "one unique selected qualification is required per package");
  const evidenceByKey = new Map();
  for (const item of evidence) {
    if (!exact(item, ["packageKey", "path", "sha256"]) || !PACKAGE_KEY.test(item.packageKey ?? "") || !/^governance\/release-qualifications\/clossys-[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(item.path ?? "") || !SHA256.test(item.sha256 ?? "")) { finding(findings, "selected-evidence", "selected qualification evidence is not a safe content-addressed reference"); continue; }
    evidenceByKey.set(item.packageKey, item);
    const expected = byKey.get(item.packageKey);
    const record = json(read, item.path);
    if (!record || hash(read(item.path)) !== item.sha256) { finding(findings, "selected-evidence", `${item.path} is absent or has changed bytes`); continue; }
    if (!expected || record.candidate?.name !== expected.name || record.candidate?.version !== expected.version || record.timing !== "pre-publication" || record.transcript?.schema !== "foundry-candidate-qualification-transcript-v3" || record.transcript?.version !== 3 || record.transcript?.candidate?.name !== expected.name || record.transcript?.candidate?.version !== expected.version) finding(findings, "selected-evidence", `${item.path} does not qualify the selected release`);
    if (record.findings?.length || record.transcript?.ok === false) finding(findings, "selected-evidence", `${item.path} is not a satisfied qualification`);
  }
  for (const entry of packages) if (!evidenceByKey.has(entry.packageKey)) finding(findings, "selected-evidence", `${entry.packageKey} has no selected qualification`);
  const matrix = Array.isArray(plan.optionalPeerMatrix) ? plan.optionalPeerMatrix : [];
  if (matrix.length !== packages.length) finding(findings, "optional-peer-matrix", "v2 matrix must have one row per package");
  for (const row of matrix) {
    const entry = byKey.get(row?.packageKey), selected = evidenceByKey.get(row?.packageKey);
    if (!exact(row, ["set", "packageKey", "name", "version", "peers"]) || row.set !== AGGREGATE_V2_SET || !entry || row.name !== entry.name || row.version !== entry.version || !Array.isArray(row.peers)) { finding(findings, "optional-peer-matrix", `${row?.packageKey ?? "unknown"} matrix identity is invalid`); continue; }
    const observed = targetIds(json(read, selected.path));
    for (const peer of row.peers) {
      if (!exact(peer, ["peer", "outcomes"]) || !Array.isArray(Object.keys(peer.outcomes ?? {})) || !Object.keys(peer.outcomes).every((specifier) => observed.has(specifier) || observed.has(`${specifier}#react-server`)) || !Object.values(peer.outcomes).every(validOutcome)) finding(findings, "optional-peer-matrix", `${row.name} has matrix targets not established by its immutable qualification`);
      if (Object.keys(peer.outcomes ?? {}).some((specifier) => observed.has(`${specifier}#react-server`) && typeof peer.outcomes[specifier] === "string")) finding(findings, "optional-peer-matrix", `${row.name} collapses a react-server target into default`);
    }
  }
  return findings;
}

export function validateAggregateV2PlanAppendOnly(plan, { root, readHead } = {}) {
  const findings = [];
  try {
    const previous = JSON.parse(readHead ? readHead(AGGREGATE_V2_CANARY_PATH) : execFileSync("git", ["show", `HEAD:${AGGREGATE_V2_CANARY_PATH}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    if (JSON.stringify(previous) !== JSON.stringify(plan)) finding(findings, "plan-rewrite", "v2 plan is immutable after introduction");
  } catch { /* introducing commit */ }
  return findings;
}
export function validateAggregateV2PlanHistory({ root, history } = {}) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.length === 1 && history[0]?.status === "A" && SHA256.test(history[0]?.sha256 ?? "") ? [] : [{ rule: "plan-history", message: "v2 plan history permits one introduction only; deletes, rewrites, renames, and duplicates fail" }];
}
export function aggregateV2GitHistory({ root }) {
  // The introducing commit is the common hot path for this pre-publication
  // plan. Avoid walking Foundry's very large DAG until there is a prior blob;
  // once history exists, delegate to the v1 full-DAG implementation (which
  // detects deletes, rewrites, renames, copies, and merge-parent mutations).
  try {
    const changes = execFileSync("git", ["log", "--all", "--format=%H", "--diff-filter=AMDRC", "--", AGGREGATE_V2_CANARY_PATH], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
    if (changes.length === 1) {
      const commit = changes[0];
      const blob = execFileSync("git", ["show", `${commit}:${AGGREGATE_V2_CANARY_PATH}`], { cwd: root, encoding: "buffer" });
      return [{ commit, status: "A", sha256: hash(blob) }];
    }
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const parent = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const current = execFileSync("git", ["show", `${commit}:${AGGREGATE_V2_CANARY_PATH}`], { cwd: root, encoding: "buffer" });
    try { execFileSync("git", ["cat-file", "blob", `${parent}:${AGGREGATE_V2_CANARY_PATH}`], { cwd: root, stdio: "ignore" }); }
    catch { return [{ commit, status: "A", sha256: hash(current) }]; }
  } catch { /* no usable shallow/introduction context; use the complete walk */ }
  return aggregateCanaryGitHistory({ root, path: AGGREGATE_V2_CANARY_PATH });
}
export function aggregateV2RecordPaths({ root, directory }) { return immutableRecordPaths({ root, directory }); }
export function aggregateV2RecordHistory({ root, path }) { return immutableRecordHistory({ root, path }); }

export function validateAggregateV2RecordSets({ closureRecords = {}, transcriptRecords = {}, read = readFileSync } = {}) {
  const findings = [];
  const valid = (path, directory) => new RegExp(`^${directory}/${AGGREGATE_V2_SET}-[a-f0-9]{64}\\.json$`).test(path ?? "");
  const currentClosures = (closureRecords.current ?? []).filter((path) => valid(path, AGGREGATE_V2_CLOSURE_DIRECTORY));
  const currentTranscripts = (transcriptRecords.current ?? []).filter((path) => valid(path, AGGREGATE_V2_TRANSCRIPT_DIRECTORY));
  if ((closureRecords.current ?? []).some((path) => !valid(path, AGGREGATE_V2_CLOSURE_DIRECTORY)) || (transcriptRecords.current ?? []).some((path) => !valid(path, AGGREGATE_V2_TRANSCRIPT_DIRECTORY))) finding(findings, "record-path", "v2 records must remain in their versioned namespace");
  if (currentClosures.length > 1) finding(findings, "closure-singularity", "current-release has competing closure records");
  if (currentTranscripts.length > 1) finding(findings, "transcript-singularity", "current-release has competing transcript records");
  if (currentTranscripts.length && currentClosures.length !== 1) finding(findings, "transcript-closure", "a transcript requires exactly one closure");
  return findings;
}

export function validateAggregateV2Closure(closure, plan, { read = readFileSync } = {}) {
  const findings = [];
  if (closure === null || closure === undefined) return [{ rule: "closure-indeterminate", message: "publication closure is absent; no registry fetch or pass is permitted" }];
  if (!exact(closure, ["schema", "version", "plan", "set", "packages", "canonicalSha256"]) || closure.schema !== "foundry-public-npm-aggregate-closure-v2" || closure.version !== 2 || closure.set !== AGGREGATE_V2_SET || !exact(closure.plan, ["path", "sha256"]) || closure.plan.path !== AGGREGATE_V2_CANARY_PATH || closure.plan.sha256 !== aggregateV2PlanSha256(plan) || !Array.isArray(closure.packages) || closure.packages.length !== 19) return [{ rule: "closure-identity", message: "closure is malformed or is not joined to this exact v2 plan" }];
  const copy = structuredClone(closure); delete copy.canonicalSha256;
  if (!SHA256.test(closure.canonicalSha256) || closure.canonicalSha256 !== hash(JSON.stringify(stable(copy)))) finding(findings, "closure-digest", "closure canonical digest is invalid");
  const expected = plan.sets[0].packages;
  const evidenceByKey = new Map((plan.selectedEvidence ?? []).map((item) => [item.packageKey, item]));
  const candidateJoin = (left, right) => JSON.stringify(stable({ name: left?.name, version: left?.version, packageManifestSha256: left?.packageManifestSha256, tarball: left?.tarball })) === JSON.stringify(stable({ name: right?.name, version: right?.version, packageManifestSha256: right?.packageManifestSha256, tarball: right?.tarball }));
  for (const [index, item] of closure.packages.entries()) {
    if (!exact(item, ["name", "version", "qualification", "publication"]) || item.name !== expected[index]?.name || item.version !== expected[index]?.version || !exact(item.qualification, ["path", "sha256"]) || !exact(item.publication, ["path", "sha256", "member"]) || item.publication.member !== expected[index]?.packageKey || !SHA256.test(item.qualification.sha256) || !SHA256.test(item.publication.sha256)) { finding(findings, "closure-join", `closure package ${index + 1} is not an exact qualification/publication join`); continue; }
    const selectedEvidence = evidenceByKey.get(expected[index].packageKey);
    if (item.qualification.path !== selectedEvidence?.path || item.qualification.sha256 !== selectedEvidence?.sha256 || !/^governance\/release-publications\/(?:later\/[a-z0-9-]+-\d+\.\d+\.\d+|clossys-npmjs-trio)\.json$/.test(item.publication.path)) { finding(findings, "closure-ref", `${item.name}@${item.version} closure references an unselected or unsafe evidence path`); continue; }
    try {
      const qualification = JSON.parse(read(item.qualification.path));
      const publication = JSON.parse(read(item.publication.path));
      const published = publication.candidate ?? publication.members?.find((member) => member.packageKey === item.publication.member)?.registryProof?.evidence;
      if (hash(read(item.qualification.path)) !== item.qualification.sha256 || hash(read(item.publication.path)) !== item.publication.sha256 || qualification.candidate?.name !== item.name || qualification.candidate?.version !== item.version || !published || !candidateJoin(qualification.candidate, published)) finding(findings, "closure-bytes", `${item.name}@${item.version} closure does not join exact qualification/publication candidate bytes`);
    } catch { finding(findings, "closure-bytes", `${item.name}@${item.version} closure evidence is unavailable`); }
  }
  return findings;
}

export function validateAggregateV2Transcript(transcript, plan, closure) {
  if (!object(transcript)) return [{ rule: "transcript-indeterminate", message: "satisfied transcript is absent; no aggregate pass is permitted" }];
  if (!exact(transcript, ["schema", "version", "plan", "set", "operations", "packages", "consumer", "dimensions", "optionalPeerObservations", "canonicalSha256"]) || transcript.schema !== "foundry-public-npm-aggregate-transcript-v2" || transcript.version !== 2 || transcript.set !== AGGREGATE_V2_SET || !exact(transcript.plan, ["path", "sha256", "closurePath", "closureSha256"]) || transcript.plan.path !== AGGREGATE_V2_CANARY_PATH || transcript.plan.sha256 !== aggregateV2PlanSha256(plan) || transcript.plan.closurePath !== aggregateV2ClosurePath(AGGREGATE_V2_SET, closure?.canonicalSha256) || transcript.plan.closureSha256 !== closure?.canonicalSha256 || !Array.isArray(transcript.packages) || transcript.packages.length !== 19) return [{ rule: "transcript-identity", message: "transcript is malformed or not joined to the exact plan and closure" }];
  if (!Array.isArray(transcript.operations) || transcript.operations.length !== 3 || transcript.operations.map((item) => item?.id).join("\0") !== "install\0uninstall\0reinstall" || transcript.operations.some((item) => !exact(item, ["id", "expectedExitCode", "observedExitCode", "signal", "launchError", "stdoutSha256", "stderrSha256"]) || item.expectedExitCode !== 0 || item.observedExitCode !== 0 || item.signal !== null || item.launchError !== false || !SHA256.test(item.stdoutSha256 ?? "") || !SHA256.test(item.stderrSha256 ?? ""))) return [{ rule: "aggregate-operations", message: "transcript must retain one successful install, uninstall, and reinstall" }];
  if (!exact(transcript.consumer, ["manifestSha256", "lockfileSha256", "treeSha256", "controller", "singularController", "identities", "runtimeResolutions", "rollback"]) || transcript.consumer.singularController !== true || transcript.consumer.controller !== "@clossys/controller@0.8.24" || !Array.isArray(transcript.consumer.identities) || transcript.consumer.identities.join("\0") !== plan.sets[0].packages.map((item) => `${item.name}@${item.version}`).join("\0") || !Array.isArray(transcript.consumer.runtimeResolutions) || !exact(transcript.consumer.rollback, ["packageAbsenceProven", "manifestRestored", "lockfileRestored", "treeRestored", "identitiesRestored"]) || Object.values(transcript.consumer.rollback).some((value) => value !== true)) return [{ rule: "aggregate-consumer", message: "transcript must prove one shared consumer, singular Controller, all identities, edges, and rollback" }];
  const copy = structuredClone(transcript); delete copy.canonicalSha256;
  const findings = transcript.canonicalSha256 === hash(JSON.stringify(stable(copy))) ? [] : [{ rule: "transcript-digest", message: "transcript canonical digest is invalid" }];
  for (const [index, item] of transcript.packages.entries()) {
    const expected = plan.sets[0].packages[index];
    if (!exact(item, ["name", "version", "qualification", "publication", "served", "installedManifestSha256", "run"]) || item.name !== expected?.name || item.version !== expected?.version || !SHA256.test(item.installedManifestSha256 ?? "") || item.installedManifestSha256 !== item.served?.packageManifestSha256 || item.served?.name !== item.name || item.served?.version !== item.version || !SHA1.test(item.served?.tarball?.sha1 ?? "") || !SHA256.test(item.served?.tarball?.sha256 ?? "") || !SHA512.test(item.served?.tarball?.sha512 ?? "") || item.run?.candidate?.name !== item.name || item.run?.candidate?.version !== item.version || item.run?.tarball?.sha256 !== item.served?.tarball?.sha256) finding(findings, "package-join", `transcript package ${index + 1} does not join served bytes, installed manifest, and child execution`);
  }
  return findings;
}

export function parseAggregateV2Cli(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "--closure" || !isAggregateV2ClosurePath(args[1])) throw new Error("usage: run-public-npm-aggregate-canary-v2.mjs --closure governance/public-npm-aggregate-closures-v2/current-release-<sha256>.json");
  return { closurePath: args[1] };
}
