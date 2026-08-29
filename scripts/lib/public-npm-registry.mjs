import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org";

const SHA1 = /^[a-f0-9]{40}$/;
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

function anonymousOptions(accept) {
  return { headers: { Accept: accept }, redirect: "error" };
}

export async function fetchPublicNpmPackument({ registry, name, fetchImpl = fetch }) {
  let url;
  try {
    url = publicNpmPackageUrl(registry, name);
  } catch (error) {
    return { kind: "unreachable", detail: error.message };
  }
  let response;
  try {
    response = await fetchImpl(url, anonymousOptions("application/vnd.npm.install-v1+json"));
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
  try {
    tarball = new URL(dist.tarball);
  } catch {
    return { kind: "unreachable", detail: "exact version tarball URL is invalid" };
  }
  if (tarball.protocol !== "https:" || tarball.origin !== new URL(PUBLIC_NPM_REGISTRY).origin || tarball.username || tarball.password || tarball.search || tarball.hash) {
    return { kind: "unreachable", detail: "exact version tarball URL is outside the public npm registry origin" };
  }
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
  return { kind: "found", record, dist: { tarball: tarball.toString(), integrity: dist.integrity, shasum: dist.shasum } };
}

export async function probePublicNpmVersion({ registry, name, version, fetchImpl = fetch }) {
  const packument = await fetchPublicNpmPackument({ registry, name, fetchImpl });
  if (packument.kind === "not-found") return { kind: "known", hasVersion: false };
  if (packument.kind === "denied") return { kind: "denied" };
  if (packument.kind !== "found") return { kind: "unreachable" };
  const exact = exactVersionRecord(packument.document, name, version);
  if (exact.kind === "missing") return { kind: "known", hasVersion: false };
  if (exact.kind !== "found") return { kind: "unreachable" };
  return { kind: "known", hasVersion: true, exact, packumentUrl: packument.url };
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

export async function verifyPublicNpmArtifact({ registry, name, version, fetchImpl = fetch }) {
  const probe = await probePublicNpmVersion({ registry, name, version, fetchImpl });
  if (probe.kind !== "known" || probe.hasVersion !== true) return probe;
  let response;
  try {
    response = await fetchImpl(probe.exact.dist.tarball, anonymousOptions("application/octet-stream"));
  } catch (error) {
    return { kind: "unreachable", detail: `anonymous tarball request failed: ${error.message}` };
  }
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
      packumentUrl: probe.packumentUrl,
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

export function repositoryIdentityFromPackument(document, version) {
  const record = document?.versions?.[version];
  const value = record?.repository ?? document?.repository;
  const url = typeof value === "string" ? value : value?.url;
  if (typeof url !== "string") return null;
  const match = url.trim().match(/^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

export async function assessPublicNpmName({ registry, name, version, thisRepo, fetchImpl = fetch }) {
  const packument = await fetchPublicNpmPackument({ registry, name, fetchImpl });
  if (packument.kind === "not-found") return { kind: "safe", found: false, existingRepo: null };
  if (packument.kind !== "found") return packument;
  const existingRepo = repositoryIdentityFromPackument(packument.document, version);
  if (existingRepo === thisRepo) return { kind: "same-repo-version-bump", found: true, existingRepo };
  return { kind: "collision", found: true, existingRepo };
}
