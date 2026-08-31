import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { currentQualificationJoins, parseStrictJson, qualificationPath, qualificationRecordHistory, validateCandidateQualification } from "./candidate-qualification.mjs";
import { publicNpmPackageUrl, publicNpmVersionUrl, PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";
import { TRIO } from "./release-qualification-trio.mjs";

export const LATER_PUBLICATION_DIRECTORY = "governance/release-publications/later";
const CATALOG_PATH = "governance/release-catalog.json";
const QUALIFICATION_PATH = /^governance\/release-qualifications\/[a-z0-9][a-z0-9-]*-\d+\.\d+\.\d+\.json$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const PUBLICATION_REPOSITORY = "https://github.com/clossys/foundry";
const HISTORICAL_PLATFORM_REPOSITORY = "https://github.com/clossys/" + "platform";
const HISTORICAL_PLATFORM_PROVENANCE = new Map([
  ["@clossys/advisor@0.1.5", { sourceSha: "2d582804fc26c0387c7e2f2e30278a3db85f6004", invocation: "https://github.com/clossys/foundry/actions/runs/33335335139/attempts/1" }],
  ["@clossys/starter@0.1.4", { sourceSha: "2d582804fc26c0387c7e2f2e30278a3db85f6004", invocation: "https://github.com/clossys/foundry/actions/runs/33335869341/attempts/1" }],
  ["@clossys/controller@0.8.23", { sourceSha: "2d582804fc26c0387c7e2f2e30278a3db85f6004", invocation: "https://github.com/clossys/foundry/actions/runs/33336158171/attempts/1" }],
]);
const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";
const PUBLISH_REF = "refs/heads/main";
const PUBLISH_EVENT = "workflow_dispatch";
const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const finding = (findings, rule, message) => findings.push({ rule, message });
function closed(findings, value, keys, path) {
  if (!object(value)) { finding(findings, "shape", `${path} must be an object.`); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) finding(findings, "unknown-field", `${path}.${key}`);
}
function canonicalInstant(value) {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}
function boundedText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value);
}
function evidenceUrl(value) {
  if (!boundedText(value, 1024)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
function packageKey(name) { return NAME.test(name ?? "") ? name.slice(name.indexOf("/") + 1) : null; }
function expectedTarballUrl(name, version) {
  const key = packageKey(name);
  return key && VERSION.test(version ?? "") ? `${PUBLIC_NPM_REGISTRY}/@clossys/${key}/-/${key}-${version}.tgz` : null;
}
function activePackages(catalog) {
  const target = catalog?.targets?.find((item) => item?.id === catalog?.defaultTarget && item?.status === "active");
  return Array.isArray(target?.packages) ? target.packages : null;
}
function repositoryName(url) {
  return typeof url === "string" && (url === PUBLICATION_REPOSITORY || url === HISTORICAL_PLATFORM_REPOSITORY) ? url.slice("https://github.com/".length) : null;
}
function exactAttestationUrl(value, name, version) {
  if (!evidenceUrl(value)) return false;
  try { return new URL(value).href === `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/${encodeURIComponent(`${name}@${version}`)}`; } catch { return false; }
}
function invocationRunRoot(value) {
  const match = /^https:\/\/github\.com\/clossys\/foundry\/actions\/runs\/(\d+)\/attempts\/\d+$/.exec(value ?? "");
  return match ? `https://github.com/clossys/foundry/actions/runs/${match[1]}` : null;
}
function trustedProvenance(value, candidate, provenanceSourceValid) {
  if (!object(value)) return false;
  const keys = ["repository", "workflow", "ref", "event", "sourceSha", "builder", "invocation", "attestationUrl"];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  const identity = `${candidate?.name}@${candidate?.version}`;
  const historical = HISTORICAL_PLATFORM_PROVENANCE.get(identity);
  const trustedRepository = value.repository === PUBLICATION_REPOSITORY && provenanceSourceValid === true && Boolean(invocationRunRoot(value.invocation));
  const exactHistorical = value.repository === HISTORICAL_PLATFORM_REPOSITORY && historical?.sourceSha === value.sourceSha && historical.invocation === value.invocation;
  return (trustedRepository || exactHistorical) && value.workflow === PUBLISH_WORKFLOW && value.ref === PUBLISH_REF && value.event === PUBLISH_EVENT && SHA1.test(value.sourceSha ?? "") && value.builder === GITHUB_HOSTED_BUILDER && exactAttestationUrl(value.attestationUrl, candidate?.name, candidate?.version);
}
export function trustedProvenanceSourceValid(root, qualification, qualificationIntroduction, publicationIntroduction, sourceSha, { joinsAt = currentQualificationJoins } = {}) {
  if (!SHA1.test(sourceSha ?? "") || sourceSha === qualificationIntroduction || sourceSha === publicationIntroduction) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", qualificationIntroduction, sourceSha], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", sourceSha, publicationIntroduction], { cwd: root, stdio: "ignore" });
    const candidate = qualification?.candidate;
    const joins = joinsAt(root, candidate, sourceSha);
    return [
      ["packageTreeSha1", candidate?.packageTreeSha1],
      ["packageManifestSha256", candidate?.packageManifestSha256],
      ["rootPackageJsonSha256", qualification?.rootPackageJsonSha256],
      ["rootPackageLockSha256", qualification?.rootPackageLockSha256],
      ["policySha256", candidate?.policySha256],
      ["adapterSha256", candidate?.adapterSha256],
      ["fixtureSetSha256", candidate?.fixtureSetSha256],
    ].every(([key, expected]) => joins[key] === expected)
      && JSON.stringify(joins.archetypes) === JSON.stringify(qualification?.archetypes)
      && JSON.stringify(joins.dimensions) === JSON.stringify(qualification?.transcript?.dimensions);
  } catch { return false; }
}
function exactAttestedSubject(provenance, proof, candidate) {
  return exactAttestationUrl(provenance?.attestationUrl, candidate?.name, candidate?.version)
    && proof?.name === candidate?.name
    && proof?.version === candidate?.version
    && proof?.sha512 === candidate?.tarball?.sha512;
}
function gitBlob(root, ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });
}

function gitBlobOid(root, ref, path) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${ref}:${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function hasPathHistory(root, ref, path) {
  return execFileSync("git", ["log", "--full-history", "-1", "--format=%H", ref, "--", path], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== "";
}

function gitCommitParents(root, commit) {
  const [resolved, ...parents] = execFileSync(
    "git",
    ["rev-list", "--parents", "-n", "1", commit],
    { cwd: root, encoding: "utf8" },
  ).trim().split(" ");
  if (resolved !== commit) throw new Error("retained path history resolved an unexpected commit");
  return parents;
}

/**
 * Validate a one-package publication after the sealed first-publication Trio.
 * `catalogBytes` is deliberately the catalogue blob from this record's one
 * introduction commit. `currentCatalog` independently proves the package has
 * not fallen out of the current reviewed append-only allowlist.
 */
export function validateLaterPublication(record, { recordPath, recordBytes, qualification, qualificationBytes, qualificationPath: expectedQualificationPath, catalogBytes, catalog, currentCatalog = catalog, provenanceSourceValid: sourceValid = false } = {}) {
  const findings = [];
  closed(findings, record, ["schemaVersion", "kind", "qualification", "candidate", "source", "catalog", "publication", "registryProof"], "publication");
  const legacy = record?.schemaVersion === 1 && record?.kind === "foundry-later-publication-v1";
  const trusted = record?.schemaVersion === 2 && record?.kind === "foundry-trusted-publication-v2";
  if (!legacy && !trusted) finding(findings, "publication", "closed later-publication identity required.");
  closed(findings, record?.qualification, ["path", "sha256"], "publication.qualification");
  if (record?.qualification?.path !== expectedQualificationPath || !SHA256.test(record?.qualification?.sha256 ?? "") || typeof qualificationBytes !== "string" || digest(qualificationBytes) !== record?.qualification?.sha256) finding(findings, "qualification", "must bind exact retained qualification bytes.");
  if (qualification?.timing !== "pre-publication") finding(findings, "qualification-timing", "later publication must reference a pre-publication qualification.");
  const c = record?.candidate, qc = qualification?.candidate;
  closed(findings, c, ["name", "version", "packageTreeSha1", "packageManifestSha256", "tarball"], "publication.candidate");
  closed(findings, c?.tarball, ["sha1", "sha256", "sha512"], "publication.candidate.tarball");
  if (!NAME.test(c?.name ?? "") || !VERSION.test(c?.version ?? "") || !SHA1.test(c?.packageTreeSha1 ?? "") || !SHA256.test(c?.packageManifestSha256 ?? "") || !SHA1.test(c?.tarball?.sha1 ?? "") || !SHA256.test(c?.tarball?.sha256 ?? "") || !SHA512.test(c?.tarball?.sha512 ?? "") || !same(c, qc && { name: qc.name, version: qc.version, packageTreeSha1: qc.packageTreeSha1, packageManifestSha256: qc.packageManifestSha256, tarball: qc.tarball })) finding(findings, "candidate-join", "candidate must exactly join the qualified source, manifest, and tarball.");
  const key = packageKey(c?.name);
  if (legacy && key && TRIO.includes(key)) finding(findings, "sealed-trio", "later-publication records cannot substitute or extend a sealed Trio member.");
  closed(findings, record?.source, ["reviewedCommit", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256"], "publication.source");
  for (const sourceKey of ["reviewedCommit", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256"]) if (record?.source?.[sourceKey] !== qualification?.[sourceKey] && record?.source?.[sourceKey] !== qc?.[sourceKey]) finding(findings, "source-join", `source.${sourceKey} must join the retained qualification.`);
  closed(findings, record?.catalog, ["path", "sha256", "packageKey"], "publication.catalog");
  const introducedPackages = activePackages(catalog);
  const retainedPackages = activePackages(currentCatalog);
  if (record?.catalog?.path !== CATALOG_PATH || !SHA256.test(record?.catalog?.sha256 ?? "") || typeof catalogBytes !== "string" || digest(catalogBytes) !== record?.catalog?.sha256 || record?.catalog?.packageKey !== key || !introducedPackages?.includes(key) || !retainedPackages?.includes(key)) finding(findings, "catalog-join", "must bind its introduction catalogue bytes and remain in the current active reviewed allowlist.");
  closed(findings, record?.publication, ["mode", "publishedAt", "reference", "provenance"], "publication.publication");
  if (legacy && (record?.publication?.mode !== "owner-present" || !canonicalInstant(record?.publication?.publishedAt) || !evidenceUrl(record?.publication?.reference) || record?.publication?.provenance !== undefined)) finding(findings, "publication-evidence", "v1 records require owner-present evidence without provenance.");
  if (trusted && (record?.publication?.mode !== "trusted-publisher" || !canonicalInstant(record?.publication?.publishedAt) || record?.publication?.reference !== invocationRunRoot(record?.publication?.provenance?.invocation) || !trustedProvenance(record?.publication?.provenance, c, sourceValid))) finding(findings, "publication-provenance", "trusted publication must bind its exact GitHub workflow, post-qualification source, invocation, run reference, and npm attestation.");
  const proof = record?.registryProof?.evidence;
  closed(findings, record?.registryProof, ["schemaVersion", "kind", "evidence"], "publication.registryProof");
  const v1 = record?.registryProof?.schemaVersion === 1 && record?.registryProof?.kind === "public-npm-anonymous-registry-proof-v1";
  const v2 = record?.registryProof?.schemaVersion === 2 && record?.registryProof?.kind === "public-npm-anonymous-registry-proof-v2";
  closed(findings, proof, v1
    ? ["registry", "access", "name", "version", "packumentUrl", "tarballUrl", "integrity", "shasum", "sha256", "sha512", "packedManifestSha256", "size"]
    : ["registry", "access", "name", "version", "metadataUrl", "repository", "tarballUrl", "integrity", "shasum", "sha256", "sha512", "packedManifestSha256", "size"], "publication.registryProof.evidence");
  const integrity = SHA512.test(c?.tarball?.sha512 ?? "") ? `sha512-${Buffer.from(c.tarball.sha512, "hex").toString("base64")}` : null;
  let expectedMetadata = null;
  try { expectedMetadata = key ? (v1 ? publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, c?.name) : publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, c?.name, c?.version)) : null; } catch { /* a malformed name is a finding below */ }
  const metadataUrl = v1 ? proof?.packumentUrl : proof?.metadataUrl;
  const expectedRepository = trusted ? repositoryName(record?.publication?.provenance?.repository) : "clossys/foundry";
  if ((!v1 && !v2) || proof?.registry !== PUBLIC_NPM_REGISTRY || proof?.access !== "anonymous" || proof?.name !== c?.name || proof?.version !== c?.version || metadataUrl !== expectedMetadata || (v2 && proof?.repository !== expectedRepository) || proof?.tarballUrl !== expectedTarballUrl(c?.name, c?.version) || proof?.integrity !== integrity || proof?.shasum !== c?.tarball?.sha1 || proof?.sha256 !== c?.tarball?.sha256 || proof?.sha512 !== c?.tarball?.sha512 || proof?.packedManifestSha256 !== c?.packageManifestSha256 || !Number.isSafeInteger(proof?.size) || proof.size < 1 || proof.size > 20_000_000) finding(findings, "registry-join", "anonymous served-byte proof must exactly join the candidate tarball and manifest.");
  if (trusted && !v2) finding(findings, "registry-proof", "trusted publication requires the exact-version anonymous registry proof v2.");
  if (trusted && !exactAttestedSubject(record?.publication?.provenance, proof, c)) finding(findings, "attestation-subject", "attestation subject must exactly project the candidate package/version and SHA-512.");
  if (typeof recordPath === "string" && typeof recordBytes === "string" && (!key || !VERSION.test(c?.version ?? "") || recordPath !== `${LATER_PUBLICATION_DIRECTORY}/${key}-${c.version}.json`)) finding(findings, "record-path", "record path must be the unique package/version identity.");
  return findings;
}

export function immutableSingleIntroduction(root, path) {
  const commits = execFileSync("git", ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) throw new Error("must have one immutable introduction commit");
  const introduced = gitBlob(root, commits[0], path);
  const retained = readFileSync(join(root, path), "utf8");
  if (digest(introduced) !== digest(retained)) throw new Error("retained bytes differ from their introduction blob");
  const introducedBlob = gitBlobOid(root, commits[0], path);
  const traversed = execFileSync(
    "git",
    // The path limiter chooses relevant commit IDs only. Asking this command
    // for parents would return history-simplified parents, not the commit's
    // real topology, and can collapse a two-parent synthetic merge to one.
    ["rev-list", "--full-history", `${commits[0]}..HEAD`, "--", path],
    { cwd: root, encoding: "utf8" },
  ).trim().split("\n").filter(Boolean);
  for (const commit of traversed) {
    const parents = gitCommitParents(root, commit);
    // Only a merge may reconcile a branch forked before the introduction.
    // Ordinary later path touches remain forbidden even when they restore the
    // original bytes before HEAD.
    if (parents.length < 2 || gitBlobOid(root, commit, path) !== introducedBlob) {
      throw new Error("retained path was touched after its introduction");
    }
    for (const parent of parents) {
      const parentBlob = gitBlobOid(root, parent, path);
      if (parentBlob !== null && parentBlob !== introducedBlob) {
        throw new Error("retained path was touched after its introduction");
      }
      // A missing path is safe only for a genuinely pre-introduction branch.
      // A parent that deleted the record is not such a branch.
      if (parentBlob === null && hasPathHistory(root, parent, path)) {
        throw new Error("retained path was touched after its introduction");
      }
    }
  }
  return { introductionCommit: commits[0], introducedBytes: introduced };
}

export function strictQualificationIntroductionAncestor(root, qualificationIntroduction, publicationIntroduction) {
  if (!SHA1.test(qualificationIntroduction ?? "") || !SHA1.test(publicationIntroduction ?? "")) throw new Error("qualification and publication introductions must be commit hashes");
  if (qualificationIntroduction === publicationIntroduction) throw new Error("qualification introduction must strictly precede the later-publication introduction");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", qualificationIntroduction, publicationIntroduction], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error("qualification introduction must be an ancestor of the later-publication introduction");
  }
}

function controlledQualificationPath(root, record, introductionCommit) {
  const path = record?.qualification?.path;
  if (typeof path !== "string" || !QUALIFICATION_PATH.test(path)) throw new Error("qualification path must be a contained release-qualification record path");
  const candidate = record?.candidate;
  if (!NAME.test(candidate?.name ?? "") || !VERSION.test(candidate?.version ?? "")) throw new Error("qualification path cannot be selected from an invalid candidate");
  const expected = qualificationPath(root, candidate, introductionCommit);
  if (path !== expected) throw new Error("qualification path does not exactly match its candidate policy stem and version");
  return path;
}

/** Validate retained later-publication records without throwing on bad input. */
export function validateRetainedLaterPublications(root) {
  const findings = [], names = new Set(), identities = new Set();
  const directory = join(root, LATER_PUBLICATION_DIRECTORY);
  if (!existsSync(directory)) return { names, findings };
  let currentCatalog;
  try { currentCatalog = parseStrictJson(readFileSync(join(root, CATALOG_PATH), "utf8")); }
  catch (error) { finding(findings, "current-catalog", error instanceof Error ? error.message : "cannot read current catalogue"); return { names, findings }; }
  let files;
  try { files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); }
  catch (error) { finding(findings, "publication-directory", error instanceof Error ? error.message : "cannot read later-publication directory"); return { names, findings }; }
  for (const file of files) {
    const path = `${LATER_PUBLICATION_DIRECTORY}/${file}`;
    try {
      const bytes = readFileSync(join(root, path), "utf8");
      const record = parseStrictJson(bytes);
      const { introductionCommit } = immutableSingleIntroduction(root, path);
      // Containment and exact-policy validation precede every record-directed read.
      const qpath = controlledQualificationPath(root, record, introductionCommit);
      const qbytes = readFileSync(join(root, qpath), "utf8");
      const qualification = parseStrictJson(qbytes);
      const history = qualificationRecordHistory(root, qpath, qualification.candidate, "HEAD", qpath);
      strictQualificationIntroductionAncestor(root, history.introductionCommit, introductionCommit);
      const expected = { name: qualification.candidate?.name, version: qualification.candidate?.version, ...currentQualificationJoins(root, qualification.candidate, history.introductionCommit) };
      const introCatalogBytes = gitBlob(root, introductionCommit, CATALOG_PATH);
      const introCatalog = parseStrictJson(introCatalogBytes);
      const qualificationFindings = validateCandidateQualification(qualification, { expected });
      const historical = record?.publication?.provenance?.repository === HISTORICAL_PLATFORM_REPOSITORY;
      const sourceValid = historical || trustedProvenanceSourceValid(root, qualification, history.introductionCommit, introductionCommit, record?.publication?.provenance?.sourceSha);
      const recordFindings = validateLaterPublication(record, { recordPath: path, recordBytes: bytes, qualification, qualificationBytes: qbytes, qualificationPath: qpath, catalogBytes: introCatalogBytes, catalog: introCatalog, currentCatalog, provenanceSourceValid: sourceValid });
      for (const item of [...qualificationFindings, ...recordFindings]) finding(findings, item.rule, `${path}: ${item.message}`);
      if (qualificationFindings.length || recordFindings.length) continue;
      const identity = `${record.candidate.name}@${record.candidate.version}`;
      if (identities.has(identity)) finding(findings, "duplicate-package-version", `${path}: later publication package/version is duplicated.`);
      else { identities.add(identity); names.add(record.candidate.name); }
    } catch (error) {
      finding(findings, "retained-record", `${path}: ${error instanceof Error ? error.message : "invalid record"}`);
    }
  }
  return { names, findings };
}

export function readValidatedLaterPublishedPackages(root) {
  const { names, findings } = validateRetainedLaterPublications(root);
  if (findings.length) throw new Error(findings.map((item) => `${item.rule}: ${item.message}`).join("; "));
  return names;
}
