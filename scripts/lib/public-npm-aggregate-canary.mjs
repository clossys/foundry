import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, link, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { assertCredentialFree, consumerDigest, runCandidateQualification, writeNextFixture } from "./candidate-runner.mjs";
import { installedPackageRoots, runProcess, validateOptionalPeerPolicy } from "./packed-consumer-readiness.mjs";
import { PUBLIC_NPM_REGISTRY, validatePublicNpmRegistryProof, verifyGithubRepositoryRedirect, verifyPublicNpmArtifact } from "./public-npm-registry.mjs";

export const AGGREGATE_CANARY_PATH = "governance/public-npm-aggregate-canary.json";
export const AGGREGATE_TRANSCRIPT_DIRECTORY = "governance/public-npm-aggregate-transcripts";
export const AGGREGATE_CLOSURE_DIRECTORY = "governance/public-npm-aggregate-closures";
export const AGGREGATE_RUNTIME = Object.freeze({ node: "v24.19.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1b" });
export const AGGREGATE_EXTERNAL_TIMEOUT_MS = 30_000;
export class AggregateUnavailableError extends Error {}
export const ALL_PACKAGE_RELEASE_ORDER = Object.freeze([
  "advisor", "starter", "controller", "strategist", "writer", "designer", "architect", "bouncer", "butler", "giver", "influencer", "integrator", "keeper", "locksmith", "messenger", "observer", "builder", "inspector", "publisher",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const NAME = /^@clossys\/([a-z0-9][a-z0-9-]*)$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key) || keys.includes(`${key}?`)) && keys.filter((key) => !key.endsWith("?")).every((key) => own(value, key));

function finding(findings, rule, message) { findings.push({ rule, message }); }
export function canonicalRedirectProjection(rows) {
  if (!Array.isArray(rows)) return [];
  return [...new Map(rows.filter(object).map((item) => [JSON.stringify(stable(item)), item])).values()].sort((left, right) => JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right))));
}
export function aggregateClosurePath(set, canonicalSha256) { return `${AGGREGATE_CLOSURE_DIRECTORY}/${set}-${canonicalSha256}.json`; }
export function aggregateTranscriptPath(set, canonicalSha256) { return `${AGGREGATE_TRANSCRIPT_DIRECTORY}/${set}-${canonicalSha256}.json`; }
export function isAggregateClosurePath(path) { return new RegExp(`^${AGGREGATE_CLOSURE_DIRECTORY}/(?:baseline|oidc-successor)-[a-f0-9]{64}\\.json$`).test(path ?? ""); }
const aggregateRecordSets = ["baseline", "oidc-successor"];
function recordSet(directory, path) { return new RegExp(`^${directory}/(baseline|oidc-successor)-[a-f0-9]{64}\\.json$`).exec(path ?? "")?.[1] ?? null; }
export function validateAggregateRecordSets({ closureRecords = {}, transcriptRecords = {}, readTranscript = null } = {}) {
  const findings = [];
  const pathsFor = (records, directory, set, field) => (Array.isArray(records?.[field]) ? records[field] : []).filter((path) => recordSet(directory, path) === set);
  for (const set of aggregateRecordSets) {
    const introducedClosures = pathsFor(closureRecords, AGGREGATE_CLOSURE_DIRECTORY, set, "introduced"), currentClosures = pathsFor(closureRecords, AGGREGATE_CLOSURE_DIRECTORY, set, "current");
    const introducedTranscripts = pathsFor(transcriptRecords, AGGREGATE_TRANSCRIPT_DIRECTORY, set, "introduced"), currentTranscripts = pathsFor(transcriptRecords, AGGREGATE_TRANSCRIPT_DIRECTORY, set, "current");
    if (introducedClosures.length > 1 || currentClosures.length > 1) finding(findings, "closure-singularity", `${set} has competing immutable closure records`);
    if (introducedTranscripts.length > 1 || currentTranscripts.length > 1) finding(findings, "transcript-singularity", `${set} has competing immutable transcript records`);
    if (currentTranscripts.length === 0) continue;
    if (currentClosures.length !== 1 || !readTranscript) { finding(findings, "transcript-closure", `${set} transcript requires exactly one current immutable closure record`); continue; }
    for (const path of currentTranscripts) try {
      const transcript = readTranscript(path);
      if (!object(transcript) || transcript.set !== set || transcript.plan?.closurePath !== currentClosures[0]) finding(findings, "transcript-closure", `${path} must bind the sole current ${set} closure record`);
    } catch { finding(findings, "transcript-closure", `${path} is not readable committed transcript JSON`); }
  }
  return findings;
}

async function containedRegularDirectory(root, relativeDirectory) {
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, relativeDirectory);
  const rel = relative(canonicalRoot, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("aggregate transcript directory escapes the repository root");
  let cursor = canonicalRoot;
  for (const component of rel.split(sep)) {
    cursor = join(cursor, component);
    try {
      const state = await lstat(cursor);
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("aggregate transcript directory has a symlink or non-directory component");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(cursor);
      const state = await lstat(cursor);
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("aggregate transcript directory changed while being created");
    }
  }
  return { root: canonicalRoot, directory: target };
}

/**
 * Retain a newly satisfied transcript only at its post-run content-addressed
 * name. A private same-directory file is fsynced, hard-linked into place with
 * O_EXCL-equivalent no-replace semantics, then removed; an existing record or
 * any symlinked parent is an integrity violation rather than an overwrite.
 */
export async function retainAggregateTranscript({ root, transcript }) {
  if (!object(transcript) || !["baseline", "oidc-successor"].includes(transcript.set) || !SHA256.test(transcript.canonicalSha256 ?? "")) throw new Error("generated aggregate transcript has no closed identity");
  const { directory } = await containedRegularDirectory(root, AGGREGATE_TRANSCRIPT_DIRECTORY);
  const relativePath = aggregateTranscriptPath(transcript.set, transcript.canonicalSha256);
  const target = join(directory, basename(relativePath));
  const temporary = join(directory, `.aggregate-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const bytes = `${JSON.stringify(transcript, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close(); handle = null;
    await link(temporary, target); // atomic no-overwrite: EEXIST is conclusive.
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return relativePath;
  } finally {
    try { if (handle) await handle.close(); } finally { await unlink(temporary).catch(() => {}); }
  }
}

export function parseAggregateCanaryCli(args) {
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) throw new Error("usage: aggregate canary arguments must be strings");
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--closure', '--set', '--output-dir'].includes(flag) || value === undefined || values.has(flag)) throw new Error("usage: run-public-npm-aggregate-canary.mjs [--set baseline|oidc-successor] [--closure governance/public-npm-aggregate-closures/<set>-<sha256>.json] [--output-dir governance/public-npm-aggregate-transcripts]");
    values.set(flag, value);
  }
  const closurePath = values.get("--closure") ?? null;
  const set = values.get("--set") ?? "oidc-successor";
  const outputDirectory = values.get("--output-dir") ?? AGGREGATE_TRANSCRIPT_DIRECTORY;
  if ((closurePath !== null && !isAggregateClosurePath(closurePath)) || outputDirectory !== AGGREGATE_TRANSCRIPT_DIRECTORY || !["baseline", "oidc-successor"].includes(set)) throw new Error("usage: run-public-npm-aggregate-canary.mjs [--set baseline|oidc-successor] [--closure governance/public-npm-aggregate-closures/<set>-<sha256>.json] [--output-dir governance/public-npm-aggregate-transcripts]");
  return { closurePath, set, outputDirectory };
}
export function assertAggregateRuntime({ node = process.version, npm = execFileSync("npm", ["--version"], { encoding: "utf8", timeout: AGGREGATE_EXTERNAL_TIMEOUT_MS }).trim(), zlib = process.versions.zlib } = {}) {
  if (node !== AGGREGATE_RUNTIME.node || npm !== AGGREGATE_RUNTIME.npm || zlib !== AGGREGATE_RUNTIME.zlib) throw new Error(`aggregate canary requires Node 24.19.0, npm 11.17.0, and zlib ${AGGREGATE_RUNTIME.zlib} (received ${node}, ${npm}, ${zlib})`);
}

async function boundedExternal(label, callback) {
  let timer;
  try {
    return await Promise.race([
      callback(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new AggregateUnavailableError(`${label} timed out`)), AGGREGATE_EXTERNAL_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}
function parse(bytes, path, findings) {
  try { return JSON.parse(bytes); } catch { finding(findings, "json", `${path} is not JSON`); return null; }
}
function recordCandidate(publication, member) {
  if (publication?.kind === "clossys-npmjs-trio-first-publication-v1") {
    return publication.members?.find((entry) => entry?.packageKey === member)?.registryProof?.evidence
      ? publication.members.find((entry) => entry?.packageKey === member)
      : null;
  }
  return publication?.candidate ? publication : null;
}

function publicationProof(publication, key) {
  return publication?.kind === "clossys-npmjs-trio-first-publication-v1"
    ? publication.members?.find((member) => member?.packageKey === key)?.registryProof ?? null
    : publication?.registryProof ?? null;
}

export function publicationCandidate(publication, key) {
  if (publication?.kind === "clossys-npmjs-trio-first-publication-v1") {
    const proof = publicationProof(publication, key);
    const evidence = proof?.evidence;
    return evidence ? { name: evidence.name, version: evidence.version, packageManifestSha256: evidence.packedManifestSha256, tarball: { sha1: evidence.shasum, sha256: evidence.sha256, sha512: evidence.sha512 } } : null;
  }
  return publication?.candidate ?? null;
}

function candidateBytesJoin(actual, expected) {
  return Boolean(expected && actual && actual.name === expected.name && actual.version === expected.version
    && actual.tarball?.sha1 === expected.tarball?.sha1
    && actual.tarball?.sha256 === expected.tarball?.sha256
    && actual.tarball?.sha512 === expected.tarball?.sha512
    && actual.packageManifestSha256 === expected.packageManifestSha256);
}

function aggregateNpmOperation(id, result) {
  return {
    id,
    expectedExitCode: 0,
    observedExitCode: result.exitCode,
    signal: result.signal ?? null,
    launchError: Boolean(result.launchError),
    stdoutSha256: hash(result.stdout),
    stderrSha256: hash(result.stderr),
  };
}

/** Stable, typed aggregate view of one retained candidate-runner transcript. */
export function aggregateChildExecutionProjection(run) {
  if (!object(run)) return null;
  const observations = Array.isArray(run.observations) ? run.observations.map((item) => ({ id: item?.id, kind: item?.kind, expectedExitCode: item?.expectedExitCode, observedExitCode: item?.observedExitCode, launchError: item?.launchError, signal: item?.signal })) : null;
  return {
    candidate: run.candidate,
    tarball: run.tarball,
    consumer: run.consumer,
    coverage: run.coverage,
    dimensions: run.dimensions,
    restoration: run.restoration,
    observations,
    ok: run.ok,
  };
}

export function validateAggregateChildExecution(run, { name, version, qualificationTranscript = null } = {}) {
  const findings = [];
  const childKeys = ["schema", "version", "candidate", "archetype", "tarball", "peerInstall", "consumer", "coverage", "observations", "dimensions", "restoration", "mismatches", "ok", "canonicalSha256", "fixtureMaterializedAt?"];
  if (!onlyKeys(run, childKeys) || run.schema !== "foundry-aggregate-child-execution-v1" || run.version !== 1 || !exactKeys(run.candidate, ["name", "version"]) || run.candidate.name !== name || run.candidate.version !== version || typeof run.archetype !== "string" || (own(run, "fixtureMaterializedAt") && typeof run.fixtureMaterializedAt !== "string") || !object(run.peerInstall) || !exactKeys(run.consumer, ["manifestSha256", "lockfileSha256"]) || !SHA256.test(run.consumer.manifestSha256 ?? "") || !SHA256.test(run.consumer.lockfileSha256 ?? "") || !SHA256.test(run.canonicalSha256 ?? "")) return [{ rule: "child-identity", message: `${name}@${version} aggregate child execution record is not closed` }];
  if (!exactKeys(run.tarball, ["sha1", "sha256", "sha512"]) || !/^[a-f0-9]{40}$/.test(run.tarball.sha1 ?? "") || !SHA256.test(run.tarball.sha256 ?? "") || !/^[a-f0-9]{128}$/.test(run.tarball.sha512 ?? "")) finding(findings, "child-tarball", `${name}@${version} child tarball evidence is not closed`);
  if (!Array.isArray(run.observations) || !Array.isArray(run.dimensions)) return [{ rule: "child-shape", message: `${name}@${version} child arrays are malformed` }];
  const copy = structuredClone(run); delete copy.canonicalSha256;
  if (run.canonicalSha256 !== hash(JSON.stringify(copy))) finding(findings, "child-canonical", `${name}@${version} child transcript digest does not match its full retained content`);
  const projection = aggregateChildExecutionProjection(run);
  if (!projection || !exactKeys(projection.candidate, ["name", "version"]) || !exactKeys(projection.tarball, ["sha1", "sha256", "sha512"]) || !exactKeys(projection.consumer, ["manifestSha256", "lockfileSha256"]) || !object(projection.coverage) || !Array.isArray(projection.dimensions) || !Array.isArray(projection.observations) || projection.ok !== true) finding(findings, "child-projection", `${name}@${version} child execution projection is incomplete or unsatisfied`);
  if (!exactKeys(run.restoration, ["delegatedToAggregate"]) || run.restoration.delegatedToAggregate !== true || !Array.isArray(run.mismatches) || run.mismatches.length !== 0 || run.observations.some((item) => ["install", "uninstall", "reinstall"].includes(item?.kind))) finding(findings, "child-rollback", `${name}@${version} aggregate child must delegate install and rollback and may not fabricate individual npm observations`);
  const observationKeys = ["id", "kind", "launch", "expectedExitCode", "observedExitCode", "signal", "launchError", "stdoutSha256", "stderrSha256", "rawCaseEvidence?"];
  const permittedKinds = new Set(["import", "framework", "help", "case"]);
  if (run.observations.some((item) => !onlyKeys(item, observationKeys) || typeof item.id !== "string" || !permittedKinds.has(item.kind) || item.launch !== (item.kind === "framework" ? "next-build" : "node-direct") || !Number.isInteger(item.expectedExitCode) || item.expectedExitCode !== item.observedExitCode || item.signal !== null || item.launchError !== false || !SHA256.test(item.stdoutSha256 ?? "") || !SHA256.test(item.stderrSha256 ?? ""))) finding(findings, "child-observation", `${name}@${version} child observations are incomplete or do not record successful exact execution`);
  const cases = run.observations.filter((item) => item?.kind === "case");
  if (new Set(run.observations.map((item) => item?.id)).size !== run.observations.length || run.observations.some((item) => ![0, 1, 2].includes(item.expectedExitCode)) || cases.length === 0 || ![0, 1, 2].every((code) => cases.some((item) => item.expectedExitCode === code && item.observedExitCode === code))) finding(findings, "child-cases", `${name}@${version} child observations must have unique IDs and retain the required 0/1/2 cases`);
  const coverageKeys = ["declaredExportKeys", "concreteTargets", "runtimeImports", "reactServerImports", "staticTargets", "frameworkExports", "frameworkBuilds", "failed", "installedManifestSha256", "bins", "lifecycleScriptsDisabled"];
  if (!exactKeys(projection.coverage, coverageKeys) || coverageKeys.slice(0, 8).some((key) => !Number.isSafeInteger(projection.coverage[key]) || projection.coverage[key] < 0) || !SHA256.test(projection.coverage.installedManifestSha256 ?? "") || projection.coverage.lifecycleScriptsDisabled !== true || projection.coverage.failed !== 0 || projection.coverage.frameworkBuilds !== (projection.coverage.frameworkExports > 0 ? 1 : 0) || run.observations.filter((item) => item.kind === "import").length !== projection.coverage.runtimeImports || run.observations.filter((item) => item.kind === "framework").length !== projection.coverage.frameworkExports || run.observations.filter((item) => item.kind === "help").length !== projection.coverage.bins) finding(findings, "child-coverage", `${name}@${version} child coverage does not bind each executed dimension and installed manifest`);
  const dimensions = ["position", "completion", "rollback", "duplicate", "cadence", "closeWindow"];
  if (run.dimensions.length !== dimensions.length || run.dimensions.map((item) => item?.dimension).join("\0") !== dimensions.join("\0") || run.dimensions.some((item) => !onlyKeys(item, ["dimension", "status", "reason?", "evidence?"]) || !["supported", "unsupported"].includes(item.status) || (item.status === "supported" && (!Array.isArray(item.evidence) || item.evidence.length === 0)) || (item.status === "unsupported" && typeof item.reason !== "string")) || run.dimensions.find((item) => item.dimension === "rollback")?.status !== "supported" || JSON.stringify(run.dimensions.find((item) => item.dimension === "rollback")?.evidence) !== JSON.stringify(["aggregate-rollback-delegated"])) finding(findings, "child-dimensions", `${name}@${version} child dimensions must retain complete adapter coverage and aggregate rollback delegation`);
  if (qualificationTranscript !== null) {
    const expectedObservations = qualificationTranscript?.observations;
    const expectedCoverage = qualificationTranscript?.coverage;
    if (!Array.isArray(expectedObservations) || !object(expectedCoverage)) finding(findings, "qualification-contract", `${name}@${version} immutable qualification operation contract is unavailable`);
    else {
      if (run.archetype !== qualificationTranscript.archetype || JSON.stringify(stable(run.peerInstall)) !== JSON.stringify(stable(qualificationTranscript.peerInstall))) finding(findings, "qualification-identity", `${name}@${version} child archetype and requested peer contract must exactly match immutable qualification evidence`);
      const expectedDimensions = (qualificationTranscript.dimensions ?? []).filter((item) => item?.dimension !== "rollback");
      const actualDimensions = run.dimensions.filter((item) => item?.dimension !== "rollback");
      if (!Array.isArray(qualificationTranscript.dimensions) || JSON.stringify(stable(actualDimensions)) !== JSON.stringify(stable(expectedDimensions))) finding(findings, "qualification-dimensions", `${name}@${version} child non-rollback dimension evidence must exactly match immutable qualification evidence`);
      const project = (item) => ({ id: item?.id, kind: item?.kind, launch: item?.launch, expectedExitCode: item?.expectedExitCode });
      const operationKinds = new Set(["import", "framework", "help", "case"]);
      const expected = expectedObservations.filter((item) => operationKinds.has(item?.kind)).map(project);
      const actual = run.observations.filter((item) => operationKinds.has(item?.kind)).map(project);
      const exactNonImports = (rows) => rows.filter((item) => item.kind !== "import").sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const expectedImports = expected.filter((item) => item.kind === "import"), actualImports = actual.filter((item) => item.kind === "import");
      const importsMatch = qualificationTranscript.schema === "foundry-candidate-qualification-transcript-v2"
        ? JSON.stringify(actualImports.map((item) => ({ kind: item.kind, expectedExitCode: item.expectedExitCode }))) === JSON.stringify(expectedImports.map((item) => ({ kind: item.kind, expectedExitCode: item.expectedExitCode })))
        : JSON.stringify(actualImports) === JSON.stringify(expectedImports);
      if (!importsMatch || JSON.stringify(exactNonImports(actual)) !== JSON.stringify(exactNonImports(expected))) finding(findings, "qualification-operations", `${name}@${version} child operations do not exactly match immutable qualification kinds, exits, and schema-appropriate identities`);
      const retainedCoverageKeys = ["declaredExportKeys", "concreteTargets", "runtimeImports", "reactServerImports", "staticTargets", "frameworkExports", "frameworkBuilds", "failed", "bins", "lifecycleScriptsDisabled"].filter((key) => own(expectedCoverage, key));
      const derived = {
        reactServerImports: expected.filter((item) => item.id?.startsWith("import:react-server:")).length,
        frameworkExports: expected.filter((item) => item.kind === "framework").length,
      };
      derived.frameworkBuilds = derived.frameworkExports > 0 ? 1 : 0;
      if (retainedCoverageKeys.some((key) => run.coverage?.[key] !== expectedCoverage[key]) || ["reactServerImports", "frameworkExports", "frameworkBuilds"].filter((key) => !own(expectedCoverage, key)).some((key) => run.coverage?.[key] !== derived[key])) finding(findings, "qualification-coverage", `${name}@${version} child coverage does not exactly match retained immutable coverage and derived operation counts`);
      const expectedRaw = expectedObservations.filter((item) => item?.kind === "case" && own(item, "rawCaseEvidence"));
      const actualRaw = run.observations.filter((item) => item?.kind === "case" && own(item, "rawCaseEvidence"));
      const isoInstant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
      const retainedInstant = qualificationTranscript.fixtureMaterializedAt;
      const childInstant = run.fixtureMaterializedAt;
      const rebaseRaw = (value) => {
        if (typeof value === "string") return value.split(retainedInstant).join(childInstant);
        if (Array.isArray(value)) return value.map(rebaseRaw);
        if (!object(value)) return value;
        const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebaseRaw(item)]));
        if (typeof copy.bytes === "string" && own(copy, "sha256")) copy.sha256 = hash(copy.bytes);
        return copy;
      };
      const validRaw = (value) => object(value) && exactKeys(value, ["argv", "materializedInputs", "consumerOverlay", "exitCode", "stdout", "stderr"])
        && Array.isArray(value.argv) && value.argv.every((item) => typeof item === "string")
        && Array.isArray(value.materializedInputs) && Array.isArray(value.consumerOverlay)
        && Number.isInteger(value.exitCode) && typeof value.stdout === "string" && typeof value.stderr === "string";
      if (expectedRaw.length !== actualRaw.length || (expectedRaw.length > 0 && (!isoInstant.test(retainedInstant ?? "") || !isoInstant.test(childInstant ?? ""))) || expectedRaw.some((item) => {
        const actual = run.observations.find((actualItem) => actualItem?.id === item.id)?.rawCaseEvidence;
        const expectedRawEvidence = rebaseRaw(item.rawCaseEvidence);
        return !validRaw(actual) || JSON.stringify(stable(actual)) !== JSON.stringify(stable(expectedRawEvidence));
      }) || actualRaw.some((item) => !expectedRaw.some((expected) => expected.id === item.id))) finding(findings, "qualification-raw-case", `${name}@${version} child raw case evidence must exactly match the immutable argv, inputs, overlay, exit, and streams`);
    }
  }
  return findings;
}

/**
 * Validate the closed, aggregate public-npm canary declaration without
 * contacting npm. A held/pending member is a hard incomplete result at run
 * time, not an optimistic substitute for public registry evidence.
 */
export function validateAggregateCanary(record, { read = () => { throw new Error("read unavailable"); } } = {}) {
  const findings = [];
  if (!exactKeys(record, ["schemaVersion", "kind", "registry", "peerResolution", "sets", "optionalPeerMatrix"])) {
    finding(findings, "shape", "aggregate record must use its closed top-level schema");
    return findings;
  }
  if (record.schemaVersion !== 1 || record.kind !== "foundry-public-npm-aggregate-canary-plan-v1" || record.registry !== PUBLIC_NPM_REGISTRY) {
    finding(findings, "identity", "aggregate record must bind schema v1 and the one public npm registry");
  }
  if (!exactKeys(record.peerResolution, ["requested", "disposition"]) || !object(record.peerResolution.requested) || !Array.isArray(record.peerResolution.disposition) || record.peerResolution.disposition.some((item) => !exactKeys(item, ["name", "requested", "resolved", "reason"]) || !Array.isArray(item.requested) || !VERSION.test(item.resolved ?? "") || typeof item.reason !== "string")) finding(findings, "peer-resolution", "plan must retain its closed aggregate peer resolution and conflict disposition");
  const sets = Array.isArray(record.sets) ? record.sets : [];
  if (sets.length !== 2 || sets.map((set) => set?.id).join("\0") !== "baseline\0oidc-successor") {
    finding(findings, "sets", "aggregate record must retain the exact baseline and oidc-successor sets");
  }
  const identities = new Set();
  for (const set of sets) {
    if (!exactKeys(set, ["id", "packages"]) || !Array.isArray(set.packages) || set.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length) {
      finding(findings, "set-shape", `${set?.id ?? "unknown"} must contain exactly 19 package rows`);
      continue;
    }
    for (let index = 0; index < ALL_PACKAGE_RELEASE_ORDER.length; index += 1) {
      const entry = set.packages[index];
      if (!exactKeys(entry, ["packageKey", "name", "version"])) {
        finding(findings, "entry-shape", `${set.id}[${index}] must use the closed member schema`);
        continue;
      }
      const key = ALL_PACKAGE_RELEASE_ORDER[index];
      if (entry.packageKey !== key || entry.name !== `@clossys/${key}` || !VERSION.test(entry.version)) {
        finding(findings, "entry-identity", `${set.id}[${index}] must retain the exact ordered public package identity`);
      }
      const identity = `${set.id}:${entry.name}@${entry.version}`;
      if (identities.has(identity)) finding(findings, "duplicate", `duplicate aggregate identity ${identity}`);
      identities.add(identity);
    }
  }
  if (!Array.isArray(record.optionalPeerMatrix) || record.optionalPeerMatrix.length !== 38) finding(findings, "optional-peer-matrix", "plan must retain one exact optional-peer row for every package in both frozen sets");
  else for (const row of record.optionalPeerMatrix) {
    const selected = sets.find((set) => set?.id === row?.set)?.packages?.find((entry) => entry?.packageKey === row?.packageKey);
    if (!selected || !exactKeys(row, ["set", "packageKey", "name", "version", "peers"]) || row.name !== selected.name || row.version !== selected.version || !Array.isArray(row.peers) || row.peers.some((peer) => !exactKeys(peer, ["peer", "outcomes"]) || typeof peer.peer !== "string" || !object(peer.outcomes) || Object.values(peer.outcomes).some((outcome) => outcome !== "imports" && outcome !== "rejects"))) finding(findings, "optional-peer-row", "optional-peer rows must be closed and exactly join one frozen package identity");
  }
  const matrixIdentities = (Array.isArray(record.optionalPeerMatrix) ? record.optionalPeerMatrix : []).map((row) => `${row?.set}:${row?.name}@${row?.version}`);
  if (new Set(matrixIdentities).size !== matrixIdentities.length) finding(findings, "optional-peer-duplicate", "optional-peer matrix must not duplicate a frozen package identity");
  return findings;
}

/**
 * Once introduced, the aggregate declaration's two frozen sets are immutable;
 * only a strictly extending transcript index may be added. The first local
 * edit before its introduction has no parent record to compare, which lets the
 * ordinary pre-commit check run while the new record is being authored.
 */
export function validateAggregateCanaryAppendOnly(record, { root, path = AGGREGATE_CANARY_PATH, readHead } = {}) {
  const findings = [];
  let previous;
  try {
    const bytes = readHead ? readHead(path) : execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    previous = JSON.parse(bytes);
  } catch {
    return findings;
  }
  if (JSON.stringify(previous.sets) !== JSON.stringify(record.sets) || JSON.stringify(previous.optionalPeerMatrix) !== JSON.stringify(record.optionalPeerMatrix) || JSON.stringify(previous.peerResolution) !== JSON.stringify(record.peerResolution) || previous.kind !== record.kind || previous.registry !== record.registry) finding(findings, "plan-rewrite", "introduced frozen aggregate plan may not be rewritten");
  return findings;
}

/**
 * Unlike the working-tree comparison above, this checks every committed path
 * change.  A delete/recreate whose final bytes equal the first declaration is
 * still a prohibited rewrite, so `HEAD:path` alone is not evidence of
 * immutability.
 */
export function validateAggregateCanaryHistory({ path = AGGREGATE_CANARY_PATH, history }) {
  const findings = [];
  if (path !== AGGREGATE_CANARY_PATH) return [{ rule: "plan-path", message: "aggregate plan must use its one closed governance path" }];
  // An untracked declaration has no committed history yet; permit the normal
  // structural check during the introducing change. Once tracked, exactly one
  // add is required forever.
  if (!Array.isArray(history) || history.length === 0) return findings;
  const valid = history.every((entry) => exactKeys(entry, ["commit", "status", "sha256"])
    && /^[a-f0-9]{40}$/.test(entry.commit ?? "") && ["A", "M", "D"].includes(entry.status) && SHA256.test(entry.sha256 ?? ""));
  const introductions = history.filter((entry) => entry?.status === "A");
  if (!valid || introductions.length !== 1 || history[history.length - 1]?.status !== "A") finding(findings, "plan-history", "aggregate plan history must contain one valid introduction only");
  if (history.length !== 1) finding(findings, "plan-rewrite", "aggregate plan may not be touched after its introduction");
  return findings;
}

function reachableCommits(root) {
  return execFileSync("git", ["rev-list", "--topo-order", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

/** Read every actual parent; no path limiter may simplify the commit graph. */
function actualParents(root, commit) {
  const commits = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd: root, encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
  if (commits[0] !== commit) throw new Error(`git returned an unexpected commit while reading ${commit} parents`);
  return commits.slice(1);
}

/** Return the exact tree entry object ID, or null when the path is absent. */
function pathBlob(root, commit, path) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${commit}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function pathBytes(root, commit, path, oid) {
  if (!oid) return null;
  try { return execFileSync("git", ["cat-file", "blob", oid], { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return Buffer.from(`${commit}:${path}:${oid}`); }
}

function mutationStatus(current, parents) {
  if (current === null) return parents.some((parent) => parent !== null) ? "D" : null;
  return parents.every((parent) => parent === null) ? "A" : "M";
}

function renamedPathStatus(root, commit, path) {
  try {
    const rows = execFileSync("git", ["diff-tree", "--root", "-r", "--name-status", "--find-renames=40%", "--find-copies=40%", "--find-copies-harder", commit], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    for (const row of rows) {
      const [rawStatus, ...paths] = row.split("\t");
      if (paths.includes(path) && ["R", "C"].includes(rawStatus?.slice(0, 1))) return rawStatus.slice(0, 1);
    }
  } catch {
    // A missing diff is treated as an ordinary exact path comparison below.
  }
  return null;
}

/**
 * Compare one exact path against every reachable commit's actual parents.
 * A merge is a mutation only when its result is novel relative to every
 * parent; otherwise the branch-side mutation is already represented once.
 */
function exactPathHistory(root, path, commits = reachableCommits(root)) {
  const history = [];
  for (const commit of commits) {
    const parents = actualParents(root, commit);
    const current = pathBlob(root, commit, path);
    const parentBlobs = parents.map((parent) => pathBlob(root, parent, path));
    const mutation = parents.length > 1
      ? (parentBlobs.some((parent) => parent === current) ? null : mutationStatus(current, parentBlobs))
      : (parentBlobs[0] === current ? null : renamedPathStatus(root, commit, path) ?? mutationStatus(current, parentBlobs));
    if (!mutation) continue;
    const bytes = pathBytes(root, commit, path, current) ?? parentBlobs.map((parent, index) => pathBytes(root, parents[index], path, parent)).find((value) => value !== null) ?? Buffer.alloc(0);
    history.push({ commit, status: mutation, sha256: hash(bytes) });
  }
  return history;
}

/** Return every committed mutation of the plan path from HEAD's real DAG. */
export function aggregateCanaryGitHistory({ root, path = AGGREGATE_CANARY_PATH }) {
  return exactPathHistory(root, path);
}

function pathsSeenInHistory(root, directory, commits) {
  const paths = new Set();
  for (const commit of commits) {
    const rows = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "--", directory], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    for (const path of rows) paths.add(path);
  }
  return paths;
}

/**
 * Discover immutable records introduced anywhere in HEAD ancestry. Every
 * candidate path is checked against the complete reachable DAG, so a branch
 * introduction brought through a merge is one A event, while an unreachable
 * divergent branch cannot poison the result.
 */
export function immutableRecordPaths({ root, directory }) {
  const commits = reachableCommits(root);
  const introduced = new Set();
  for (const path of pathsSeenInHistory(root, directory, commits)) {
    if (exactPathHistory(root, path, commits).some((entry) => entry.status === "A")) introduced.add(path);
  }
  const current = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", directory], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean));
  return { introduced: [...introduced].sort(), current: [...current].sort() };
}

/** Hash the exact blob visible at a record mutation (or its pre-delete blob). */
export function immutableRecordHistory({ root, path }) {
  return exactPathHistory(root, path);
}

export function aggregatePlanSha256(plan) {
  return hash(JSON.stringify(stable({ peerResolution: plan?.peerResolution, sets: plan?.sets, optionalPeerMatrix: plan?.optionalPeerMatrix })));
}

/** Resolve a later immutable closure without ever mutating the frozen plan. */
export function resolveAggregateClosure(plan, set, closure = null) {
  const selected = plan?.sets?.find((entry) => entry.id === set);
  if (!selected) throw new Error("aggregate canary set is unknown");
  if (closure === null) return { selected, closure: null, incomplete: selected.packages };
  if (!exactKeys(closure, ["schema", "version", "plan", "set", "packages", "canonicalSha256"]) || closure.schema !== "foundry-public-npm-aggregate-closure-v1" || closure.version !== 1 || closure.set !== set || !exactKeys(closure.plan, ["path", "sha256"]) || closure.plan.path !== AGGREGATE_CANARY_PATH || closure.plan.sha256 !== aggregatePlanSha256(plan) || !Array.isArray(closure.packages) || closure.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length) throw new Error("aggregate closure is not a closed immutable join to this plan");
  const copy = structuredClone(closure); delete copy.canonicalSha256;
  if (!SHA256.test(closure.canonicalSha256 ?? "") || closure.canonicalSha256 !== hash(JSON.stringify(stable(copy)))) throw new Error("aggregate closure canonical digest is invalid");
  const resolved = selected.packages.map((entry, index) => {
    const item = closure.packages[index];
    if (!exactKeys(item, ["name", "version", "qualification", "publication"]) || item.name !== entry.name || item.version !== entry.version || !exactKeys(item.qualification, ["path", "sha256"]) || !exactKeys(item.publication, ["path", "sha256", "member"])) throw new Error(`aggregate closure does not close ${entry.name}@${entry.version}`);
    return { ...entry, qualification: item.qualification, publication: item.publication };
  });
  return { selected: { ...selected, packages: resolved }, closure, incomplete: [] };
}

export function validateAggregateClosure(plan, closure, { read = null, path = null } = {}) {
  const findings = [];
  let selected;
  try { selected = resolveAggregateClosure(plan, closure?.set, closure).selected; }
  catch (error) { return [{ rule: "closure", message: error.message }]; }
  if (path !== null && (!isAggregateClosurePath(path) || path !== aggregateClosurePath(closure.set, closure.canonicalSha256))) finding(findings, "closure-path", "closure file must be content-addressed by its exact canonical digest in the closed namespace");
  for (const entry of selected.packages) {
    if (!/^governance\/release-qualifications\/[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(entry.qualification.path) || !SHA256.test(entry.qualification.sha256) || !/^governance\/release-publications\/(?:later\/[a-z0-9-]+-\d+\.\d+\.\d+|clossys-npmjs-trio)\.json$/.test(entry.publication.path) || !SHA256.test(entry.publication.sha256) || entry.publication.member !== entry.packageKey) {
      finding(findings, "closure-ref", `${entry.name}@${entry.version} closure reference is outside the closed immutable evidence namespaces`);
      continue;
    }
    if (read) try {
      const qualification = parse(read(entry.qualification.path), entry.qualification.path, findings);
      const publication = parse(read(entry.publication.path), entry.publication.path, findings);
      const published = publicationCandidate(publication, entry.packageKey);
      if (hash(read(entry.qualification.path)) !== entry.qualification.sha256 || qualification?.candidate?.name !== entry.name || qualification?.candidate?.version !== entry.version) finding(findings, "qualification-join", `${entry.name}@${entry.version} closure qualification does not join exact bytes`);
      if (hash(read(entry.publication.path)) !== entry.publication.sha256 || !published || published.name !== entry.name || published.version !== entry.version || !candidateBytesJoin(qualification?.candidate, published)) finding(findings, "publication-join", `${entry.name}@${entry.version} closure publication does not join its exact qualification candidate bytes`);
    } catch { finding(findings, "closure-read", `${entry.name}@${entry.version} closure evidence is unavailable`); }
  }
  return findings;
}

/** Validate a separately retained, satisfied aggregate execution transcript. */
export function validateSatisfiedAggregateTranscript(transcript, { plan, closure, expectedRepositoryRedirects = null, qualificationContracts = null, candidateContracts = null, path = AGGREGATE_CANARY_PATH } = {}) {
  const findings = [];
  const expectedSetsSha256 = hash(JSON.stringify(stable({ peerResolution: plan?.peerResolution, sets: plan?.sets, optionalPeerMatrix: plan?.optionalPeerMatrix })));
  if (!exactKeys(transcript, ["schema", "version", "plan", "set", "repositoryRedirects", "peerResolution", "operations", "packages", "consumer", "dimensions", "optionalPeerObservations", "canonicalSha256"])) return [{ rule: "shape", message: "closed aggregate transcript schema required" }];
  if (transcript.schema !== "foundry-public-npm-aggregate-transcript-v1" || transcript.version !== 1 || !exactKeys(transcript.plan, ["path", "setsSha256", "closurePath", "closureSha256"]) || transcript.plan.path !== path || transcript.plan.setsSha256 !== expectedSetsSha256 || !isAggregateClosurePath(transcript.plan.closurePath) || transcript.plan.closurePath !== aggregateClosurePath(transcript.set, transcript.plan.closureSha256) || transcript.plan.closureSha256 !== closure?.canonicalSha256) finding(findings, "plan-join", "transcript must bind the exact frozen plan and immutable closure bytes");
  let selected = null;
  try { selected = resolveAggregateClosure(plan, transcript.set, closure).selected; }
  catch { finding(findings, "closure", "transcript closure cannot resolve all nineteen frozen identities"); }
  if (!selected || selected.packages?.some((entry) => !entry.qualification || !entry.publication) || !Array.isArray(transcript.packages) || transcript.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length) finding(findings, "packages", "a satisfied transcript requires exactly one closed qualified publication row for every frozen package");
  else for (let index = 0; index < selected.packages.length; index += 1) {
    const expected = selected.packages[index], actual = transcript.packages[index];
    if (!exactKeys(actual, ["name", "version", "qualification", "publication", "served", "installedManifestSha256", "run"]) || actual.name !== expected.name || actual.version !== expected.version || JSON.stringify(actual.qualification) !== JSON.stringify(expected.qualification) || JSON.stringify(actual.publication) !== JSON.stringify(expected.publication) || !exactKeys(actual.served, ["name", "version", "packageManifestSha256", "tarball"]) || actual.served.name !== actual.name || actual.served.version !== actual.version || !SHA256.test(actual.served.packageManifestSha256 ?? "") || !exactKeys(actual.served.tarball, ["sha1", "sha256", "sha512"]) || !/^[a-f0-9]{40}$/.test(actual.served.tarball.sha1 ?? "") || !SHA256.test(actual.served.tarball.sha256 ?? "") || !/^[a-f0-9]{128}$/.test(actual.served.tarball.sha512 ?? "") || !SHA256.test(actual.installedManifestSha256 ?? "")) finding(findings, "package-join", `transcript package row ${index} must exactly join the frozen identity, served bytes, installed manifest, and immutable records`);
    findings.push(...validateAggregateChildExecution(actual?.run, { ...actual, qualificationTranscript: qualificationContracts?.[`${actual?.name}@${actual?.version}`] ?? null }));
    const candidateContract = candidateContracts?.[`${actual?.name}@${actual?.version}`];
    if (candidateContracts !== null && (!candidateContract || !candidateBytesJoin(actual?.served, candidateContract.qualification) || !candidateBytesJoin(actual?.served, candidateContract.publication))) finding(findings, "served-contract", `${actual?.name ?? index} served bytes must exactly join both immutable qualification and publication candidates`);
    if (actual?.installedManifestSha256 !== actual?.run?.coverage?.installedManifestSha256 || actual?.run?.consumer?.manifestSha256 !== transcript.consumer?.manifestSha256 || actual?.run?.consumer?.lockfileSha256 !== transcript.consumer?.lockfileSha256) finding(findings, "child-install-join", `${actual?.name ?? index} child evidence must bind the one shared aggregate consumer and installed packed manifest`);
    if (!candidateBytesJoin({ name: actual?.name, version: actual?.version, packageManifestSha256: actual?.served?.packageManifestSha256, tarball: actual?.run?.tarball }, actual?.served)) finding(findings, "child-served-join", `${actual?.name ?? index} child tarball must bind the aggregate served byte evidence`);
    if (actual?.installedManifestSha256 !== actual?.served?.packageManifestSha256) finding(findings, "installed-served-join", `${actual?.name ?? index} installed packed manifest must equal the served packed manifest`);
  }
  if (!Array.isArray(transcript.repositoryRedirects) || transcript.repositoryRedirects.some((item) => !exactKeys(item, ["historicalRepository", "repository", "repositoryId", "kind"]) || item.repository !== "clossys/foundry" || item.historicalRepository !== "clossys/platform" || item.repositoryId !== 1325931929 || item.kind !== "verified") || JSON.stringify(stable(transcript.repositoryRedirects)) !== JSON.stringify(stable(canonicalRedirectProjection(transcript.repositoryRedirects))) || (expectedRepositoryRedirects !== null && JSON.stringify(stable(transcript.repositoryRedirects)) !== JSON.stringify(stable(canonicalRedirectProjection(expectedRepositoryRedirects))))) finding(findings, "repository-redirect", "transcript must retain the exact verified sealed historical repository redirect projection");
  if (!exactKeys(transcript.peerResolution, ["requested", "actual", "disposition"]) || JSON.stringify(stable(transcript.peerResolution.requested)) !== JSON.stringify(stable(plan?.peerResolution?.requested)) || JSON.stringify(stable(transcript.peerResolution.actual)) !== JSON.stringify(stable(plan?.peerResolution?.requested)) || JSON.stringify(stable(transcript.peerResolution.disposition)) !== JSON.stringify(stable(plan?.peerResolution?.disposition))) finding(findings, "peer-resolution", "transcript must retain the exact reviewed peer request, actual resolution, and conflict disposition");
  const expectedIdentities = selected?.packages?.map((entry) => `${entry.name}@${entry.version}`) ?? [];
  if (!exactKeys(transcript.consumer, ["manifestSha256", "lockfileSha256", "controller", "singularController", "identities", "rollback"]) || !SHA256.test(transcript.consumer.manifestSha256 ?? "") || !SHA256.test(transcript.consumer.lockfileSha256 ?? "") || transcript.consumer.singularController !== true || JSON.stringify(transcript.consumer.identities) !== JSON.stringify(expectedIdentities) || transcript.consumer.controller !== expectedIdentities.find((identity) => identity.startsWith("@clossys/controller@")) || !exactKeys(transcript.consumer.rollback, ["packageAbsenceProven", "manifestRestored", "lockfileRestored", "identitiesRestored"]) || Object.values(transcript.consumer.rollback).some((value) => value !== true)) finding(findings, "rollback", "transcript must retain exact aggregate identity and complete real rollback evidence");
  const operationKeys = ["id", "expectedExitCode", "observedExitCode", "signal", "launchError", "stdoutSha256", "stderrSha256"];
  if (!Array.isArray(transcript.operations) || transcript.operations.length !== 3 || transcript.operations.map((item) => item?.id).join("\0") !== "install\0uninstall\0reinstall" || transcript.operations.some((item) => !exactKeys(item, operationKeys) || item.expectedExitCode !== 0 || item.observedExitCode !== 0 || item.signal !== null || item.launchError !== false || !SHA256.test(item.stdoutSha256 ?? "") || !SHA256.test(item.stderrSha256 ?? ""))) finding(findings, "aggregate-operations", "transcript must retain exactly one successful real aggregate install, uninstall, and reinstall operation");
  const required = ["install", "exports", "framework", "bins", "cases", "optionalPeers", "rollback"];
  if (!Array.isArray(transcript.dimensions) || transcript.dimensions.length !== required.length || transcript.dimensions.map((entry) => entry?.dimension).join("\0") !== required.join("\0") || transcript.dimensions.some((entry) => !exactKeys(entry, ["dimension", "count", "ok"]) || !Number.isSafeInteger(entry.count) || entry.count < 1 || entry.ok !== true)) finding(findings, "dimensions", "transcript must retain every aggregate execution dimension once with a positive satisfied count");
  else if (!Array.isArray(transcript.packages) || transcript.packages.some((entry) => !object(entry?.run) || !object(entry.run.coverage) || !Array.isArray(entry.run.observations))) finding(findings, "dimension-count", "aggregate dimension projection requires well-formed child execution records");
  else {
    const actualRuns = transcript.packages.map((entry) => entry.run);
    const expectedCounts = {
      exports: actualRuns.reduce((sum, run) => sum + run.coverage.declaredExportKeys, 0),
      framework: actualRuns.reduce((sum, run) => sum + run.coverage.frameworkExports, 0),
      bins: actualRuns.reduce((sum, run) => sum + run.coverage.bins, 0),
      cases: actualRuns.reduce((sum, run) => sum + run.observations.filter((item) => item.kind === "case").length, 0),
      optionalPeers: (plan?.optionalPeerMatrix ?? []).filter((row) => row.set === transcript.set).reduce((sum, row) => sum + row.peers.reduce((peerSum, peer) => peerSum + Object.keys(peer.outcomes).length, 0), 0),
      install: 1,
      rollback: 1,
    };
    if (transcript.dimensions.some((entry) => entry.count !== expectedCounts[entry.dimension])) finding(findings, "dimension-count", "aggregate dimension counts must exactly project all child and immutable optional-peer execution evidence");
  }
  const frameworkSpecifiers = new Set((transcript.packages ?? []).flatMap((entry) => (entry?.run?.observations ?? []).filter((item) => item?.kind === "framework").map((item) => `${entry.name}@${entry.version}\0${item.id.split(":").slice(3).join(":")}`)));
  const expectedOptional = (plan?.optionalPeerMatrix ?? []).filter((row) => row.set === transcript.set).flatMap((row) => row.peers.flatMap((peer) => Object.entries(peer.outcomes).map(([specifier, outcome]) => ({ package: row.name, version: row.version, peer: peer.peer, specifier, outcome, evaluator: frameworkSpecifiers.has(`${row.name}@${row.version}\0${specifier}`) ? (peer.peer === "next" ? "next-bin-absent" : "next-build") : "node-direct" }))));
  const optionalKey = (item) => JSON.stringify({ package: item.package, version: item.version, peer: item.peer, specifier: item.specifier, outcome: item.outcome, evaluator: item.evaluator });
  const restoration = transcript.optionalPeerObservations?.[0]?.restoration;
  if (!Array.isArray(transcript.optionalPeerObservations) || transcript.optionalPeerObservations.some((item) => !exactKeys(item, ["package", "version", "peer", "specifier", "outcome", "evaluator", "result", "restoration"]) || !["node-direct", "next-build", "next-bin-absent"].includes(item.evaluator) || !exactKeys(item.result, ["expectedOutcome", "observedExitCode", "signal", "launchError", "timedOut", "stdoutSha256", "stderrSha256"]) || item.result.expectedOutcome !== item.outcome || !Number.isInteger(item.result.observedExitCode) || (item.outcome === "imports" ? item.result.observedExitCode !== 0 : item.result.observedExitCode === 0) || item.result.signal !== null || item.result.launchError !== false || item.result.timedOut !== false || !SHA256.test(item.result.stdoutSha256 ?? "") || !SHA256.test(item.result.stderrSha256 ?? "") || !exactKeys(item.restoration, ["manifestSha256", "lockfileSha256", "treeSha256"]) || !SHA256.test(item.restoration.manifestSha256 ?? "") || !SHA256.test(item.restoration.lockfileSha256 ?? "") || !SHA256.test(item.restoration.treeSha256 ?? "") || item.restoration.manifestSha256 !== transcript.consumer?.manifestSha256 || item.restoration.lockfileSha256 !== transcript.consumer?.lockfileSha256 || JSON.stringify(item.restoration) !== JSON.stringify(restoration)) || JSON.stringify(transcript.optionalPeerObservations.map(optionalKey).sort()) !== JSON.stringify(expectedOptional.map(optionalKey).sort())) finding(findings, "optional-peer-observations", "aggregate transcript must retain the exact unique immutable optional-peer evaluator, result, and restoration multiset");
  const copy = structuredClone(transcript); delete copy.canonicalSha256;
  if (!SHA256.test(transcript.canonicalSha256 ?? "") || transcript.canonicalSha256 !== hash(JSON.stringify(stable(copy)))) finding(findings, "canonical", "transcript canonical digest must hash the closed content excluding itself");
  return findings;
}

/**
 * A satisfied record is introduced once.  Git's full path history is used so
 * a delete/recreate or a rewrite/restore remains visible even if its current
 * bytes look canonical again.  The caller supplies `history` in tests to keep
 * this pure and hermetic.
 */
export function validateSatisfiedTranscriptHistory({ path, history }) {
  const findings = [];
  if (!new RegExp(`^${AGGREGATE_TRANSCRIPT_DIRECTORY}/(?:baseline|oidc-successor)-[a-f0-9]{64}\\.json$`).test(path ?? "")) return [{ rule: "transcript-path", message: "satisfied records must use the closed immutable aggregate transcript namespace" }];
  if (!Array.isArray(history) || history.length === 0) return [{ rule: "transcript-history", message: "satisfied record must have one introduction commit" }];
  const introductions = history.filter((entry) => entry?.status === "A");
  if (introductions.length !== 1 || history[history.length - 1]?.status !== "A" || history.some((entry) => !exactKeys(entry, ["commit", "status", "sha256"]) || !/^[a-f0-9]{40}$/.test(entry.commit ?? "") || !["A", "M", "D"].includes(entry.status) || !SHA256.test(entry.sha256 ?? ""))) finding(findings, "transcript-history", "satisfied record history must contain one valid introduction only");
  if (history.length !== 1) finding(findings, "transcript-rewrite", "satisfied record may not be touched after its introduction");
  return findings;
}

function credentiallessNpmEnv(base, root) {
  // Candidate imports and framework builds inherit this object. Preserve only
  // process-location/localisation plumbing; credentials and arbitrary service
  // configuration must never cross this boundary by denylist accident.
  const env = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SYSTEMROOT", "COMSPEC"]) if (typeof base[key] === "string" && base[key].length > 0) env[key] = base[key];
  return { ...env, HOME: root, npm_config_userconfig: join(root, "user.npmrc"), npm_config_globalconfig: join(root, "global.npmrc"), npm_config_cache: join(root, "cache"), npm_config_registry: `${PUBLIC_NPM_REGISTRY}/`, npm_config_always_auth: "false", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" };
}

function installedControllerIdentities(tree, found = []) {
  if (!object(tree)) return found;
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (name === "@clossys/controller") found.push(`${dependency?.name ?? name}@${dependency?.version ?? "unknown"}`);
    installedControllerIdentities(dependency, found);
  }
  return found;
}

export function controllerPhysicalIdentities(tree, seen = new Set(), found = []) {
  if (!object(tree)) return found;
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (!object(dependency)) continue;
    // npm's `ls --all` JSON can repeat a hoisted object through multiple
    // dependency edges. `path` is the physical identity when available;
    // absent paths deliberately remain distinct and therefore fail closed.
    const physical = typeof dependency.path === "string" ? dependency.path : `${name}:${dependency.version ?? "unknown"}:${found.length}`;
    if (name === "@clossys/controller" && !seen.has(physical)) {
      seen.add(physical);
      found.push({ name: dependency.name ?? name, version: dependency.version, path: dependency.path ?? null });
    }
    controllerPhysicalIdentities(dependency, seen, found);
  }
  return found;
}

export function sealedHistoricalRepository({ entry, proof, transition }) {
  const repository = proof?.evidence?.repository;
  if (repository === transition?.candidate?.repository) return null;
  // Early anonymous-proof v1 records did not retain a repository field. This
  // is never a default: it is admitted only for an exact sealed historical
  // tuple and is immediately followed by the live redirect proof.
  const repositorylessV1 = repository === undefined && proof?.kind === "public-npm-anonymous-registry-proof-v1";
  if (repositorylessV1) {
    const repositoryIndex = 0;
    const permitted = transition.historicalRepositoryVersions?.some((item) => item?.name === entry.name && item?.version === entry.version && item?.repositoryIndex === repositoryIndex);
    const historicalRepository = transition.historicalRepositories?.[repositoryIndex], repositoryId = transition.historicalRepositoryIds?.[repositoryIndex];
    if (!permitted || historicalRepository !== "clossys/platform" || !Number.isSafeInteger(repositoryId)) throw new Error(`${entry.name}@${entry.version} has no exact sealed repository-less v1 historical tuple`);
    return { historicalRepository, repository: transition.candidate.repository, repositoryId };
  }
  const repositoryIndex = transition?.historicalRepositories?.indexOf(repository);
  if (repositoryIndex === -1) throw new Error(`${entry.name}@${entry.version} publication repository is neither current nor an exact sealed historical repository`);
  const permitted = transition.historicalRepositoryVersions?.some((item) => item?.name === entry.name && item?.version === entry.version && item?.repositoryIndex === repositoryIndex);
  const repositoryId = transition.historicalRepositoryIds?.[repositoryIndex];
  if (!permitted || !Number.isSafeInteger(repositoryId)) throw new Error(`${entry.name}@${entry.version} has no exact sealed historical repository tuple`);
  return { historicalRepository: repository, repository: transition.candidate.repository, repositoryId };
}

async function treeDigest(root) {
  const rows = [];
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === ".cache") continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) rows.push(["file", path.slice(root.length + 1), hash(await readFile(path))]);
      else if (item.isSymbolicLink()) rows.push(["symlink", path.slice(root.length + 1), await readlink(path)]);
    }
  };
  await walk(root); return hash(JSON.stringify(rows.sort((left, right) => `${left[1]}\0${left[0]}\0${left[2]}`.localeCompare(`${right[1]}\0${right[0]}\0${right[2]}`))));
}

/** Run one immutable optional-peer matrix serially against an already-installed consumer. */
export async function runAggregateOptionalPeerMatrix({ consumer, matrix, env, frameworkByPackage = new Map() }) {
  const before = { manifest: hash(await readFile(join(consumer, "package.json"))), lock: hash(await readFile(join(consumer, "package-lock.json"))), tree: await treeDigest(join(consumer, "node_modules")) };
  const observations = [];
  for (const row of matrix) for (const peerRow of row.peers) {
    const roots = await installedPackageRoots(join(consumer, "node_modules"), peerRow.peer);
    if (roots.length === 0) throw new Error(`${row.name} optional peer ${peerRow.peer} is not physically installed before omission`);
    const moved = [];
    const pending = [];
    try {
      for (const root of roots.sort((a, b) => b.length - a.length)) { const hidden = `${root}.foundry-omitted`; await rename(root, hidden); moved.push([root, hidden]); }
      const framework = frameworkByPackage.get(`${row.name}@${row.version}`) ?? { client: [], server: [], proxy: [], all: [] };
      for (const [specifier, expected] of Object.entries(peerRow.outcomes)) {
        if (framework.all.includes(specifier)) continue;
        const result = await runProcess(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], { cwd: consumer, env, timeout: 30_000 });
        const actual = result.exitCode === 0 ? "imports" : "rejects";
        if (result.timedOut || result.signal || result.launchError || result.exitCode === null || actual !== expected) throw new Error(`${row.name} omission ${peerRow.peer} ${specifier} expected ${expected}, received ${actual}`);
        pending.push({ package: row.name, version: row.version, peer: peerRow.peer, specifier, outcome: actual, evaluator: "node-direct", result: { expectedOutcome: expected, observedExitCode: result.exitCode, signal: result.signal ?? null, launchError: false, timedOut: false, stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr) } });
      }
      if (framework.all.length > 0) {
        const expected = new Set(framework.all.map((specifier) => peerRow.outcomes[specifier]));
        if (expected.size !== 1 || !["imports", "rejects"].includes([...expected][0])) throw new Error(`${row.name} omission ${peerRow.peer} has incomplete framework outcome rows`);
        const evaluator = join(consumer, "node_modules", ".bin", "next");
        const evaluatorRoot = await mkdtemp(join(consumer, ".foundry-aggregate-next-"));
        let result;
        try {
          await writeFile(join(evaluatorRoot, "package.json"), '{"private":true,"type":"module"}\n');
          await symlink(join(consumer, "node_modules"), join(evaluatorRoot, "node_modules"), "dir");
          await writeNextFixture(evaluatorRoot, framework);
          result = await runProcess(evaluator, ["build"], { cwd: evaluatorRoot, env: { ...env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" }, timeout: peerRow.peer === "next" ? 30_000 : 120_000 });
        } finally { await rm(evaluatorRoot, { recursive: true, force: true }); }
        const actual = result.exitCode === 0 ? "imports" : "rejects";
        if (result.timedOut || result.signal || result.launchError || result.exitCode === null || actual !== [...expected][0]) throw new Error(`${row.name} omission ${peerRow.peer} Next evaluator expected ${[...expected][0]}, received ${actual}`);
        for (const specifier of framework.all) pending.push({ package: row.name, version: row.version, peer: peerRow.peer, specifier, outcome: actual, evaluator: peerRow.peer === "next" ? "next-bin-absent" : "next-build", result: { expectedOutcome: [...expected][0], observedExitCode: result.exitCode, signal: result.signal ?? null, launchError: false, timedOut: false, stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr) } });
      }
    } finally {
      for (const [root, hidden] of moved.reverse()) await rename(hidden, root);
    }
    const after = { manifest: hash(await readFile(join(consumer, "package.json"))), lock: hash(await readFile(join(consumer, "package-lock.json"))), tree: await treeDigest(join(consumer, "node_modules")) };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${row.name} omission ${peerRow.peer} did not restore aggregate consumer bytes`);
    observations.push(...pending.map((item) => ({ ...item, restoration: { manifestSha256: after.manifest, lockfileSha256: after.lock, treeSha256: after.tree } })));
  }
  return observations;
}

/**
 * The live runner is intentionally unavailable until every frozen member has
 * a retained public record. It verifies anonymous served bytes before any
 * install, then uses the current package-neutral candidate adapters for all
 * declared exports, contexts, bins, 0/1/2 cases, peers and rollback.
 */
export async function runAggregatePublicNpmCanary({ root, record, set = "oidc-successor", closure = null, closurePath = null, requirePinnedRuntime = false, fetchImpl = fetch, verifyArtifact = verifyPublicNpmArtifact, verifyRedirect = verifyGithubRepositoryRedirect, validateRegistryProof = validatePublicNpmRegistryProof, readEvidence = null, prepareCandidate = null, executeCandidate = runCandidateQualification, executeOptionalPeers = runAggregateOptionalPeerMatrix, environment = process.env } = {}) {
  if (requirePinnedRuntime) assertAggregateRuntime();
  assertCredentialFree(environment);
  if (Object.entries(environment).some(([key, value]) => /(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i.test(key) && typeof value === "string" && value.length > 0)) throw new Error("aggregate canary refuses credential-bearing parent environment");
  const read = readEvidence ?? ((path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" }));
  const findings = validateAggregateCanary(record, { read });
  if (findings.length) throw new Error(`aggregate record invalid: ${findings.map((item) => item.rule).join(",")}`);
  const resolved = resolveAggregateClosure(record, set, closure);
  const selected = resolved.selected;
  const incomplete = resolved.incomplete;
  if (incomplete.length) return { verdict: "indeterminate", reason: "publication-records-pending", pending: incomplete.map((entry) => `${entry.name}@${entry.version}`) };
  if (!isAggregateClosurePath(closurePath) || closurePath !== aggregateClosurePath(set, closure?.canonicalSha256)) throw new Error("live aggregate canary requires one closed immutable content-addressed closure path");
  const closureFindings = validateAggregateClosure(record, closure, { read, path: closurePath });
  if (closureFindings.length) throw new Error(`aggregate closure invalid: ${closureFindings.map((item) => item.rule).join(",")}`);
  const artifacts = [];
  const transition = JSON.parse(read("governance/package-identity-transition.json"));
  const repositoryRedirects = [];
  const requiredRepositoryRedirects = [];
  for (const entry of selected.packages) {
    const publication = JSON.parse(read(entry.publication.path));
    const proof = publicationProof(publication, entry.packageKey);
    const publishedCandidate = publicationCandidate(publication, entry.packageKey);
    if (!publishedCandidate) throw new Error(`${entry.name}@${entry.version} publication has no exact anonymous registry candidate`);
    const historical = sealedHistoricalRepository({ entry, proof, transition });
    const repository = proof?.evidence?.repository ?? historical?.historicalRepository;
    if (!repository) throw new Error(`${entry.name}@${entry.version} publication has no exact repository provenance`);
    if (historical) {
      const required = { ...historical, kind: "verified" };
      if (!requiredRepositoryRedirects.some((item) => JSON.stringify(item) === JSON.stringify(required))) requiredRepositoryRedirects.push(required);
      const redirect = await boundedExternal(`repository redirect ${historical.historicalRepository}`, () => verifyRedirect({ ...historical, fetchImpl }));
      if (redirect?.kind !== "verified") throw new Error(`${entry.name}@${entry.version} historical repository redirect proof did not verify`);
      if (!repositoryRedirects.some((item) => JSON.stringify(item) === JSON.stringify({ ...historical, kind: redirect.kind }))) repositoryRedirects.push({ ...historical, kind: redirect.kind });
    }
    const result = await boundedExternal(`registry verification ${entry.name}@${entry.version}`, () => verifyArtifact({ registry: PUBLIC_NPM_REGISTRY, name: entry.name, version: entry.version, repository, fetchImpl }));
    if (result.kind !== "verified") throw new Error(`${entry.name}@${entry.version} anonymous registry verification did not complete: ${result.kind}`);
    const qualification = JSON.parse(read(entry.qualification.path));
    const expected = qualification.candidate;
    if (result.evidence.shasum !== expected.tarball.sha1 || result.evidence.sha256 !== expected.tarball.sha256 || result.evidence.sha512 !== expected.tarball.sha512 || result.evidence.packedManifestSha256 !== expected.packageManifestSha256) throw new Error(`${entry.name}@${entry.version} served bytes do not join its immutable qualification candidate`);
    if (!candidateBytesJoin({ name: entry.name, version: entry.version, packageManifestSha256: result.evidence.packedManifestSha256, tarball: { sha1: result.evidence.shasum, sha256: result.evidence.sha256, sha512: result.evidence.sha512 } }, publishedCandidate)) throw new Error(`${entry.name}@${entry.version} served bytes do not join its immutable publication candidate`);
    const proofFindings = validateRegistryProof(proof, { name: entry.name, version: entry.version, repository, bytes: result.bytes });
    if (proofFindings.length) throw new Error(`${entry.name}@${entry.version} served bytes do not join its immutable publication record`);
    artifacts.push({ entry, bytes: result.bytes, evidence: result.evidence, qualification, publicationCandidate: publishedCandidate });
  }
  const scratch = await mkdtemp(join(tmpdir(), "foundry-public-npm-aggregate-"));
  try {
    const env = credentiallessNpmEnv(environment, scratch);
    await writeFile(join(scratch, "user.npmrc"), `registry=${PUBLIC_NPM_REGISTRY}/\nalways-auth=false\nignore-scripts=true\n`);
    await writeFile(join(scratch, "global.npmrc"), "");
    await mkdir(join(scratch, "artifacts"));
    for (const artifact of artifacts) await writeFile(join(scratch, "artifacts", `${artifact.entry.packageKey}.tgz`), artifact.bytes);
    const peerInstall = {};
    const peerRequests = new Map();
    if (!prepareCandidate) {
      for (const entry of selected.packages) {
        const qualification = JSON.parse(read(entry.qualification.path));
        const policy = JSON.parse(execFileSync("git", ["show", `${qualification.reviewedCommit}:governance/release-qualification-policy.json`], { cwd: root, encoding: "utf8" }));
        const selectedPolicy = policy.packages[entry.name];
        const adapter = JSON.parse(execFileSync("git", ["show", `${qualification.reviewedCommit}:${selectedPolicy.adapterPath}`], { cwd: root, encoding: "utf8" }));
        for (const [name, version] of Object.entries(adapter.peerInstall ?? {})) {
          const requested = peerRequests.get(name) ?? new Set(); requested.add(version); peerRequests.set(name, requested);
        }
      }
    }
    for (const [name, versions] of peerRequests) {
      if (versions.size === 1) peerInstall[name] = [...versions][0];
      else {
        const disposition = record.peerResolution.disposition.find((item) => item.name === name && JSON.stringify([...versions].sort()) === JSON.stringify([...item.requested].sort()));
        if (!disposition || record.peerResolution.requested[name] !== disposition.resolved) throw new Error(`aggregate peer ${name} has no immutable common-resolution disposition`);
        peerInstall[name] = disposition.resolved;
      }
    }
    for (const [name, version] of Object.entries(record.peerResolution.requested)) {
      if (peerInstall[name] && peerInstall[name] !== version) throw new Error(`aggregate peer ${name} resolution diverges from its frozen plan`);
      peerInstall[name] = version;
    }
    await writeFile(join(scratch, "package.json"), `${JSON.stringify({ name: "foundry-public-npm-aggregate-consumer", private: true, type: "module", dependencies: { ...Object.fromEntries(selected.packages.map((entry) => [entry.name, `file:./artifacts/${entry.packageKey}.tgz`])), ...Object.fromEntries(Object.entries(peerInstall).sort()) } }, null, 2)}\n`);
    // One exact all-package install creates and retains one lockfile. The
    // individual adapter runs below are deliberately not a replacement for it.
    const operations = [];
    const install = await runProcess("npm", ["install", "--ignore-scripts", "--save-exact"], { cwd: scratch, env, timeout: 180_000 });
    operations.push(aggregateNpmOperation("install", install));
    if (install.exitCode !== 0 || install.timedOut || install.signal || install.launchError) throw new Error("aggregate npm install execution failed");
    const before = { manifest: await readFile(join(scratch, "package.json"), "utf8"), lock: await readFile(join(scratch, "package-lock.json"), "utf8"), tree: await treeDigest(join(scratch, "node_modules")) };
    const declaredConsumer = JSON.parse(before.manifest);
    const installedForOptionalPolicy = [];
    for (const artifact of artifacts) {
      const entry = artifact.entry;
      const installedBytes = await readFile(join(scratch, "node_modules", ...entry.name.split("/"), "package.json"));
      const installed = JSON.parse(installedBytes);
      if (declaredConsumer.dependencies?.[entry.name] !== `file:./artifacts/${entry.packageKey}.tgz` || installed.name !== entry.name || installed.version !== entry.version || hash(installedBytes) !== artifact.evidence.packedManifestSha256) throw new Error(`${entry.name} is not one exact direct aggregate identity joined to its served packed manifest`);
      installedForOptionalPolicy.push({ manifest: installed });
    }
    if (!prepareCandidate) {
      const matrixPolicy = {};
      for (const row of record.optionalPeerMatrix.filter((row) => row.set === set)) matrixPolicy[row.name] = Object.fromEntries(row.peers.map((peer) => [peer.peer, peer.outcomes]));
      const optionalPolicyFindings = validateOptionalPeerPolicy(installedForOptionalPolicy, matrixPolicy);
      if (optionalPolicyFindings.length) throw new Error(`aggregate optional-peer matrix does not exactly join served manifests: ${optionalPolicyFindings.join("; ")}`);
    }
    const actualPeerResolution = {};
    for (const [name, expectedVersion] of Object.entries(peerInstall)) {
      const installedPeer = JSON.parse(await readFile(join(scratch, "node_modules", ...name.split("/"), "package.json"), "utf8"));
      if (installedPeer.name !== name || installedPeer.version !== expectedVersion) throw new Error(`aggregate peer ${name} did not resolve its reviewed exact version`);
      actualPeerResolution[name] = installedPeer.version;
    }
    const controller = JSON.parse(await readFile(join(scratch, "node_modules", "@clossys", "controller", "package.json"), "utf8"));
    const expectedController = selected.packages.find((entry) => entry.packageKey === "controller").version;
    if (controller.name !== "@clossys/controller" || controller.version !== expectedController) throw new Error("aggregate consumer did not resolve the one exact Controller identity");
    const dependencyTree = JSON.parse(execFileSync("npm", ["ls", "@clossys/controller", "--all", "--long", "--json"], { cwd: scratch, env, encoding: "utf8", timeout: AGGREGATE_EXTERNAL_TIMEOUT_MS }));
    const controllers = controllerPhysicalIdentities(dependencyTree);
    if (controllers.length !== 1 || controllers[0].name !== "@clossys/controller" || controllers[0].version !== expectedController) throw new Error("aggregate consumer did not resolve one singular Controller dependency identity");
    const publisher = selected.packages.find((entry) => entry.packageKey === "publisher");
    if (publisher) {
      const publisherManifest = JSON.parse(await readFile(join(scratch, "node_modules", "@clossys", "publisher", "package.json"), "utf8"));
      for (const dependency of ["@clossys/controller", "@clossys/writer", "@clossys/designer"]) {
        if (typeof publisherManifest.dependencies?.[dependency] !== "string") throw new Error(`Publisher is missing required ${dependency} dependency edge`);
      }
    }

    const runs = [];
    for (const artifact of artifacts) {
      const tarball = join(scratch, `${artifact.entry.packageKey}-${artifact.entry.version}.tgz`);
      await writeFile(tarball, artifact.bytes);
      if (prepareCandidate) {
        const prepared = await prepareCandidate({ artifact, tarball, scratch, entry: artifact.entry });
        runs.push(await executeCandidate({ ...prepared, aggregateConsumer: { manifestSha256: hash(before.manifest), lockfileSha256: hash(before.lock) } }));
        if (hash(await readFile(join(scratch, "package.json"), "utf8")) !== hash(before.manifest) || hash(await readFile(join(scratch, "package-lock.json"), "utf8")) !== hash(before.lock) || await treeDigest(join(scratch, "node_modules")) !== before.tree) throw new Error(`${artifact.entry.name} child execution did not restore the shared aggregate consumer tree`);
        continue;
      }
      const qualification = JSON.parse(read(artifact.entry.qualification.path));
      const reviewed = qualification.reviewedCommit;
      if (!/^[a-f0-9]{40}$/.test(reviewed ?? "")) throw new Error(`${artifact.entry.name} qualification has no immutable reviewed commit`);
      const atReviewed = (path) => execFileSync("git", ["show", `${reviewed}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const policyBytes = atReviewed("governance/release-qualification-policy.json");
      const policy = JSON.parse(policyBytes);
      const selectedPolicy = policy.packages[artifact.entry.name];
      if (!selectedPolicy || hash(JSON.stringify(stable(selectedPolicy))) !== qualification.candidate.policySha256) throw new Error(`${artifact.entry.name} reviewed policy does not join its qualification`);
      const adapterBytes = atReviewed(selectedPolicy.adapterPath);
      if (hash(adapterBytes) !== qualification.candidate.adapterSha256) throw new Error(`${artifact.entry.name} reviewed adapter does not join its qualification`);
      const adapter = JSON.parse(adapterBytes);
      const fixtureRoot = join(scratch, "immutable-fixtures", artifact.entry.packageKey);
      const fixtures = {};
      for (const fixture of adapter.fixtures) {
        const path = join(fixtureRoot, fixture);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, atReviewed(`${selectedPolicy.fixturePath}/${fixture}`));
        fixtures[fixture] = { path };
      }
      const fixtureDigest = hash(JSON.stringify(adapter.fixtures.slice().sort().map((fixture) => ({ path: `${selectedPolicy.fixturePath}/${fixture}`, sha256: hash(atReviewed(`${selectedPolicy.fixturePath}/${fixture}`)) }))));
      if (fixtureDigest !== qualification.candidate.fixtureSetSha256) throw new Error(`${artifact.entry.name} reviewed fixture set does not join its qualification`);
      const manifestBytes = atReviewed(`${selectedPolicy.packageDir}/package.json`);
      if (hash(manifestBytes) !== qualification.candidate.packageManifestSha256) throw new Error(`${artifact.entry.name} reviewed manifest does not join its qualification`);
      const manifestBins = JSON.parse(manifestBytes).bin ?? {};
      runs.push(await executeCandidate({ tarball, policy, adapter, fixtures, manifestBins, registry: { scope: "@clossys", registry: PUBLIC_NPM_REGISTRY }, consumerRoot: scratch, skipRollback: true, restoreConsumerOverlay: true }));
      if (hash(await readFile(join(scratch, "package.json"), "utf8")) !== hash(before.manifest) || hash(await readFile(join(scratch, "package-lock.json"), "utf8")) !== hash(before.lock) || await treeDigest(join(scratch, "node_modules")) !== before.tree) throw new Error(`${artifact.entry.name} child execution did not restore the shared aggregate consumer tree`);
    }
    const frameworkByPackage = new Map(runs.map((run) => {
      const contexts = { client: [], server: [], proxy: [], all: [] };
      for (const observation of run.observations.filter((item) => item.kind === "framework")) {
        const [, , role, ...parts] = observation.id.split(":");
        const specifier = parts.join(":");
        if (["client", "server", "proxy"].includes(role) && specifier) contexts[role].push(specifier);
      }
      contexts.all = [...new Set([...contexts.client, ...contexts.server, ...contexts.proxy])].sort();
      return [`${run.candidate.name}@${run.candidate.version}`, contexts];
    }));
    const optionalPeerObservations = await executeOptionalPeers({ consumer: scratch, matrix: record.optionalPeerMatrix.filter((row) => row.set === set), env, frameworkByPackage });
    const uninstall = await runProcess("npm", ["uninstall", "--ignore-scripts", ...selected.packages.map((entry) => entry.name)], { cwd: scratch, env, timeout: 180_000 });
    operations.push(aggregateNpmOperation("uninstall", uninstall));
    if (uninstall.exitCode !== 0 || uninstall.timedOut || uninstall.signal || uninstall.launchError) throw new Error("aggregate npm uninstall execution failed");
    for (const entry of selected.packages) {
      try { await lstat(join(scratch, "node_modules", ...entry.name.split("/"))); throw new Error(`${entry.name} remained installed after aggregate uninstall`); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await writeFile(join(scratch, "package.json"), before.manifest);
    await writeFile(join(scratch, "package-lock.json"), before.lock);
    const reinstall = await runProcess("npm", ["install", "--ignore-scripts", "--save-exact"], { cwd: scratch, env, timeout: 180_000 });
    operations.push(aggregateNpmOperation("reinstall", reinstall));
    if (reinstall.exitCode !== 0 || reinstall.timedOut || reinstall.signal || reinstall.launchError) throw new Error("aggregate npm reinstall execution failed");
    const after = { manifest: await readFile(join(scratch, "package.json"), "utf8"), lock: await readFile(join(scratch, "package-lock.json"), "utf8"), tree: await treeDigest(join(scratch, "node_modules")) };
    if (before.manifest !== after.manifest || before.lock !== after.lock || before.tree !== after.tree) throw new Error("aggregate uninstall/reinstall did not restore byte-identical manifest, lockfile, and dependency tree");
    for (const entry of selected.packages) {
      const installed = JSON.parse(await readFile(join(scratch, "node_modules", ...entry.name.split("/"), "package.json"), "utf8"));
      if (installed.name !== entry.name || installed.version !== entry.version) throw new Error(`${entry.name} identity was not restored after aggregate reinstall`);
    }
    const transcript = {
      schema: "foundry-public-npm-aggregate-transcript-v1",
      version: 1,
      plan: { path: AGGREGATE_CANARY_PATH, setsSha256: aggregatePlanSha256(record), closurePath, closureSha256: closure?.canonicalSha256 },
      set,
      repositoryRedirects,
      peerResolution: { requested: record.peerResolution.requested, actual: Object.fromEntries(Object.entries(actualPeerResolution).sort()), disposition: record.peerResolution.disposition },
      operations,
      consumer: { manifestSha256: hash(before.manifest), lockfileSha256: hash(before.lock), controller: `${controller.name}@${controller.version}`, singularController: true, identities: selected.packages.map((entry) => `${entry.name}@${entry.version}`), rollback: { packageAbsenceProven: true, manifestRestored: true, lockfileRestored: true, identitiesRestored: true } },
      packages: runs.map((run, index) => ({ name: artifacts[index].entry.name, version: artifacts[index].entry.version, qualification: artifacts[index].entry.qualification, publication: artifacts[index].entry.publication, served: { name: artifacts[index].entry.name, version: artifacts[index].entry.version, packageManifestSha256: artifacts[index].evidence.packedManifestSha256, tarball: { sha1: artifacts[index].evidence.shasum, sha256: artifacts[index].evidence.sha256, sha512: artifacts[index].evidence.sha512 } }, installedManifestSha256: run.coverage.installedManifestSha256, run })),
      optionalPeerObservations,
      dimensions: [
        ["install", 1],
        ["exports", runs.reduce((sum, run) => sum + run.coverage.declaredExportKeys, 0)],
        ["framework", runs.reduce((sum, run) => sum + run.coverage.frameworkExports, 0)],
        ["bins", runs.reduce((sum, run) => sum + run.coverage.bins, 0)],
        ["cases", runs.reduce((sum, run) => sum + run.observations.filter((observation) => observation.kind === "case").length, 0)],
        ["optionalPeers", optionalPeerObservations.length],
        ["rollback", 1],
      ].map(([dimension, count]) => ({ dimension, count, ok: true })),
    };
    transcript.canonicalSha256 = hash(JSON.stringify(stable(transcript)));
    const qualificationContracts = prepareCandidate ? null : Object.fromEntries(artifacts.map((artifact) => [`${artifact.entry.name}@${artifact.entry.version}`, artifact.qualification.transcript]));
    const candidateContracts = Object.fromEntries(artifacts.map((artifact) => [`${artifact.entry.name}@${artifact.entry.version}`, { qualification: artifact.qualification.candidate, publication: artifact.publicationCandidate }]));
    const transcriptFindings = validateSatisfiedAggregateTranscript(transcript, { plan: record, closure, expectedRepositoryRedirects: canonicalRedirectProjection(requiredRepositoryRedirects), qualificationContracts, candidateContracts });
    if (transcriptFindings.length) throw new Error(`generated aggregate transcript invalid: ${transcriptFindings.map((item) => item.rule).join(",")}`);
    return { verdict: runs.every((run) => run.ok) ? "satisfied" : "violated", transcript };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
