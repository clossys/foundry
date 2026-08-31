import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertCredentialFree, runCandidateQualification, writeNextFixture } from "./candidate-runner.mjs";
import { installedPackageRoots, runProcess } from "./packed-consumer-readiness.mjs";
import { PUBLIC_NPM_REGISTRY, validatePublicNpmRegistryProof, verifyGithubRepositoryRedirect, verifyPublicNpmArtifact } from "./public-npm-registry.mjs";

export const AGGREGATE_CANARY_PATH = "governance/public-npm-aggregate-canary.json";
export const AGGREGATE_TRANSCRIPT_DIRECTORY = "governance/public-npm-aggregate-transcripts";
export const AGGREGATE_CLOSURE_DIRECTORY = "governance/public-npm-aggregate-closures";
export const ALL_PACKAGE_RELEASE_ORDER = Object.freeze([
  "advisor", "starter", "controller", "strategist", "writer", "designer", "architect", "bouncer", "butler", "giver", "influencer", "integrator", "keeper", "locksmith", "messenger", "observer", "builder", "inspector", "publisher",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const NAME = /^@clossys\/([a-z0-9][a-z0-9-]*)$/;
const statuses = new Set(["published", "held", "pending"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));

function finding(findings, rule, message) { findings.push({ rule, message }); }
export function assertAggregateRuntime({ node = process.version, npm = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(), zlib = process.versions.zlib } = {}) {
  if (node !== "v24.19.0" || npm !== "11.17.0" || !zlib?.startsWith("1.3.2.1-motley-3246f1")) throw new Error(`aggregate canary requires Node 24.19.0, npm 11.17.0, and zlib 1.3.2.1-motley-3246f1 (received ${node}, ${npm}, ${zlib})`);
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

function publicationCandidate(publication, key) {
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
  if (!Array.isArray(record.sets) || record.sets.length !== 2 || record.sets.map((set) => set?.id).join("\0") !== "baseline\0oidc-successor") {
    finding(findings, "sets", "aggregate record must retain the exact baseline and oidc-successor sets");
  }
  const identities = new Set();
  for (const set of record.sets ?? []) {
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
    const selected = record.sets.find((set) => set.id === row?.set)?.packages.find((entry) => entry.packageKey === row?.packageKey);
    if (!selected || !exactKeys(row, ["set", "packageKey", "name", "version", "peers"]) || row.name !== selected.name || row.version !== selected.version || !Array.isArray(row.peers) || row.peers.some((peer) => !exactKeys(peer, ["peer", "outcomes"]) || typeof peer.peer !== "string" || !object(peer.outcomes) || Object.values(peer.outcomes).some((outcome) => outcome !== "imports" && outcome !== "rejects"))) finding(findings, "optional-peer-row", "optional-peer rows must be closed and exactly join one frozen package identity");
  }
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

export function validateAggregateClosure(plan, closure, { read = null } = {}) {
  const findings = [];
  let selected;
  try { selected = resolveAggregateClosure(plan, closure?.set, closure).selected; }
  catch (error) { return [{ rule: "closure", message: error.message }]; }
  for (const entry of selected.packages) {
    if (!/^governance\/release-qualifications\/[a-z0-9-]+-\d+\.\d+\.\d+\.json$/.test(entry.qualification.path) || !SHA256.test(entry.qualification.sha256) || !/^governance\/release-publications\/(?:later\/[a-z0-9-]+-\d+\.\d+\.\d+|clossys-npmjs-trio)\.json$/.test(entry.publication.path) || !SHA256.test(entry.publication.sha256) || entry.publication.member !== entry.packageKey) {
      finding(findings, "closure-ref", `${entry.name}@${entry.version} closure reference is outside the closed immutable evidence namespaces`);
      continue;
    }
    if (read) try {
      const qualification = parse(read(entry.qualification.path), entry.qualification.path, findings);
      const publication = parse(read(entry.publication.path), entry.publication.path, findings);
      if (hash(read(entry.qualification.path)) !== entry.qualification.sha256 || qualification?.candidate?.name !== entry.name || qualification?.candidate?.version !== entry.version) finding(findings, "qualification-join", `${entry.name}@${entry.version} closure qualification does not join exact bytes`);
      if (hash(read(entry.publication.path)) !== entry.publication.sha256 || !candidateBytesJoin(publicationCandidate(publication, entry.packageKey), publicationCandidate(publication, entry.packageKey)) || publicationCandidate(publication, entry.packageKey)?.name !== entry.name || publicationCandidate(publication, entry.packageKey)?.version !== entry.version) finding(findings, "publication-join", `${entry.name}@${entry.version} closure publication does not join exact bytes`);
    } catch { finding(findings, "closure-read", `${entry.name}@${entry.version} closure evidence is unavailable`); }
  }
  return findings;
}

/** Validate a separately retained, satisfied aggregate execution transcript. */
export function validateSatisfiedAggregateTranscript(transcript, { plan, closure, path = AGGREGATE_CANARY_PATH } = {}) {
  const findings = [];
  const expectedSetsSha256 = hash(JSON.stringify(stable({ peerResolution: plan?.peerResolution, sets: plan?.sets, optionalPeerMatrix: plan?.optionalPeerMatrix })));
  if (!exactKeys(transcript, ["schema", "version", "plan", "set", "repositoryRedirects", "peerResolution", "packages", "consumer", "dimensions", "canonicalSha256"])) return [{ rule: "shape", message: "closed aggregate transcript schema required" }];
  if (transcript.schema !== "foundry-public-npm-aggregate-transcript-v1" || transcript.version !== 1 || !exactKeys(transcript.plan, ["path", "setsSha256", "closurePath", "closureSha256"]) || transcript.plan.path !== path || transcript.plan.setsSha256 !== expectedSetsSha256 || !new RegExp(`^${AGGREGATE_CLOSURE_DIRECTORY}/[a-z0-9-]+-[a-f0-9]{64}\\.json$`).test(transcript.plan.closurePath ?? "") || transcript.plan.closureSha256 !== closure?.canonicalSha256) finding(findings, "plan-join", "transcript must bind the exact frozen plan and immutable closure bytes");
  let selected = null;
  try { selected = resolveAggregateClosure(plan, transcript.set, closure).selected; }
  catch { finding(findings, "closure", "transcript closure cannot resolve all nineteen frozen identities"); }
  if (!selected || selected.packages?.some((entry) => !entry.qualification || !entry.publication) || !Array.isArray(transcript.packages) || transcript.packages.length !== ALL_PACKAGE_RELEASE_ORDER.length) finding(findings, "packages", "a satisfied transcript requires exactly one closed qualified publication row for every frozen package");
  else for (let index = 0; index < selected.packages.length; index += 1) {
    const expected = selected.packages[index], actual = transcript.packages[index];
    if (!exactKeys(actual, ["name", "version", "qualification", "publication", "served", "installedManifestSha256", "run"]) || actual.name !== expected.name || actual.version !== expected.version || JSON.stringify(actual.qualification) !== JSON.stringify(expected.qualification) || JSON.stringify(actual.publication) !== JSON.stringify(expected.publication) || !exactKeys(actual.served, ["name", "version", "packageManifestSha256", "tarball"]) || actual.served.name !== actual.name || actual.served.version !== actual.version || !SHA256.test(actual.served.packageManifestSha256 ?? "") || !exactKeys(actual.served.tarball, ["sha1", "sha256", "sha512"]) || !/^[a-f0-9]{40}$/.test(actual.served.tarball.sha1 ?? "") || !SHA256.test(actual.served.tarball.sha256 ?? "") || !/^[a-f0-9]{128}$/.test(actual.served.tarball.sha512 ?? "") || !SHA256.test(actual.installedManifestSha256 ?? "") || !object(actual.run) || !SHA256.test(actual.run.canonicalSha256 ?? "")) finding(findings, "package-join", `transcript package row ${index} must exactly join the frozen identity, served bytes, installed manifest, and immutable records`);
  }
  if (!Array.isArray(transcript.repositoryRedirects) || transcript.repositoryRedirects.some((item) => !exactKeys(item, ["historicalRepository", "repository", "repositoryId", "kind"]) || item.repository !== "clossys/foundry" || item.historicalRepository !== "clossys/platform" || item.repositoryId !== 1325931929 || item.kind !== "verified")) finding(findings, "repository-redirect", "transcript must retain only exact verified sealed historical repository redirects");
  if (!exactKeys(transcript.peerResolution, ["requested", "actual", "disposition"]) || !object(transcript.peerResolution.requested) || !object(transcript.peerResolution.actual) || !Array.isArray(transcript.peerResolution.disposition)) finding(findings, "peer-resolution", "transcript must retain reviewed peer request, actual resolution, and conflict disposition");
  if (!exactKeys(transcript.consumer, ["manifestSha256", "lockfileSha256", "controller", "singularController", "identities", "rollback"]) || !SHA256.test(transcript.consumer.manifestSha256 ?? "") || !SHA256.test(transcript.consumer.lockfileSha256 ?? "") || transcript.consumer.singularController !== true || !Array.isArray(transcript.consumer.identities) || transcript.consumer.identities.length !== ALL_PACKAGE_RELEASE_ORDER.length || !exactKeys(transcript.consumer.rollback, ["packageAbsenceProven", "manifestRestored", "lockfileRestored", "identitiesRestored"]) || Object.values(transcript.consumer.rollback).some((value) => value !== true)) finding(findings, "rollback", "transcript must retain exact aggregate identity and complete real rollback evidence");
  const required = ["exports", "framework", "bins", "cases", "optionalPeers", "rollback"];
  if (!Array.isArray(transcript.dimensions) || transcript.dimensions.length !== required.length || transcript.dimensions.map((entry) => entry?.dimension).join("\0") !== required.join("\0") || transcript.dimensions.some((entry) => !exactKeys(entry, ["dimension", "count", "ok"]) || !Number.isSafeInteger(entry.count) || entry.count < 1 || entry.ok !== true)) finding(findings, "dimensions", "transcript must retain every aggregate execution dimension once with a positive satisfied count");
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
  if (!new RegExp(`^${AGGREGATE_TRANSCRIPT_DIRECTORY}/[a-z0-9-]+-[a-f0-9]{64}\\.json$`).test(path ?? "")) return [{ rule: "transcript-path", message: "satisfied records must use the closed immutable aggregate transcript namespace" }];
  if (!Array.isArray(history) || history.length === 0) return [{ rule: "transcript-history", message: "satisfied record must have one introduction commit" }];
  const introductions = history.filter((entry) => entry?.status === "A");
  if (introductions.length !== 1 || history[history.length - 1]?.status !== "A" || history.some((entry) => !exactKeys(entry, ["commit", "status", "sha256"]) || !/^[a-f0-9]{40}$/.test(entry.commit ?? "") || !["A", "M", "D"].includes(entry.status) || !SHA256.test(entry.sha256 ?? ""))) finding(findings, "transcript-history", "satisfied record history must contain one valid introduction only");
  if (history.length !== 1) finding(findings, "transcript-rewrite", "satisfied record may not be touched after its introduction");
  return findings;
}

function credentiallessNpmEnv(base, root) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (!/(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i.test(key) && !/^npm_config_/i.test(key)) env[key] = value;
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

function controllerPhysicalIdentities(tree, seen = new Set(), found = []) {
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
      else if (item.isFile()) rows.push([path.slice(root.length + 1), hash(await readFile(path))]);
    }
  };
  await walk(root); return hash(JSON.stringify(rows.sort(([a], [b]) => a.localeCompare(b))));
}

/** Run one immutable optional-peer matrix serially against an already-installed consumer. */
export async function runAggregateOptionalPeerMatrix({ consumer, matrix, env, frameworkByPackage = new Map() }) {
  const before = { manifest: hash(await readFile(join(consumer, "package.json"))), lock: hash(await readFile(join(consumer, "package-lock.json"))), tree: await treeDigest(join(consumer, "node_modules")) };
  const observations = [];
  for (const row of matrix) for (const peerRow of row.peers) {
    const roots = await installedPackageRoots(join(consumer, "node_modules"), peerRow.peer);
    if (roots.length === 0) throw new Error(`${row.name} optional peer ${peerRow.peer} is not physically installed before omission`);
    const moved = [];
    try {
      for (const root of roots.sort((a, b) => b.length - a.length)) { const hidden = `${root}.foundry-omitted`; await rename(root, hidden); moved.push([root, hidden]); }
      const framework = frameworkByPackage.get(`${row.name}@${row.version}`) ?? { client: [], server: [], proxy: [], all: [] };
      for (const [specifier, expected] of Object.entries(peerRow.outcomes)) {
        if (framework.all.includes(specifier)) continue;
        const result = await runProcess(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], { cwd: consumer, env, timeout: 30_000 });
        const actual = result.exitCode === 0 ? "imports" : "rejects";
        if (result.timedOut || result.launchError || actual !== expected) throw new Error(`${row.name} omission ${peerRow.peer} ${specifier} expected ${expected}, received ${actual}`);
        observations.push({ package: row.name, version: row.version, peer: peerRow.peer, specifier, outcome: actual });
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
        if (result.timedOut || (peerRow.peer !== "next" && result.launchError) || actual !== [...expected][0]) throw new Error(`${row.name} omission ${peerRow.peer} Next evaluator expected ${[...expected][0]}, received ${actual}`);
        for (const specifier of framework.all) observations.push({ package: row.name, version: row.version, peer: peerRow.peer, specifier, outcome: actual, evaluator: peerRow.peer === "next" ? "next-bin-absent" : "next-build" });
      }
    } finally {
      for (const [root, hidden] of moved.reverse()) await rename(hidden, root);
    }
    const after = { manifest: hash(await readFile(join(consumer, "package.json"))), lock: hash(await readFile(join(consumer, "package-lock.json"))), tree: await treeDigest(join(consumer, "node_modules")) };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${row.name} omission ${peerRow.peer} did not restore aggregate consumer bytes`);
  }
  return observations;
}

/**
 * The live runner is intentionally unavailable until every frozen member has
 * a retained public record. It verifies anonymous served bytes before any
 * install, then uses the current package-neutral candidate adapters for all
 * declared exports, contexts, bins, 0/1/2 cases, peers and rollback.
 */
export async function runAggregatePublicNpmCanary({ root, record, set = "oidc-successor", closure = null, closurePath = null, requirePinnedRuntime = false, fetchImpl = fetch, verifyArtifact = verifyPublicNpmArtifact, verifyRedirect = verifyGithubRepositoryRedirect, environment = process.env } = {}) {
  if (requirePinnedRuntime) assertAggregateRuntime();
  assertCredentialFree(environment);
  if (Object.entries(environment).some(([key, value]) => /(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i.test(key) && typeof value === "string" && value.length > 0)) throw new Error("aggregate canary refuses credential-bearing parent environment");
  const read = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" });
  const findings = validateAggregateCanary(record, { read });
  if (findings.length) throw new Error(`aggregate record invalid: ${findings.map((item) => item.rule).join(",")}`);
  const resolved = resolveAggregateClosure(record, set, closure);
  const selected = resolved.selected;
  const incomplete = resolved.incomplete;
  if (incomplete.length) return { verdict: "indeterminate", reason: "publication-records-pending", pending: incomplete.map((entry) => `${entry.name}@${entry.version}`) };
  if (!new RegExp(`^${AGGREGATE_CLOSURE_DIRECTORY}/[a-z0-9-]+-[a-f0-9]{64}\\.json$`).test(closurePath ?? "")) throw new Error("live aggregate canary requires one closed immutable closure path");
  const closureFindings = validateAggregateClosure(record, closure, { read });
  if (closureFindings.length) throw new Error(`aggregate closure invalid: ${closureFindings.map((item) => item.rule).join(",")}`);
  const artifacts = [];
  const transition = JSON.parse(read("governance/package-identity-transition.json"));
  const repositoryRedirects = [];
  for (const entry of selected.packages) {
    const publication = JSON.parse(read(entry.publication.path));
    const proof = publicationProof(publication, entry.packageKey);
    const publishedCandidate = publicationCandidate(publication, entry.packageKey);
    const repository = proof?.evidence?.repository;
    if (!repository || !publishedCandidate) throw new Error(`${entry.name}@${entry.version} publication has no exact anonymous registry candidate`);
    const historical = sealedHistoricalRepository({ entry, proof, transition });
    if (historical) {
      const redirect = await verifyRedirect({ ...historical, fetchImpl });
      if (redirect?.kind !== "verified") throw new Error(`${entry.name}@${entry.version} historical repository redirect proof did not verify`);
      if (!repositoryRedirects.some((item) => JSON.stringify(item) === JSON.stringify({ ...historical, kind: redirect.kind }))) repositoryRedirects.push({ ...historical, kind: redirect.kind });
    }
    const result = await verifyArtifact({ registry: PUBLIC_NPM_REGISTRY, name: entry.name, version: entry.version, repository, fetchImpl });
    if (result.kind !== "verified") throw new Error(`${entry.name}@${entry.version} anonymous registry verification did not complete: ${result.kind}`);
    const qualification = JSON.parse(read(entry.qualification.path));
    const expected = qualification.candidate;
    if (result.evidence.sha1 !== expected.tarball.sha1 || result.evidence.sha256 !== expected.tarball.sha256 || result.evidence.sha512 !== expected.tarball.sha512 || result.evidence.packedManifestSha256 !== expected.packageManifestSha256) throw new Error(`${entry.name}@${entry.version} served bytes do not join its immutable qualification candidate`);
    if (!candidateBytesJoin({ name: entry.name, version: entry.version, packageManifestSha256: result.evidence.packedManifestSha256, tarball: result.evidence }, publishedCandidate)) throw new Error(`${entry.name}@${entry.version} served bytes do not join its immutable publication candidate`);
    const proofFindings = validatePublicNpmRegistryProof(proof, { name: entry.name, version: entry.version, repository, bytes: result.bytes });
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
    for (const entry of selected.packages) {
      const qualification = JSON.parse(read(entry.qualification.path));
      const policy = JSON.parse(execFileSync("git", ["show", `${qualification.reviewedCommit}:governance/release-qualification-policy.json`], { cwd: root, encoding: "utf8" }));
      const selectedPolicy = policy.packages[entry.name];
      const adapter = JSON.parse(execFileSync("git", ["show", `${qualification.reviewedCommit}:${selectedPolicy.adapterPath}`], { cwd: root, encoding: "utf8" }));
      for (const [name, version] of Object.entries(adapter.peerInstall ?? {})) {
        const requested = peerRequests.get(name) ?? new Set(); requested.add(version); peerRequests.set(name, requested);
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
    const install = execFileSync("npm", ["install", "--ignore-scripts", "--save-exact"], { cwd: scratch, env, encoding: "utf8" });
    void install;
    const before = { manifest: await readFile(join(scratch, "package.json"), "utf8"), lock: await readFile(join(scratch, "package-lock.json"), "utf8") };
    const declaredConsumer = JSON.parse(before.manifest);
    for (const artifact of artifacts) {
      const entry = artifact.entry;
      const installedBytes = await readFile(join(scratch, "node_modules", ...entry.name.split("/"), "package.json"));
      const installed = JSON.parse(installedBytes);
      if (declaredConsumer.dependencies?.[entry.name] !== `file:./artifacts/${entry.packageKey}.tgz` || installed.name !== entry.name || installed.version !== entry.version || hash(installedBytes) !== artifact.evidence.packedManifestSha256) throw new Error(`${entry.name} is not one exact direct aggregate identity joined to its served packed manifest`);
    }
    const controller = JSON.parse(await readFile(join(scratch, "node_modules", "@clossys", "controller", "package.json"), "utf8"));
    const expectedController = selected.packages.find((entry) => entry.packageKey === "controller").version;
    if (controller.name !== "@clossys/controller" || controller.version !== expectedController) throw new Error("aggregate consumer did not resolve the one exact Controller identity");
    const dependencyTree = JSON.parse(execFileSync("npm", ["ls", "@clossys/controller", "--all", "--long", "--json"], { cwd: scratch, env, encoding: "utf8" }));
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
      runs.push(await runCandidateQualification({ tarball, policy, adapter, fixtures, manifestBins, registry: { scope: "@clossys", registry: PUBLIC_NPM_REGISTRY }, consumerRoot: scratch, skipRollback: true, restoreConsumerOverlay: true }));
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
    const optionalPeerObservations = await runAggregateOptionalPeerMatrix({ consumer: scratch, matrix: record.optionalPeerMatrix.filter((row) => row.set === set), env, frameworkByPackage });
    execFileSync("npm", ["uninstall", "--ignore-scripts", ...selected.packages.map((entry) => entry.name)], { cwd: scratch, env, encoding: "utf8" });
    for (const entry of selected.packages) {
      try { await lstat(join(scratch, "node_modules", ...entry.name.split("/"))); throw new Error(`${entry.name} remained installed after aggregate uninstall`); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await writeFile(join(scratch, "package.json"), before.manifest);
    await writeFile(join(scratch, "package-lock.json"), before.lock);
    execFileSync("npm", ["install", "--ignore-scripts", "--save-exact"], { cwd: scratch, env, encoding: "utf8" });
    const after = { manifest: await readFile(join(scratch, "package.json"), "utf8"), lock: await readFile(join(scratch, "package-lock.json"), "utf8") };
    if (before.manifest !== after.manifest || before.lock !== after.lock) throw new Error("aggregate uninstall/reinstall did not restore byte-identical manifest and lockfile");
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
      peerResolution: { requested: record.peerResolution.requested, actual: Object.fromEntries(Object.entries(peerInstall).sort()), disposition: record.peerResolution.disposition },
      consumer: { manifestSha256: hash(before.manifest), lockfileSha256: hash(before.lock), controller: `${controller.name}@${controller.version}`, singularController: true, identities: selected.packages.map((entry) => `${entry.name}@${entry.version}`), rollback: { packageAbsenceProven: true, manifestRestored: true, lockfileRestored: true, identitiesRestored: true } },
      packages: runs.map((run, index) => ({ name: artifacts[index].entry.name, version: artifacts[index].entry.version, qualification: artifacts[index].entry.qualification, publication: artifacts[index].entry.publication, served: { name: artifacts[index].entry.name, version: artifacts[index].entry.version, packageManifestSha256: artifacts[index].evidence.packedManifestSha256, tarball: { sha1: artifacts[index].evidence.sha1, sha256: artifacts[index].evidence.sha256, sha512: artifacts[index].evidence.sha512 } }, installedManifestSha256: run.coverage.installedManifestSha256, run })),
      dimensions: [
        ["exports", runs.reduce((sum, run) => sum + run.coverage.declaredExportKeys, 0)],
        ["framework", runs.reduce((sum, run) => sum + run.coverage.frameworkExports, 0)],
        ["bins", runs.reduce((sum, run) => sum + run.coverage.bins, 0)],
        ["cases", runs.reduce((sum, run) => sum + run.observations.filter((observation) => observation.kind === "case").length, 0)],
        ["optionalPeers", optionalPeerObservations.length],
        ["rollback", 1],
      ].map(([dimension, count]) => ({ dimension, count, ok: true })),
    };
    transcript.canonicalSha256 = hash(JSON.stringify(stable(transcript)));
    return { verdict: runs.every((run) => run.ok) ? "satisfied" : "violated", transcript };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
