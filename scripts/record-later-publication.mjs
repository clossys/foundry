#!/usr/bin/env node
// Construct one immutable, package-neutral later-publication record from an
// exact qualification and anonymous registry evidence. This command never
// publishes and never accepts credentials. The record is the only output.

import { constants, closeSync, fstatSync, fsyncSync, lstatSync, linkSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync, mkdtempSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";

import { assertCredentialFree } from "./lib/candidate-runner.mjs";
import { currentQualificationJoins, parseStrictJson, qualificationPath, qualificationRecordHistory, validateCandidateQualification } from "./lib/candidate-qualification.mjs";
import { fetchPublicNpmArtifact } from "./fetch-public-npm-artifact.mjs";
import { assertPackageAuthorized, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { repositoryIdentityFromPackument, validatePublicNpmRegistryProof } from "./lib/public-npm-registry.mjs";
import { validateLaterPublication } from "./lib/release-later-publication.mjs";
import { assertReleaseRuntime } from "./lib/release-runtime.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const USAGE = "Usage: --package <key> --qualification <record.json> --publication <publication.json> (--candidate <candidate.tgz> --proof <registry-proof.json> | --fetch)";
const OUTPUT_DIRECTORY = "governance/release-publications/later";
const CATALOG_PATH = "governance/release-catalog.json";
const PUBLICATION_FIELDS = ["mode", "publishedAt", "reference", "provenance"];
const SOURCE_FIELDS = ["reviewedCommit", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256"];

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function regularBytes(path, label) {
  const absolute = resolve(path);
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const state = fstatSync(descriptor);
    if (!state.isFile() || state.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
    const bytes = readFileSync(descriptor);
    if (bytes.length === 0) throw new Error(`${label} must not be empty`);
    return { absolute, bytes };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseJson(bytes, label) {
  try { return parseStrictJson(bytes.toString("utf8")); }
  catch (error) { throw new Error(`${label} must contain one strict JSON object: ${error.message}`); }
}

function closed(value, fields, label) {
  if (!object(value)) throw new Error(`${label} must be one JSON object`);
  if (Object.keys(value).some((key) => !fields.includes(key))) throw new Error(`${label} contains an unknown field`);
}

function packedManifest(bytes) {
  let output;
  try {
    output = execFileSync("tar", ["-xOzf", "-", "package/package.json"], { input: bytes, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  } catch {
    throw new Error("candidate tarball does not contain a readable package/package.json");
  }
  return parseJson(Buffer.from(output), "candidate packed manifest");
}

function gitAncestor(root, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, stdio: "ignore" });
    return true;
  } catch { return false; }
}

function prePublicationSourceValid(root, qualification, qualificationIntroduction, publication) {
  if (publication.mode !== "trusted-publisher") return true;
  const sourceSha = publication.provenance?.sourceSha;
  if (!SHA1.test(sourceSha ?? "") || sourceSha === qualificationIntroduction) return false;
  if (!gitAncestor(root, qualificationIntroduction, sourceSha) || !gitAncestor(root, sourceSha, "HEAD")) return false;
  try {
    const joins = currentQualificationJoins(root, qualification.candidate, sourceSha);
    return [
      ["packageTreeSha1", qualification.candidate?.packageTreeSha1],
      ["packageManifestSha256", qualification.candidate?.packageManifestSha256],
      ["rootPackageJsonSha256", qualification.rootPackageJsonSha256],
      ["rootPackageLockSha256", qualification.rootPackageLockSha256],
      ["policySha256", qualification.candidate?.policySha256],
      ["adapterSha256", qualification.candidate?.adapterSha256],
      ["fixtureSetSha256", qualification.candidate?.fixtureSetSha256],
    ].every(([key, expected]) => joins[key] === expected)
      && same(joins.archetypes, qualification.archetypes)
      && same(joins.dimensions, qualification.transcript?.dimensions);
  } catch { return false; }
}

function validatePublicationInput(publication) {
  closed(publication, PUBLICATION_FIELDS, "publication evidence");
  if (!["owner-present", "trusted-publisher"].includes(publication.mode)) throw new Error("publication mode must be owner-present or trusted-publisher");
  if (publication.mode === "owner-present" && publication.provenance !== undefined) throw new Error("owner-present publication cannot carry provenance");
  if (publication.mode === "trusted-publisher" && !object(publication.provenance)) throw new Error("trusted-publisher publication requires provenance");
}

export function buildLaterPublicationRecord({ packageKey, qualificationPath: qualificationPathInput, qualification, qualificationBytes, candidateBytes, proof, catalog, catalogBytes, publication, recordPath, provenanceSourceValid = false }) {
  if (!KEY.test(packageKey ?? "")) throw new Error("package key is invalid");
  validatePublicationInput(publication);
  if (!Buffer.isBuffer(candidateBytes) || candidateBytes.length === 0) throw new Error("candidate bytes are required");
  if (!object(proof) || proof.schemaVersion !== 2 || proof.kind !== "public-npm-anonymous-registry-proof-v2") throw new Error("later publication records require anonymous registry proof v2");
  const candidate = qualification.candidate;
  const proofEvidence = proof.evidence;
  if (!object(proofEvidence) || proofEvidence.name !== candidate?.name || proofEvidence.version !== candidate?.version
    || proofEvidence.size !== candidateBytes.length
    || !same({ sha1: proofEvidence.shasum, sha256: proofEvidence.sha256, sha512: proofEvidence.sha512 }, candidate?.tarball)) {
    throw new Error("anonymous registry proof does not exactly join the candidate bytes");
  }
  const expectedQualificationStem = `governance/release-qualifications/clossys-${packageKey}-${candidate?.version}.json`;
  const expectedRecordPath = `${OUTPUT_DIRECTORY}/${packageKey}-${candidate?.version}.json`;
  if (qualificationPathInput !== expectedQualificationStem) throw new Error("qualification path is not the canonical package/version path");
  if (recordPath !== expectedRecordPath) throw new Error("publication record path is not the canonical package/version path");
  const candidateProjection = {
    name: candidate?.name,
    version: candidate?.version,
    packageTreeSha1: candidate?.packageTreeSha1,
    packageManifestSha256: candidate?.packageManifestSha256,
    tarball: structuredClone(candidate?.tarball),
  };
  const source = Object.fromEntries(SOURCE_FIELDS.map((key) => [key, key === "policySha256" || key === "adapterSha256" || key === "fixtureSetSha256" ? candidate[key] : qualification[key]]));
  const record = {
    schemaVersion: publication.mode === "trusted-publisher" ? 2 : 1,
    kind: publication.mode === "trusted-publisher" ? "foundry-trusted-publication-v2" : "foundry-later-publication-v1",
    qualification: { path: qualificationPathInput, sha256: digest("sha256", qualificationBytes) },
    candidate: candidateProjection,
    source,
    catalog: { path: CATALOG_PATH, sha256: digest("sha256", catalogBytes), packageKey },
    publication: structuredClone(publication),
    registryProof: structuredClone(proof),
  };
  const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const findings = validateLaterPublication(record, {
    recordPath,
    recordBytes: recordBytes.toString("utf8"),
    qualification,
    qualificationBytes: qualificationBytes.toString("utf8"),
    qualificationPath: qualificationPathInput,
    catalogBytes: catalogBytes.toString("utf8"),
    catalog,
    currentCatalog: catalog,
    provenanceSourceValid,
  });
  if (findings.length) throw new Error(`constructed publication record is invalid: ${findings[0].message}`);
  return { record, recordBytes };
}

function validateCandidateAndProof({ root, packageKey, qualification, qualificationPathInput, qualificationBytes, candidateBytes, proof, catalog, catalogBytes, publication }) {
  const identity = readCurrentReleaseIdentity({ path: resolve(root, "package-scope.json") });
  const target = resolveReleaseTarget(catalog, identity);
  assertPackageAuthorized(target, packageKey);
  if (target.registry !== "https://registry.npmjs.org" || target.access !== "public") throw new Error("later publication requires the exact active public npm target");

  if (!object(qualification) || qualification.timing !== "pre-publication") throw new Error("qualification must be one pre-publication record");
  const candidate = qualification.candidate;
  if (!object(candidate) || candidate.name !== `${identity.scope}/${packageKey}` || typeof candidate.version !== "string") throw new Error("qualification does not bind the requested package key");
  const qualificationRecordPath = qualificationPath(root, candidate);
  const expectedQualificationPath = resolve(root, qualificationRecordPath);
  if (resolve(qualificationPathInput) !== expectedQualificationPath) throw new Error("qualification path is not the canonical package/version record");

  const packageManifest = regularBytes(join(root, "packages", packageKey, "package.json"), "current package manifest");
  const manifest = parseJson(packageManifest.bytes, "current package manifest");
  if (manifest.name !== candidate.name || manifest.version !== candidate.version || digest("sha256", packageManifest.bytes) !== candidate.packageManifestSha256) throw new Error("current package manifest does not match the immutable qualification");
  const repository = repositoryIdentityFromPackument({ repository: manifest.repository, versions: {} }, manifest.version);
  if (!repository) throw new Error("current package manifest has no canonical repository identity");

  const packed = packedManifest(candidateBytes);
  if (packed.name !== candidate.name || packed.version !== candidate.version) throw new Error("candidate tarball does not bind the qualified package identity");
  const candidateHashes = { sha1: digest("sha1", candidateBytes), sha256: digest("sha256", candidateBytes), sha512: digest("sha512", candidateBytes) };
  if (!same(candidateHashes, candidate.tarball)) throw new Error("candidate tarball differs from the qualification record");

  const proofFindings = validatePublicNpmRegistryProof(proof, { name: candidate.name, version: candidate.version, repository, bytes: candidateBytes });
  if (proofFindings.length) throw new Error(`anonymous registry proof is invalid: ${proofFindings[0].message}`);
  const proofV2 = proof?.schemaVersion === 2 && proof?.kind === "public-npm-anonymous-registry-proof-v2";
  if (!proofV2) throw new Error("later publication records require anonymous registry proof v2");

  const qualificationHistory = qualificationRecordHistory(root, qualificationRecordPath, candidate, "HEAD", qualificationRecordPath);
  const expected = { name: candidate.name, version: candidate.version, ...currentQualificationJoins(root, candidate, qualificationHistory.introductionCommit) };
  const qualificationFindings = validateCandidateQualification(qualification, { expected });
  if (qualificationFindings.length) throw new Error(`qualification is invalid: ${qualificationFindings[0].message}`);
  if (qualificationHistory.introducedRecordSha256 !== qualificationHistory.retainedRecordSha256) throw new Error("qualification record differs from its immutable introduction blob");

  const recordPath = `${OUTPUT_DIRECTORY}/${packageKey}-${candidate.version}.json`;
  const built = buildLaterPublicationRecord({ packageKey, qualificationPath: qualificationRecordPath, qualification, qualificationBytes, candidateBytes, proof, catalog, catalogBytes, publication, recordPath, provenanceSourceValid: prePublicationSourceValid(root, qualification, qualificationHistory.introductionCommit, publication) });
  return { ...built, recordPath };
}

function writeNoOverwrite(path, bytes) {
  const parent = dirname(path);
  let current = resolve(parent);
  const parents = [];
  while (true) {
    parents.push(current);
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }
  for (const directory of parents.reverse()) {
    const state = lstatSync(directory);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("publication output directory must be a regular directory chain");
  }
  const parentDescriptor = openSync(parent, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let descriptor;
  let linked = false;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    linkSync(temporary, path);
    linked = true;
    fsyncSync(parentDescriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* the final link may already own the bytes */ }
    closeSync(parentDescriptor);
    if (!linked) { /* an existing destination is intentionally never removed */ }
  }
}

export function argsFrom(argv) {
  const result = { fetch: false };
  const seen = new Set();
  for (let index = 2; index < argv.length;) {
    const key = argv[index]?.slice(2);
    if (key === "fetch") {
      if (seen.has(key)) throw new Error(USAGE);
      seen.add(key); result.fetch = true; index += 1;
    } else {
      const value = argv[index + 1];
      if (!Object.hasOwn({ package: true, qualification: true, candidate: true, proof: true, publication: true }, key) || !value || seen.has(key)) throw new Error(USAGE);
      seen.add(key); result[key] = value; index += 2;
    }
  }
  if (!result.package || !result.qualification || !result.publication || !KEY.test(result.package) || (result.fetch && (result.candidate || result.proof)) || (!result.fetch && (!result.candidate || !result.proof))) throw new Error(USAGE);
  return result;
}

export async function createLaterPublicationRecord({ root = process.cwd(), packageKey, qualificationPath: qualificationInput, candidatePath, proofPath, publicationPath, fetch: fetchEvidence = false, fetchImpl = fetch, env = process.env, releaseRuntimeRun }) {
  if (!KEY.test(packageKey ?? "")) throw new Error("package key is invalid");
  assertCredentialFree(env);
  assertReleaseRuntime(releaseRuntimeRun ? { run: releaseRuntimeRun, env } : { env });
  const absoluteRoot = resolve(root);
  const qualificationInputFile = regularBytes(qualificationInput, "qualification record");
  const qualification = parseJson(qualificationInputFile.bytes, "qualification record");
  const publication = parseJson(regularBytes(publicationPath, "publication evidence").bytes, "publication evidence");
  validatePublicationInput(publication);
  const identity = readCurrentReleaseIdentity({ path: resolve(absoluteRoot, "package-scope.json") });
  if (qualification.candidate?.name !== `${identity.scope}/${packageKey}`) throw new Error("qualification package does not match the requested package key");

  let candidateFile, proofFile, temporary;
  try {
    if (fetchEvidence) {
      temporary = mkdtempSync(join(tmpdir(), "foundry-later-publication-"));
      await fetchPublicNpmArtifact({ root: absoluteRoot, packageKey, output: temporary, fetchImpl, env });
      candidateFile = regularBytes(join(temporary, "candidate.tgz"), "fetched candidate");
      proofFile = regularBytes(join(temporary, "registry-proof.json"), "fetched registry proof");
    } else {
      candidateFile = regularBytes(candidatePath, "candidate tarball");
      proofFile = regularBytes(proofPath, "anonymous registry proof");
    }
    const proof = parseJson(proofFile.bytes, "anonymous registry proof");
    const catalogFile = regularBytes(resolve(absoluteRoot, CATALOG_PATH), "release catalog");
    const catalog = loadReleaseCatalog({ path: catalogFile.absolute });
    const built = validateCandidateAndProof({ root: absoluteRoot, packageKey, qualification, qualificationPathInput: qualificationInputFile.absolute, qualificationBytes: qualificationInputFile.bytes, candidateBytes: candidateFile.bytes, proof, catalog, catalogBytes: catalogFile.bytes, publication });
    const output = resolve(absoluteRoot, built.recordPath);
    writeNoOverwrite(output, built.recordBytes);
    const retained = regularBytes(output, "retained publication record");
    if (!retained.bytes.equals(built.recordBytes)) throw new Error("retained publication record changed during creation");
    if (!same(parseJson(retained.bytes, "retained publication record"), built.record)) throw new Error("retained publication record does not self-validate");
    return { path: built.recordPath, bytes: retained.bytes, record: built.record };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

export { writeNoOverwrite };

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const args = argsFrom(process.argv);
    const result = await createLaterPublicationRecord({ packageKey: args.package, qualificationPath: args.qualification, candidatePath: args.candidate, proofPath: args.proof, publicationPath: args.publication, fetch: args.fetch });
    process.stdout.write(`later publication record created: ${result.path}\n`);
  } catch (error) {
    console.error(`record-later-publication: ${error.message}`);
    process.exitCode = 1;
  }
}
