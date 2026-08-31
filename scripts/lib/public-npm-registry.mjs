import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org";

// The registry can acknowledge an OIDC publish before its anonymous
// packument/tarball edge is readable. This is a bounded observation window,
// never a publication retry policy: the immutable upload has already happened.
export const POST_PUBLISH_VISIBILITY_RETRY_DELAYS_MS = Object.freeze([
  0,
  5_000,
  10_000,
  20_000,
  30_000,
  45_000,
  60_000,
]);
const MAX_POST_PUBLISH_VISIBILITY_RETRY_MS = 180_000;

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

function sha(algorithm, bytes, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function exactPublicRegistry(registry) {
  let parsed;
  try {
    parsed = new URL(registry);
  } catch {
    return null;
  }
  if (
    parsed.toString() !== `${PUBLIC_NPM_REGISTRY}/` ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) return null;
  return parsed;
}

export function publicNpmPackageUrl(registry, name) {
  const parsed = exactPublicRegistry(registry);
  if (!parsed) throw new Error(`anonymous npm verification supports only ${PUBLIC_NPM_REGISTRY}`);
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("public npm package name must be scoped and canonical");
  return `${parsed.origin}/${encodeURIComponent(name)}`;
}

function publicNpmNameParts(name) {
  const scoped = /^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(name);
  if (scoped) return { scope: scoped[1], package: scoped[2] };
  if (/^[a-z0-9][a-z0-9._-]*$/.test(name)) return { scope: null, package: name };
  throw new Error("public npm package name must be canonical");
}

/** The exact-version document is available where a new scoped packument can still be absent. */
export function publicNpmVersionUrl(registry, name, version) {
  const parsed = exactPublicRegistry(registry);
  if (!parsed) throw new Error(`anonymous npm verification supports only ${PUBLIC_NPM_REGISTRY}`);
  publicNpmNameParts(name);
  if (!VERSION.test(version)) throw new Error("public npm version must be canonical");
  return `${parsed.origin}/${encodeURIComponent(name)}/${version}`;
}

export function publicNpmTarballUrl(registry, name, version) {
  const parsed = exactPublicRegistry(registry);
  if (!parsed) throw new Error(`anonymous npm verification supports only ${PUBLIC_NPM_REGISTRY}`);
  const identity = publicNpmNameParts(name);
  if (!VERSION.test(version)) throw new Error("public npm version must be canonical");
  const path = identity.scope ? `@${identity.scope}/${identity.package}` : identity.package;
  return `${parsed.origin}/${path}/-/${identity.package}-${version}.tgz`;
}

function anonymousOptions(accept) {
  return { headers: { Accept: accept }, redirect: "error" };
}

async function fetchPublicNpmPackumentWithAccept({ registry, name, accept, fetchImpl }) {
  let url;
  try {
    url = publicNpmPackageUrl(registry, name);
  } catch (error) {
    return { kind: "unreachable", detail: error.message };
  }
  let response;
  try {
    response = await fetchImpl(url, anonymousOptions(accept));
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous packument request failed: ${error.message}` };
  }
  if (response.status === 404) return { kind: "not-found", url };
  if (response.status === 401 || response.status === 403) return { kind: "denied", detail: `anonymous packument request returned HTTP ${response.status}`, url };
  if (!response.ok) return { kind: "unreachable", detail: `anonymous packument request returned HTTP ${response.status}`, url };
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous packument response was not JSON: ${error.message}`, url };
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || document.name !== name || !document.versions || typeof document.versions !== "object" || Array.isArray(document.versions)) {
    return { kind: "unreachable", detail: "anonymous packument response has no exact package identity/version map", url };
  }
  return { kind: "found", document, url };
}

export async function fetchPublicNpmPackument({ registry, name, fetchImpl = fetch }) {
  return fetchPublicNpmPackumentWithAccept({
    registry,
    name,
    accept: "application/vnd.npm.install-v1+json",
    fetchImpl,
  });
}

async function fetchPublicNpmVersion({ registry, name, version, expectedRepository, fetchImpl }) {
  let url;
  try {
    url = publicNpmVersionUrl(registry, name, version);
  } catch (error) {
    return { kind: "unreachable", detail: error.message };
  }
  let response;
  try {
    // npm's exact-version endpoint returns 406 for the abbreviated install
    // media type. Full JSON is still anonymous and contains the immutable
    // name/version/repository/dist fields required below.
    response = await fetchImpl(url, anonymousOptions("application/json"));
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous exact-version request failed: ${error.message}` };
  }
  if (response.status === 404) return { kind: "not-found", url };
  if (response.status === 401 || response.status === 403) return { kind: "denied", detail: `anonymous exact-version request returned HTTP ${response.status}`, url };
  if (!response.ok) return { kind: "unreachable", detail: `anonymous exact-version request returned HTTP ${response.status}`, url };
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous exact-version response was not JSON: ${error.message}`, url };
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || document.name !== name || document.version !== version) {
    return { kind: "unreachable", detail: "anonymous exact-version response has no exact package identity", url };
  }
  const repository = repositoryIdentityFromPackument({ repository: document.repository, versions: { [version]: document } }, version);
  if (!repository) return { kind: "unreachable", detail: "anonymous exact-version response has no canonical repository identity", url };
  if (expectedRepository !== undefined && repository !== expectedRepository) return { kind: "unreachable", detail: "anonymous exact-version response repository does not match the expected repository", url };
  const exact = exactVersionRecord({ versions: { [version]: document } }, name, version);
  if (exact.kind !== "found") return { ...exact, url };
  return { kind: "found", exact: { repository, dist: exact.dist }, url };
}

function exactVersionRecord(packument, name, version) {
  const record = Object.prototype.hasOwnProperty.call(packument.versions, version) ? packument.versions[version] : undefined;
  if (record === undefined) return { kind: "missing" };
  if (!record || typeof record !== "object" || Array.isArray(record) || record.name !== name || record.version !== version) {
    return { kind: "unreachable", detail: "exact version entry does not retain its requested name/version identity" };
  }
  const dist = record.dist;
  if (!dist || typeof dist !== "object" || Array.isArray(dist) || typeof dist.tarball !== "string" || typeof dist.integrity !== "string" || !SHA1.test(dist.shasum ?? "")) {
    return { kind: "unreachable", detail: "exact version entry has no complete tarball/integrity/shasum tuple" };
  }
  let tarball;
  try { tarball = new URL(dist.tarball); } catch { return { kind: "unreachable", detail: "exact version tarball URL is invalid" }; }
  let expectedTarball;
  try { expectedTarball = publicNpmTarballUrl(PUBLIC_NPM_REGISTRY, name, version); } catch { return { kind: "unreachable", detail: "exact version tarball URL cannot be derived from its identity" }; }
  if (tarball.toString() !== expectedTarball) return { kind: "unreachable", detail: "exact version tarball URL does not match its canonical public npm identity" };
  const integrityMatch = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(dist.integrity);
  if (!integrityMatch) return { kind: "unreachable", detail: "exact version integrity is not one canonical sha512 SRI" };
  let integrityBytes;
  try {
    integrityBytes = Buffer.from(integrityMatch[1], "base64");
  } catch {
    return { kind: "unreachable", detail: "exact version integrity is not valid base64" };
  }
  if (integrityBytes.length !== 64 || integrityBytes.toString("base64") !== integrityMatch[1]) {
    return { kind: "unreachable", detail: "exact version integrity is not a canonical sha512 digest" };
  }
  return { kind: "found", dist: { tarball: tarball.toString(), integrity: dist.integrity, shasum: dist.shasum } };
}

export async function probePublicNpmVersion({ registry, name, version, repository, fetchImpl = fetch }) {
  const metadata = await fetchPublicNpmVersion({ registry, name, version, expectedRepository: repository, fetchImpl });
  if (metadata.kind === "not-found") return { kind: "known", hasVersion: false };
  if (metadata.kind === "denied") return { kind: "denied" };
  if (metadata.kind !== "found") return { kind: "unreachable" };
  return { kind: "known", hasVersion: true, exact: metadata.exact, metadataUrl: metadata.url };
}

function packedManifest(bytes) {
  const result = spawnSync("tar", ["-xOzf", "-", "package/package.json"], {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.signal || result.error) throw new Error("registry tarball does not contain a readable package/package.json");
  let manifest;
  try {
    manifest = JSON.parse(result.stdout);
  } catch {
    throw new Error("registry tarball package/package.json is not JSON");
  }
  return { manifest, bytes: Buffer.from(result.stdout) };
}

export async function verifyPublicNpmArtifact({ registry, name, version, repository, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) return { kind: "unreachable", detail: "public npm artifact verification requires one canonical expected repository identity" };
  const probe = await probePublicNpmVersion({ registry, name, version, repository, fetchImpl });
  if (probe.kind !== "known" || probe.hasVersion !== true) return probe;
  let response;
  try {
    response = await fetchImpl(probe.exact.dist.tarball, anonymousOptions("application/octet-stream"));
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous tarball request failed: ${error.message}` };
  }
  if (response.status === 404) return { kind: "not-found", detail: "anonymous tarball request returned HTTP 404" };
  if (response.status === 401 || response.status === 403) return { kind: "denied" };
  if (!response.ok) return { kind: "unreachable", detail: `anonymous tarball request returned HTTP ${response.status}` };
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_TARBALL_BYTES) return { kind: "unreachable", detail: "registry tarball exceeds the bounded verification size" };
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous tarball body could not be read: ${error.message}` };
  }
  if (bytes.length === 0 || bytes.length > MAX_TARBALL_BYTES) return { kind: "unreachable", detail: "registry tarball is empty or exceeds the bounded verification size" };
  const sha1 = sha("sha1", bytes);
  const sha256 = sha("sha256", bytes);
  const sha512Hex = sha("sha512", bytes);
  const integrity = `sha512-${sha("sha512", bytes, "base64")}`;
  if (sha1 !== probe.exact.dist.shasum || integrity !== probe.exact.dist.integrity) {
    return { kind: "mismatch", detail: "registry-served bytes do not match the packument shasum/integrity tuple" };
  }
  let packed;
  try {
    packed = packedManifest(bytes);
  } catch (error) {
    return { kind: "mismatch", detail: error.message };
  }
  if (packed.manifest?.name !== name || packed.manifest?.version !== version) {
    return { kind: "mismatch", detail: "registry tarball manifest does not match the requested name/version" };
  }
  return {
    kind: "verified",
    bytes,
    evidence: {
      registry: PUBLIC_NPM_REGISTRY,
      access: "anonymous",
      name,
      version,
      metadataUrl: probe.metadataUrl,
      repository: probe.exact.repository,
      tarballUrl: probe.exact.dist.tarball,
      integrity,
      shasum: sha1,
      sha256,
      sha512: sha512Hex,
      packedManifestSha256: sha("sha256", packed.bytes),
      size: bytes.length,
    },
  };
}

function visibilityPending(result) {
  return (result.kind === "known" && result.hasVersion === false) || result.kind === "not-found";
}

/**
 * Re-read only a just-published public artifact while the anonymous registry
 * catches up. Identity, digest, authorization, and transport failures return
 * immediately; only an absent version or a 404 tarball is retried.
 */
export async function retryPostPublishPublicNpmArtifact({
  registry,
  name,
  version,
  repository,
  fetchImpl = fetch,
  delays = POST_PUBLISH_VISIBILITY_RETRY_DELAYS_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!Array.isArray(delays) || delays.length < 2 || delays[0] !== 0 || delays.some((milliseconds) => !Number.isSafeInteger(milliseconds) || milliseconds < 0) || delays.reduce((total, milliseconds) => total + milliseconds, 0) > MAX_POST_PUBLISH_VISIBILITY_RETRY_MS) {
    throw new Error("post-publish visibility retry delays must begin with zero and remain within three minutes");
  }
  let result;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    result = await verifyPublicNpmArtifact({ registry, name, version, repository, fetchImpl });
    if (!visibilityPending(result) || attempt === delays.length - 1) return result;
    await sleep(delays[attempt + 1]);
  }
  return result;
}

/** Serialize only the anonymous registry facts needed to revalidate an artifact handoff. */
export function publicNpmRegistryProof(evidence) {
  return evidence?.metadataUrl === undefined
    ? { schemaVersion: 1, kind: "public-npm-anonymous-registry-proof-v1", evidence }
    : { schemaVersion: 2, kind: "public-npm-anonymous-registry-proof-v2", evidence };
}

/** Validate a retained anonymous npm proof against exact candidate bytes. */
export function validatePublicNpmRegistryProof(proof, { name, version, repository, bytes } = {}) {
  const findings = [];
  const fail = (rule, message) => findings.push({ rule, message });
  const v1 = proof?.schemaVersion === 1 && proof?.kind === "public-npm-anonymous-registry-proof-v1";
  const v2 = proof?.schemaVersion === 2 && proof?.kind === "public-npm-anonymous-registry-proof-v2";
  if (!proof || typeof proof !== "object" || Array.isArray(proof) || (!v1 && !v2) || Object.keys(proof).some((key) => !["schemaVersion", "kind", "evidence"].includes(key))) {
    fail("proof", "closed anonymous registry proof required.");
    return findings;
  }
  const evidence = proof.evidence;
  const fields = v1
    ? ["registry", "access", "name", "version", "packumentUrl", "tarballUrl", "integrity", "shasum", "sha256", "sha512", "packedManifestSha256", "size"]
    : ["registry", "access", "name", "version", "metadataUrl", "repository", "tarballUrl", "integrity", "shasum", "sha256", "sha512", "packedManifestSha256", "size"];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).sort().join("\0") !== fields.slice().sort().join("\0")) {
    fail("proof", "closed anonymous registry evidence required.");
    return findings;
  }
  if (evidence.registry !== PUBLIC_NPM_REGISTRY || evidence.access !== "anonymous" || evidence.name !== name || evidence.version !== version || !VERSION.test(evidence.version ?? "") || !SHA1.test(evidence.shasum ?? "") || !SHA256.test(evidence.sha256 ?? "") || !SHA512.test(evidence.sha512 ?? "") || !SHA256.test(evidence.packedManifestSha256 ?? "") || !Number.isSafeInteger(evidence.size) || evidence.size < 1 || evidence.size > MAX_TARBALL_BYTES) fail("proof", "exact anonymous registry identity/digest tuple required.");
  const metadataUrl = v1 ? evidence.packumentUrl : evidence.metadataUrl;
  try {
    const expectedMetadata = v1 ? publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, name) : publicNpmVersionUrl(PUBLIC_NPM_REGISTRY, name, version);
    if (metadataUrl !== expectedMetadata) fail("proof-url", "registry proof must retain the exact anonymous metadata URL.");
  } catch { fail("proof-url", "registry proof has no canonical package/version identity."); }
  if (v2 && (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(evidence.repository ?? "") || (repository !== undefined && evidence.repository !== repository))) fail("proof", "exact anonymous registry repository identity required.");
  let expectedTarball = null;
  try { expectedTarball = publicNpmTarballUrl(PUBLIC_NPM_REGISTRY, name, version); } catch { fail("proof-url", "registry proof has no canonical tarball identity."); }
  if (expectedTarball !== null && evidence.tarballUrl !== expectedTarball) fail("proof-url", "registry proof must retain the exact anonymous tarball URL.");
  for (const value of [metadataUrl, evidence.tarballUrl]) {
    try { const url = new URL(value); if (url.protocol !== "https:" || url.origin !== new URL(PUBLIC_NPM_REGISTRY).origin || url.username || url.password || url.search || url.hash) throw new Error("origin"); }
    catch { fail("proof-url", "registry proof URL must remain an exact public npm HTTPS origin."); }
  }
  if (typeof evidence.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(evidence.integrity)) fail("proof", "canonical npm sha512 integrity required.");
  if (!Buffer.isBuffer(bytes)) fail("bytes", "candidate bytes are required for registry-proof validation.");
  else if (bytes.length !== evidence.size || sha("sha1", bytes) !== evidence.shasum || sha("sha256", bytes) !== evidence.sha256 || sha("sha512", bytes) !== evidence.sha512 || `sha512-${sha("sha512", bytes, "base64")}` !== evidence.integrity) fail("proof-digest", "candidate bytes differ from the anonymous registry proof.");
  else {
    try {
      const packed = packedManifest(bytes);
      if (packed.manifest?.name !== name || packed.manifest?.version !== version || sha("sha256", packed.bytes) !== evidence.packedManifestSha256) fail("proof-manifest", "candidate packed manifest differs from the anonymous registry proof.");
    } catch (error) {
      fail("proof-manifest", error.message);
    }
  }
  return findings;
}

export function repositoryIdentityFromPackument(document, version) {
  const repositories = [];
  const values = [document?.repository];
  const exact = document?.versions?.[version];
  if (exact?.repository !== undefined) values.push(exact.repository);
  for (const record of Object.values(document?.versions ?? {})) {
    if (record?.repository !== undefined && record !== exact) values.push(record.repository);
  }
  for (const value of values) {
    if (value === undefined) continue;
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url !== "string") return null;
    const match = url.trim().match(/^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?$/i);
    if (!match) return null;
    repositories.push(`${match[1]}/${match[2]}`);
  }
  const distinct = new Set(repositories.map((repository) => repository.toLowerCase()));
  return distinct.size === 1 ? repositories[0] : null;
}

function repositoryIdentity(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (typeof url !== "string") return null;
  const match = url.trim().match(/^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function packumentRepositoryMetadata(document, name) {
  if (!document || typeof document !== "object" || Array.isArray(document) || document.name !== name || !document.versions || typeof document.versions !== "object" || Array.isArray(document.versions)) {
    return null;
  }
  const records = [];
  if (document.repository !== undefined) {
    const repository = repositoryIdentity(document.repository);
    if (!repository) return null;
    records.push({ version: null, repository });
  }
  for (const [version, record] of Object.entries(document.versions)) {
    const repository = repositoryIdentity(record?.repository);
    if (!repository) return null;
    records.push({ version, repository });
  }
  return records;
}

/**
 * Prove that a historical GitHub repository slug still resolves to the exact
 * current repository. This is deliberately a live read: a matching owner is
 * insufficient because that owner can create an unrelated replacement repo.
 */
export async function verifyGithubRepositoryRedirect({ historicalRepository, repository, repositoryId, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(historicalRepository ?? "") || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    return { kind: "unreachable", detail: "repository redirect proof requires canonical historical and current repository identities" };
  }
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${historicalRepository}`, {
      headers: { Accept: "application/vnd.github+json" },
      redirect: "follow",
    });
  } catch (error) {
    return { kind: "unreachable", detail: `GitHub repository redirect request failed: ${error.message}` };
  }
  if (!response.ok) return { kind: "unreachable", detail: `GitHub repository redirect request returned HTTP ${response.status}` };
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return { kind: "unreachable", detail: `GitHub repository redirect response was not JSON: ${error.message}` };
  }
  if (document?.full_name !== repository || document?.id !== repositoryId) {
    return { kind: "unreachable", detail: "GitHub repository redirect did not resolve to the exact current repository" };
  }
  return { kind: "verified" };
}

export async function assessPublicNpmName({
  registry,
  name,
  version,
  thisRepo,
  historicalRepositoryVersions = [],
  resolveRepositoryRedirect = verifyGithubRepositoryRedirect,
  fetchImpl = fetch,
}) {
  // npm's abbreviated install packument can omit repository metadata. Name
  // ownership therefore needs the full document; artifact probes above keep
  // the smaller install representation because they bind version/dist bytes.
  const packument = await fetchPublicNpmPackumentWithAccept({
    registry,
    name,
    accept: "application/json",
    fetchImpl,
  });
  if (packument.kind === "not-found") return { kind: "safe", found: false, existingRepo: null };
  if (packument.kind !== "found") return packument;
  const records = packumentRepositoryMetadata(packument.document, name);
  if (!records) return { kind: "collision", found: true, existingRepo: null };
  const aliases = new Map();
  for (const item of historicalRepositoryVersions) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      typeof item.version !== "string" ||
      typeof item.repository !== "string" ||
      !Number.isSafeInteger(item.repositoryId) ||
      aliases.has(`${item.name}\0${item.version}`)
    ) {
      return { kind: "unreachable", detail: "historical npm repository alias policy is malformed" };
    }
    aliases.set(`${item.name}\0${item.version}`, item);
  }
  const redirectProofs = new Map();
  for (const record of records) {
    if (record.repository === thisRepo) continue;
    // A root packument repository field may be the historical value only when
    // every exact version using that value is closed below; it cannot admit a
    // foreign repository or substitute for a version-level alias entry.
    if (record.version === null) {
      const rootAliases = historicalRepositoryVersions.filter((item) => item.name === name && item.repository === record.repository);
      if (rootAliases.length === 0) {
        return { kind: "collision", found: true, existingRepo: record.repository };
      }
      const repositoryId = rootAliases[0].repositoryId;
      if (rootAliases.some((item) => item.repositoryId !== repositoryId)) {
        return { kind: "unreachable", detail: "historical npm repository alias policy has conflicting repository IDs" };
      }
      const proofKey = `${record.repository}\0${repositoryId}`;
      if (!redirectProofs.has(proofKey)) {
        redirectProofs.set(proofKey, await resolveRepositoryRedirect({
          historicalRepository: record.repository,
          repository: thisRepo,
          repositoryId,
        }));
      }
      const redirect = redirectProofs.get(proofKey);
      if (redirect?.kind !== "verified") {
        return {
          kind: "unreachable",
          detail: redirect?.detail ?? "GitHub repository redirect ownership proof was unavailable",
        };
      }
      continue;
    }
    const alias = aliases.get(`${name}\0${record.version}`);
    if (!alias || alias.repository !== record.repository) {
      return { kind: "collision", found: true, existingRepo: record.repository };
    }
    const proofKey = `${alias.repository}\0${alias.repositoryId}`;
    if (!redirectProofs.has(proofKey)) {
      redirectProofs.set(proofKey, await resolveRepositoryRedirect({
        historicalRepository: alias.repository,
        repository: thisRepo,
        repositoryId: alias.repositoryId,
      }));
    }
    const redirect = redirectProofs.get(proofKey);
    if (redirect?.kind !== "verified") {
      return {
        kind: "unreachable",
        detail: redirect?.detail ?? "GitHub repository redirect ownership proof was unavailable",
      };
    }
  }
  return { kind: "same-repo-version-bump", found: true, existingRepo: thisRepo };
}
