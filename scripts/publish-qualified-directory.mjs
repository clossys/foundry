#!/usr/bin/env node
// Publish an immutable qualified npm candidate from a clean extracted directory.
//
// npm treats a tarball publish as a distinct input form and may retain client
// transport fields in registry metadata.  This owner-present control accepts a
// qualified tarball only as *input*, expands it into a private directory, then
// proves that npm's directory pack is byte-for-byte the recorded candidate
// before it ever allows the single `npm publish .` upload.

import { constants, chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

import { assertPackageAuthorized, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { verifyPostPublishPublicNpmArtifact } from "./verify-post-publish-public-npm-artifact.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA = { sha1: /^[a-f0-9]{40}$/, sha256: /^[a-f0-9]{64}$/, sha512: /^[a-f0-9]{128}$/ };
const NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TRANSIENT_MANIFEST_FIELDS = new Set(["_from", "_resolved", "_id", "_integrity", "_location", "_requested", "_shasum", "_spec", "_where"]);
const USAGE = "Usage: --package <package-key> --candidate <qualified-candidate.tgz> --record <exact-qualification-record.json>";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const RELEASE_NODE_VERSION = "v24.19.0";
const RELEASE_NPM_VERSION = "11.17.0";
const RELEASE_ZLIB_VERSION = "1.3.2.1-motley-3246f1b";
const PTY_SCRIPT = "/usr/bin/script";

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const hashes = (bytes) => Object.fromEntries(Object.keys(SHA).map((algorithm) => [algorithm, digest(algorithm, bytes)]));
function anonymousEnvironment(env = process.env) {
  // The verifier uses fetch rather than npm. It needs neither the owner's
  // npmrc nor any inherited configuration, so make the anonymous boundary
  // literal instead of trying to enumerate every npm auth spelling.
  return Object.fromEntries(["PATH", "LANG", "LC_ALL"].flatMap((key) => typeof env[key] === "string" ? [[key, env[key]]] : []));
}

export function argsFrom(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2), value = argv[index + 1];
    if (!Object.hasOwn({ package: true, candidate: true, record: true }, key) || !value || result[key] !== undefined) throw new Error(USAGE);
    result[key] = value;
  }
  if (Object.keys(result).length !== 3 || !KEY.test(result.package)) throw new Error(USAGE);
  return result;
}

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
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new Error(`${label} must contain one JSON object`);
  }
}

function octal(bytes) {
  const source = bytes.toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]*$/.test(source)) throw new Error("archive has a non-octal header field");
  return source ? Number.parseInt(source, 8) : 0;
}

function zeroBlock(bytes) { return bytes.every((value) => value === 0); }

function safeArchivePath(name) {
  if (!name || name.includes("\\") || name.startsWith("/") || name.includes("//")) throw new Error("archive contains an unsafe path");
  const segments = name.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("archive contains an unsafe path");
  if (segments[0] !== "package") throw new Error("archive entries must remain under package/");
  if (segments.some((segment) => [".git", "node_modules", ".npmrc"].includes(segment.toLowerCase()))) throw new Error("archive contains an unexpected transient path");
  return segments;
}

function archiveEntries(bytes) {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("qualified candidate exceeds the bounded archive size");
  let tar;
  try { tar = gunzipSync(bytes); } catch { throw new Error("qualified candidate is not a gzip tar archive"); }
  const entries = [];
  let offset = 0, terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (zeroBlock(header)) {
      if (offset + 1024 > tar.length || !zeroBlock(tar.subarray(offset + 512, offset + 1024))) throw new Error("archive has a truncated terminator");
      if (tar.subarray(offset + 1024).some((value) => value !== 0)) throw new Error("archive has bytes after its terminator");
      terminated = true;
      break;
    }
    if (entries.length >= MAX_ARCHIVE_ENTRIES) throw new Error("qualified candidate exceeds the bounded entry count");
    const stored = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const name = prefix ? `${prefix}/${stored}` : stored;
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const size = octal(header.subarray(124, 136));
    const mode = octal(header.subarray(100, 108));
    const segments = safeArchivePath(name.replace(/\/$/, ""));
    if (!["0", "5"].includes(type)) throw new Error("archive contains a symlink, device, hard link, or extended metadata entry");
    if (type === "5" && size !== 0) throw new Error("archive directory has content bytes");
    const dataStart = offset + 512, dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("archive entry extends beyond the archive");
    entries.push({ path: segments.join("/"), type, mode, bytes: tar.subarray(dataStart, dataEnd) });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!terminated || !entries.length || offset === 0) throw new Error("qualified candidate has no complete archive terminator");
  const paths = new Set();
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error("archive contains duplicate paths");
    paths.add(entry.path);
  }
  return entries;
}

function writeArchive(entries, stageRoot) {
  const packageRoot = join(stageRoot, "package");
  mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const destination = resolve(stageRoot, entry.path);
    if (!destination.startsWith(`${stageRoot}${sep}`)) throw new Error("archive path escapes private staging");
    if (entry.type === "5") mkdirSync(destination, { recursive: true, mode: 0o700 });
    else {
      mkdirSync(resolve(destination, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(destination, entry.bytes, { flag: "wx", mode: entry.mode & 0o777 });
    }
  }
  const manifestPath = join(packageRoot, "package.json");
  if (!lstatSync(manifestPath).isFile()) throw new Error("archive has no package/package.json");
  return packageRoot;
}

function assertStagedTree(packageRoot) {
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), state = lstatSync(path);
      if (state.isSymbolicLink()) throw new Error("staged package contains a symlink");
      if (state.isDirectory()) walk(path);
      else if (!state.isFile()) throw new Error("staged package contains a non-regular file");
    }
  };
  walk(packageRoot);
  const manifest = parseJson(readFileSync(join(packageRoot, "package.json")), "staged package manifest");
  for (const key of TRANSIENT_MANIFEST_FIELDS) if (Object.hasOwn(manifest, key)) throw new Error(`staged package manifest retains transient ${key} metadata`);
  if (!NAME.test(manifest.name ?? "") || !VERSION.test(manifest.version ?? "")) throw new Error("staged package manifest has an invalid name/version");
  return manifest;
}

function ownerPresentEnvironment(env = process.env) {
  // npm may use the owner's login state via HOME, but this wrapper neither
  // reads nor forwards token variables.  Keep the interactive terminal and
  // ordinary locale/temp values without leaking a broad parent environment.
  const allowed = ["PATH", "HOME", "TERM", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP"];
  return Object.fromEntries(allowed.flatMap((key) => typeof env[key] === "string" ? [[key, env[key]]] : []));
}

function credentialFreeNpmEnvironment(env = process.env, home) {
  // Packing must never consult the owner's npmrc. Use the already-private
  // staging root as HOME so both npm configuration and any cache stay inside
  // the directory that is removed in finally below.
  const allowed = ["PATH", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP"];
  return { ...Object.fromEntries(allowed.flatMap((key) => typeof env[key] === "string" ? [[key, env[key]]] : [])), HOME: home };
}

function runChecked(run, file, args, options, label) {
  const result = run(file, args, options);
  if (result?.error || result?.signal || result?.status !== 0) throw new Error(`${label} failed`);
  return result;
}

function defaultRun(file, args, options) {
  return spawnSync(file, args, { ...options, stdio: options.stdio ?? "inherit", encoding: options.encoding ?? "utf8" });
}

function assertReleaseRuntime(run, env) {
  const options = { env, stdio: "pipe", encoding: "utf8" };
  const node = runChecked(run, process.execPath, ["--version"], options, "pinned Node runtime");
  const npm = runChecked(run, "npm", ["--version"], options, "pinned npm runtime");
  const zlib = runChecked(run, process.execPath, ["-p", "process.versions.zlib"], options, "pinned Node runtime");
  if (String(node.stdout ?? "").trim() !== RELEASE_NODE_VERSION || String(npm.stdout ?? "").trim() !== RELEASE_NPM_VERSION || String(zlib.stdout ?? "").trim() !== RELEASE_ZLIB_VERSION) throw new Error(`owner-present publication requires Node ${RELEASE_NODE_VERSION}, npm ${RELEASE_NPM_VERSION}, and zlib ${RELEASE_ZLIB_VERSION}`);
}

function exactRecord({ root, packageKey, recordPath, record, manifest, candidateBytes }) {
  const expected = resolve(root, "governance", "release-qualifications", `clossys-${packageKey}-${record.candidate?.version}.json`);
  if (recordPath !== expected) throw new Error("qualification record must be the current canonical record for its exact package/version");
  if (!record.candidate || record.timing !== "pre-publication" || record.candidate.name !== manifest.name || record.candidate.version !== manifest.version) throw new Error("qualification record does not bind the staged package identity");
  const actual = hashes(candidateBytes);
  for (const [algorithm, pattern] of Object.entries(SHA)) {
    const expectedHash = record.candidate.tarball?.[algorithm];
    if (!pattern.test(expectedHash ?? "") || actual[algorithm] !== expectedHash) throw new Error(`qualified candidate ${algorithm} does not match its record`);
  }
  if (record.candidate.packageManifestSha256 !== digest("sha256", readFileSync(join(resolve(root, "packages", packageKey), "package.json")))) throw new Error("qualification record does not match the current package manifest");
}

function assertReleaseTarget(root, packageKey, manifest) {
  const identity = readCurrentReleaseIdentity({ path: resolve(root, "package-scope.json") });
  const target = resolveReleaseTarget(loadReleaseCatalog({ path: resolve(root, "governance/release-catalog.json") }), identity);
  assertPackageAuthorized(target, packageKey);
  if (target.registry !== "https://registry.npmjs.org" || target.access !== "public" || !manifest.name.startsWith(`${target.scope}/`)) throw new Error("owner-present publication requires the exact active public npm target");
  return target;
}

export async function publishQualifiedDirectory({ root = process.cwd(), packageKey, candidatePath, recordPath, env = process.env, run = defaultRun, verify = verifyPostPublishPublicNpmArtifact, stagingParent = tmpdir() }) {
  if (!KEY.test(packageKey ?? "")) throw new Error("package key is invalid");
  const absoluteRoot = resolve(root);
  const candidate = regularBytes(candidatePath, "qualified candidate");
  const recordInput = regularBytes(recordPath, "qualification record");
  const record = parseJson(recordInput.bytes, "qualification record");
  const entries = archiveEntries(candidate.bytes);
  const stageRoot = mkdtempSync(join(stagingParent, "clossys-qualified-publish-"));
  chmodSync(stageRoot, 0o700);
  try {
    const credentialFreeNpm = credentialFreeNpmEnvironment(env, stageRoot);
    assertReleaseRuntime(run, credentialFreeNpm);
    const packageRoot = writeArchive(entries, stageRoot);
    const manifest = assertStagedTree(packageRoot);
    exactRecord({ root: absoluteRoot, packageKey, recordPath: recordInput.absolute, record, manifest, candidateBytes: candidate.bytes });
    const target = assertReleaseTarget(absoluteRoot, packageKey, manifest);
    const denylist = env.PUBLIC_SAFETY_DENYLIST;
    if (typeof denylist !== "string" || !denylist) throw new Error("FULL staged public-safety scan requires PUBLIC_SAFETY_DENYLIST");
    const safetyEnv = { PATH: env.PATH ?? "/usr/bin:/bin", PUBLIC_SAFETY_DENYLIST: denylist };
    runChecked(run, process.execPath, [join(absoluteRoot, "scripts/check-public-safety.mjs"), packageRoot, "--artifact", "--no-gitignore", "--allow-changelogs", "--require-denylist", "--scope-config", join(absoluteRoot, "package-scope.json")], { cwd: absoluteRoot, env: safetyEnv }, "FULL staged public-safety scan");

    const packed = join(stageRoot, "packed"); mkdirSync(packed, { mode: 0o700 });
    const packedResult = runChecked(run, "npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: packageRoot, env: credentialFreeNpm, stdio: "pipe", encoding: "utf8" }, "clean-directory npm pack");
    let packEntries;
    try { packEntries = JSON.parse(String(packedResult.stdout ?? "")); } catch { throw new Error("clean-directory npm pack did not return one JSON result"); }
    if (!Array.isArray(packEntries) || packEntries.length !== 1 || typeof packEntries[0]?.filename !== "string" || basename(packEntries[0].filename) !== packEntries[0].filename) throw new Error("clean-directory npm pack returned an unsafe result");
    const repacked = regularBytes(join(packed, packEntries[0].filename), "repacked candidate");
    const original = hashes(candidate.bytes), replay = hashes(repacked.bytes);
    if (Object.keys(SHA).some((algorithm) => original[algorithm] !== replay[algorithm])) throw new Error("clean-directory npm pack differs from the immutable qualified candidate");

    // This is intentionally the only upload command. It receives only '.',
    // never a tarball, URL, package specifier, token, OTP, or provenance flag.
    // BSD script gives npm a real terminal for its owner-present WebAuthn/OTP
    // conversation while this parent captures both output streams.  /dev/null
    // is its transcript destination: npm output is neither persisted nor
    // echoed by this wrapper, and stdin remains attached to the owner.
    runChecked(run, PTY_SCRIPT, ["-q", "/dev/null", "npm", "publish", ".", "--access", "public", "--ignore-scripts", "--registry", target.registry], { cwd: packageRoot, env: ownerPresentEnvironment(env), stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" }, "owner-present npm publish");
    await verify({ root: absoluteRoot, packageKey, expectedTarball: repacked.absolute, env: anonymousEnvironment(env) });
    return { name: manifest.name, version: manifest.version, tarball: replay };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const args = argsFrom(process.argv);
    await publishQualifiedDirectory({ packageKey: args.package, candidatePath: args.candidate, recordPath: args.record });
    process.stdout.write("owner-present publication and anonymous served-byte verification completed.\n");
  } catch (error) {
    // Do not echo npm's output, registry documents, input paths, or an
    // interactive account context. The caller only gets the control verdict.
    console.error(`publish-qualified-directory: ${error.message}`);
    process.exitCode = 1;
  }
}
