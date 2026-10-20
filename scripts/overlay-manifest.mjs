#!/usr/bin/env node
// overlay-manifest — the digest manifest for the rolling overlay prerelease.
//
//   node scripts/overlay-manifest.mjs build  --packed <dir> --commit <sha> --out <file>
//                                            [--committed-at <iso>] [--changesets <dir>]
//                                            [--packages-root <dir>]
//   node scripts/overlay-manifest.mjs verify --manifest <file> --dir <dir>
//                                            [--scanned <json>]
//   node scripts/overlay-manifest.mjs digests --dir <dir>
//   node scripts/overlay-manifest.mjs decide --manifest <file> --main-tip <sha>
//                                            [--published <file>] [--comparison <status>]
//
// Exit 0 = built / verified / decided (a `decide` that skips is still 0).
// Exit 1 = fail closed (a package is missing, a digest does not match, a
// tree is malformed, decision input is malformed). Exit 2 = usage error.
//
// WHAT THIS IS FOR
// ----------------
// .github/workflows/overlay-prerelease.yml packs designer and publisher on
// every main merge and uploads the two tarballs plus this manifest to one
// rolling GitHub prerelease, so a consumer can preview unpublished main
// before it reaches npm. docs/releasing/overlay.md is the consumer side.
//
// A consumer has to tell "main changed what I install" apart from "the same
// content was packed again". Neither the version (unchanged until a release
// PR applies the pending changesets) nor the tarball hash (gzip bytes move
// with the runtime that compressed them) answers that. So the manifest
// carries, per package, a digest of the UNPACKED tree, and, repository-wide,
// the names of the pending .changesets/ files. Those two are the whole
// change-detection key (overlayChangeKey). The tarball hash is recorded so a
// download can be checked byte-for-byte, and is deliberately left out of the
// key. The manifest also names the commit it was built from, that commit's
// own committer timestamp (`committedAt`, ISO 8601 UTC, read from git, never
// the wall clock, so a rebuild of one commit is byte-identical), and each
// tarball's npm-style SRI `integrity` (`sha512-<base64>`), so a consumer can
// pin and check the exact download. docs/releasing/overlay.md documents
// every field.
//
// TREE DIGEST (sha256-lines-v1)
// -----------------------------
// For every regular file under the extracted `package/` directory, one line
// `<sha256 of the file bytes>  <path relative to package/>\n`, sorted by the
// path's bytes; the digest is the sha256 of those lines concatenated. File
// modes and mtimes are not part of it. A symlink, device or any other
// non-regular entry fails closed rather than being skipped: npm tarballs do
// not carry them, so seeing one means the input is not what it claims to be.
//
// Nothing here packs. Packing is `npm pack --ignore-scripts`, done by the
// workflow exactly as ci.yml's artifact-pack job does it.
//
// SCANNED BYTES AND FRESHNESS
// ---------------------------
// The workflow scans the exact files in a job of their own, FULL mode with
// the identity denylist, before the publish job runs. `digests` prints the
// sha256 of each of the three files that scan saw, and the publish job runs
// `verify --scanned` with that record (assertScannedDigests), so what it
// uploads is byte-for-byte what was scanned. Before it moves the tag or
// replaces an asset, the publish job asks `decide` (overlayPublishDecision)
// whether this run may mutate the release at all: only when its commit is
// still the tip of main and is not older than the commit the published
// manifest names. A rerun of an older run therefore leaves the release alone.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OVERLAY_PACKAGES = Object.freeze(["designer", "publisher"]);
export const MANIFEST_KIND = "foundry-overlay-manifest";
export const MANIFEST_SCHEMA_VERSION = 1;
export const TREE_DIGEST_ALGORITHM = "sha256-lines-v1";
export const MANIFEST_FILE = "overlay-manifest.json";
/** Every file the rolling release carries, sorted by byte order. */
export const OVERLAY_FILES = Object.freeze([...OVERLAY_PACKAGES.map((dir) => `${dir}.tgz`), MANIFEST_FILE].sort());
// GitHub's compare API status for <published>...<run>.
const COMPARISON_STATUSES = Object.freeze(["ahead", "behind", "diverged", "identical"]);

const CHANGESET_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const HEX64 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const COMMITTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// 64 sha512 bytes are always 88 base64 characters ending in "==".
const SRI_SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sri512 = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/** ISO 8601 UTC, whole seconds, `Z` suffix: the only committedAt form accepted. */
export function isCommittedAt(value) {
  if (typeof value !== "string" || !COMMITTED_AT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().replace(".000Z", "Z") === value;
}

/** committedAt for `commit`, from the commit's own committer timestamp. */
export function committedAtFromGit(repoRoot, commit) {
  let epoch;
  try { epoch = execFileSync("git", ["-C", repoRoot, "show", "-s", "--format=%ct", commit], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new Error(`cannot read committedAt for commit ${commit} from git`); }
  if (!/^\d+$/.test(epoch)) throw new Error(`cannot read committedAt for commit ${commit} from git`);
  return new Date(Number(epoch) * 1000).toISOString().replace(".000Z", "Z");
}

/** Digest an unpacked package tree. Throws on anything but files and directories. */
export function treeDigest(root) {
  const entries = [];
  (function walk(dir, prefix) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (/[\n\r\0]/.test(rel)) throw new Error(`tree path contains a control character: ${JSON.stringify(rel)}`);
      const state = lstatSync(full);
      if (state.isDirectory()) walk(full, rel);
      else if (state.isFile()) entries.push({ rel, hash: sha256(readFileSync(full)) });
      else throw new Error(`tree entry is not a regular file or directory: ${rel}`);
    }
  })(root, "");
  if (entries.length === 0) throw new Error(`tree has no files: ${root}`);
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.rel), Buffer.from(b.rel)));
  const lines = entries.map((entry) => `${entry.hash}  ${entry.rel}\n`).join("");
  return { digest: sha256(lines), files: entries.length };
}

/** Pending changeset file names, sorted. README.md and non-changeset names are skipped. */
export function pendingChangesetNames(changesetsDir) {
  if (!existsSync(changesetsDir)) throw new Error(`changesets directory not found: ${changesetsDir}`);
  return readdirSync(changesetsDir)
    .filter((name) => CHANGESET_NAME.test(name) && lstatSync(join(changesetsDir, name)).isFile())
    .sort();
}

// Extract one tarball into a private scratch directory, run `use` on its
// package/ root, and always clean up.
function withExtractedTarball(tarballPath, use) {
  const work = mkdtempSync(join(tmpdir(), "overlay-manifest-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", work], { stdio: ["ignore", "pipe", "pipe"] });
    const top = readdirSync(work);
    if (top.length !== 1 || top[0] !== "package") throw new Error(`${tarballPath}: tarball must hold exactly one top-level package/ directory (found: ${top.join(", ") || "nothing"})`);
    const root = join(work, "package");
    if (!lstatSync(root).isDirectory()) throw new Error(`${tarballPath}: package/ is not a directory`);
    return use(root);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function describeTarball(dir, tarballPath) {
  if (!existsSync(tarballPath)) throw new Error(`missing package ${dir}: ${dir}.tgz not found`);
  const state = lstatSync(tarballPath);
  if (!state.isFile()) throw new Error(`missing package ${dir}: ${dir}.tgz is not a regular file`);
  const bytes = readFileSync(tarballPath);
  return withExtractedTarball(tarballPath, (root) => {
    let packed;
    try { packed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); }
    catch { throw new Error(`${dir}: packed package.json is missing or invalid`); }
    if (typeof packed.name !== "string" || !packed.name || typeof packed.version !== "string" || !packed.version) {
      throw new Error(`${dir}: packed package.json has no name or version`);
    }
    const tree = treeDigest(root);
    return {
      name: packed.name,
      version: packed.version,
      tarball: `${dir}.tgz`,
      integrity: sri512(bytes),
      tarballSha256: sha256(bytes),
      tarballBytes: bytes.length,
      treeDigest: tree.digest,
      files: tree.files,
    };
  });
}

/**
 * Build the manifest for <packedDir>/<dir>.tgz for every overlay package.
 * `expected` (optional) maps each dir to the { name, version } its tarball
 * must carry; the CLI fills it from packages/<dir>/package.json.
 */
export function buildOverlayManifest({ packedDir, changesetsDir, commit, committedAt, expected }) {
  if (!COMMIT.test(commit ?? "")) throw new Error(`commit must be a full 40-character lowercase sha (got ${JSON.stringify(commit)})`);
  if (!isCommittedAt(committedAt)) throw new Error(`committedAt must be ISO 8601 UTC like 2026-01-31T12:00:00Z (got ${JSON.stringify(committedAt)})`);
  const packages = {};
  for (const dir of OVERLAY_PACKAGES) {
    const entry = describeTarball(dir, join(packedDir, `${dir}.tgz`));
    if (expected) {
      const want = expected[dir];
      if (!want) throw new Error(`missing package ${dir}: no expected identity supplied`);
      if (entry.name !== want.name) throw new Error(`${dir}: packed name ${entry.name} does not match expected ${want.name}`);
      if (entry.version !== want.version) throw new Error(`${dir}: packed version ${entry.version} does not match expected ${want.version}`);
    }
    packages[dir] = entry;
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    treeDigestAlgorithm: TREE_DIGEST_ALGORITHM,
    commit,
    committedAt,
    pendingChangesets: pendingChangesetNames(changesetsDir),
    packages,
  };
  validateOverlayManifest(manifest);
  return manifest;
}

/** Throw unless `manifest` is a complete overlay manifest for exactly the overlay set. */
export function validateOverlayManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest is not an object");
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error(`manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  if (manifest.kind !== MANIFEST_KIND) throw new Error(`manifest kind must be ${MANIFEST_KIND}`);
  if (manifest.treeDigestAlgorithm !== TREE_DIGEST_ALGORITHM) throw new Error(`manifest treeDigestAlgorithm must be ${TREE_DIGEST_ALGORITHM}`);
  if (!COMMIT.test(manifest.commit ?? "")) throw new Error("manifest commit must be a full 40-character lowercase sha");
  if (!isCommittedAt(manifest.committedAt)) throw new Error("manifest committedAt must be ISO 8601 UTC like 2026-01-31T12:00:00Z");
  const changesets = manifest.pendingChangesets;
  if (!Array.isArray(changesets) || changesets.some((name) => typeof name !== "string" || !CHANGESET_NAME.test(name))) {
    throw new Error("manifest pendingChangesets must be an array of changeset file names");
  }
  if (changesets.some((name, index) => index > 0 && changesets[index - 1] >= name)) throw new Error("manifest pendingChangesets must be sorted and unique");
  const packages = manifest.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) throw new Error("manifest packages is not an object");
  for (const dir of OVERLAY_PACKAGES) {
    if (!Object.hasOwn(packages, dir)) throw new Error(`manifest is missing package ${dir}`);
  }
  for (const key of Object.keys(packages)) {
    if (!OVERLAY_PACKAGES.includes(key)) throw new Error(`manifest has unexpected package ${key}`);
  }
  for (const dir of OVERLAY_PACKAGES) {
    const entry = packages[dir];
    if (!entry || typeof entry !== "object") throw new Error(`manifest package ${dir} is not an object`);
    if (typeof entry.name !== "string" || !entry.name) throw new Error(`manifest package ${dir} has no name`);
    if (typeof entry.version !== "string" || !entry.version) throw new Error(`manifest package ${dir} has no version`);
    if (entry.tarball !== `${dir}.tgz`) throw new Error(`manifest package ${dir} tarball must be ${dir}.tgz`);
    if (typeof entry.integrity !== "string" || !SRI_SHA512.test(entry.integrity)) throw new Error(`manifest package ${dir} integrity must be an SRI sha512-<base64> string`);
    if (!HEX64.test(entry.tarballSha256 ?? "")) throw new Error(`manifest package ${dir} tarballSha256 is not a sha256`);
    if (!Number.isInteger(entry.tarballBytes) || entry.tarballBytes <= 0) throw new Error(`manifest package ${dir} tarballBytes is not a positive integer`);
    if (!HEX64.test(entry.treeDigest ?? "")) throw new Error(`manifest package ${dir} treeDigest is not a sha256`);
    if (!Number.isInteger(entry.files) || entry.files <= 0) throw new Error(`manifest package ${dir} files is not a positive integer`);
  }
  return manifest;
}

/**
 * The change-detection key: pending changeset names plus each package's
 * unpacked-tree digest. Tarball hash, byte count, version and commit are
 * deliberately not part of it.
 */
export function overlayChangeKey(manifest) {
  validateOverlayManifest(manifest);
  return JSON.stringify({
    pendingChangesets: manifest.pendingChangesets,
    packages: Object.fromEntries(OVERLAY_PACKAGES.map((dir) => [dir, manifest.packages[dir].treeDigest])),
  });
}

/** True when `next` would install different content (or pending changes) than `previous`. */
export function overlayChanged(previous, next) {
  return overlayChangeKey(previous) !== overlayChangeKey(next);
}

/** Check every tarball in <dir> against `manifest`: bytes, unpacked tree and identity. */
export function verifyOverlayRelease({ manifest, dir }) {
  validateOverlayManifest(manifest);
  for (const pkg of OVERLAY_PACKAGES) {
    const want = manifest.packages[pkg];
    const got = describeTarball(pkg, join(dir, want.tarball));
    if (got.integrity !== want.integrity) throw new Error(`${pkg}: integrity mismatch (manifest ${want.integrity}, file ${got.integrity})`);
    if (got.tarballSha256 !== want.tarballSha256) throw new Error(`${pkg}: tarballSha256 mismatch (manifest ${want.tarballSha256}, file ${got.tarballSha256})`);
    if (got.tarballBytes !== want.tarballBytes) throw new Error(`${pkg}: tarballBytes mismatch`);
    if (got.treeDigest !== want.treeDigest) throw new Error(`${pkg}: treeDigest mismatch (manifest ${want.treeDigest}, file ${got.treeDigest})`);
    if (got.files !== want.files) throw new Error(`${pkg}: files mismatch`);
    if (got.name !== want.name || got.version !== want.version) throw new Error(`${pkg}: packed name/version does not match the manifest`);
  }
  return true;
}

// The directory must hold exactly OVERLAY_FILES, each a regular file.
function overlayDirectoryFiles(dir) {
  const names = readdirSync(dir).sort();
  if (names.length !== OVERLAY_FILES.length || names.some((name, index) => name !== OVERLAY_FILES[index])) {
    throw new Error(`overlay directory must hold exactly ${OVERLAY_FILES.join(", ")} (found: ${names.join(", ") || "nothing"})`);
  }
  for (const name of names) {
    if (!lstatSync(join(dir, name)).isFile()) throw new Error(`${name}: not a regular file`);
  }
  return names;
}

/** The scan record: sha256 of every overlay file in <dir>, keyed by file name. */
export function scannedDigests(dir) {
  return Object.fromEntries(overlayDirectoryFiles(dir).map((name) => [name, sha256(readFileSync(join(dir, name)))]));
}

/**
 * Throw unless <dir> holds exactly the overlay files and each one's sha256
 * equals the digest the scan job recorded for it.
 */
export function assertScannedDigests({ dir, scanned }) {
  if (!scanned || typeof scanned !== "object" || Array.isArray(scanned)) throw new Error("scan record is not an object");
  const keys = Object.keys(scanned).sort();
  if (keys.length !== OVERLAY_FILES.length || keys.some((key, index) => key !== OVERLAY_FILES[index])) {
    throw new Error(`scan record must name exactly ${OVERLAY_FILES.join(", ")} (got: ${keys.join(", ") || "nothing"})`);
  }
  for (const name of OVERLAY_FILES) {
    if (!HEX64.test(scanned[name] ?? "")) throw new Error(`scan record ${name} is not a sha256`);
  }
  const actual = scannedDigests(dir);
  for (const name of OVERLAY_FILES) {
    if (actual[name] !== scanned[name]) throw new Error(`${name}: sha256 differs from the scanned bytes (scanned ${scanned[name]}, file ${actual[name]})`);
  }
  return true;
}

/**
 * May this run mutate the rolling release?
 *
 *   run         this run's own manifest (commit, committedAt).
 *   mainTip     the commit main points at now.
 *   published   the manifest the release carries now, or null when none is published.
 *   comparison  GitHub's compare status for <published.commit>...<run.commit>;
 *               required whenever the two commits differ.
 *
 * Returns { publish, reason }. Skips (publish false) when the run is not the
 * tip of main, when its committedAt is older than the published one, or when
 * it is not a descendant of the published commit. Throws on malformed input,
 * so the caller fails closed rather than guessing.
 */
export function overlayPublishDecision({ run, mainTip, published, comparison }) {
  validateOverlayManifest(run);
  if (!COMMIT.test(mainTip ?? "")) throw new Error(`main tip must be a full 40-character lowercase sha (got ${JSON.stringify(mainTip)})`);
  if (published !== null && published !== undefined) validateOverlayManifest(published);
  if (comparison !== undefined && !COMPARISON_STATUSES.includes(comparison)) throw new Error(`comparison must be one of ${COMPARISON_STATUSES.join(", ")} (got ${JSON.stringify(comparison)})`);
  if (run.commit !== mainTip) {
    return { publish: false, reason: `run commit ${run.commit} is not the current tip of main (${mainTip}); the run for the newer commit owns the overlay` };
  }
  if (!published) return { publish: true, reason: `no overlay manifest is published yet; publishing ${run.commit}` };
  if (published.commit === run.commit) return { publish: true, reason: `republishing ${run.commit}, the commit already published` };
  if (comparison === undefined) throw new Error("comparison is required when the run and published commits differ");
  if (Date.parse(run.committedAt) < Date.parse(published.committedAt)) {
    return { publish: false, reason: `run committedAt ${run.committedAt} is older than the published ${published.committedAt} (${published.commit})` };
  }
  if (comparison !== "ahead") {
    return { publish: false, reason: `run commit ${run.commit} is not a descendant of the published ${published.commit} (compare status: ${comparison})` };
  }
  return { publish: true, reason: `${run.commit} is the tip of main and a descendant of the published ${published.commit}` };
}

function readJsonFile(path, what) {
  try { return JSON.parse(readFileSync(resolve(path), "utf8")); }
  catch { throw new Error(`${what} is missing or not valid JSON`); }
}

function expectedFromPackagesRoot(packagesRoot) {
  const expected = {};
  for (const dir of OVERLAY_PACKAGES) {
    const path = join(packagesRoot, dir, "package.json");
    let manifest;
    try { manifest = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new Error(`missing package ${dir}: ${dir}/package.json not readable under the packages root`); }
    expected[dir] = { name: manifest.name, version: manifest.version };
  }
  return expected;
}

function parseArgs(argv, allowed) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.includes(flag)) throw new UsageError(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
    if (Object.hasOwn(values, flag)) throw new UsageError(`duplicate ${flag}`);
    values[flag] = value;
    index += 1;
  }
  return values;
}

class UsageError extends Error {}

function main(argv) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...rest] = argv;
  if (command === "build") {
    const args = parseArgs(rest, ["--packed", "--commit", "--committed-at", "--out", "--changesets", "--packages-root"]);
    for (const flag of ["--packed", "--commit", "--out"]) if (!args[flag]) throw new UsageError(`${flag} is required`);
    if (!COMMIT.test(args["--commit"])) throw new UsageError("--commit must be a full 40-character lowercase sha");
    if (args["--committed-at"] !== undefined && !isCommittedAt(args["--committed-at"])) throw new UsageError("--committed-at must be ISO 8601 UTC like 2026-01-31T12:00:00Z");
    const manifest = buildOverlayManifest({
      packedDir: resolve(args["--packed"]),
      changesetsDir: resolve(args["--changesets"] ?? join(repoRoot, ".changesets")),
      commit: args["--commit"],
      committedAt: args["--committed-at"] ?? committedAtFromGit(repoRoot, args["--commit"]),
      expected: expectedFromPackagesRoot(resolve(args["--packages-root"] ?? join(repoRoot, "packages"))),
    });
    writeFileSync(resolve(args["--out"]), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const dir of OVERLAY_PACKAGES) {
      const entry = manifest.packages[dir];
      console.log(`overlay-manifest: ${entry.name}@${entry.version} tree ${entry.treeDigest} integrity ${entry.integrity}`);
    }
    console.log(`overlay-manifest: ${manifest.pendingChangesets.length} pending changeset(s); commit ${manifest.commit} committed ${manifest.committedAt}`);
    return 0;
  }
  if (command === "verify") {
    const args = parseArgs(rest, ["--manifest", "--dir", "--scanned"]);
    for (const flag of ["--manifest", "--dir"]) if (!args[flag]) throw new UsageError(`${flag} is required`);
    const manifest = readJsonFile(args["--manifest"], "manifest");
    if (args["--scanned"] !== undefined) {
      let scanned;
      try { scanned = JSON.parse(args["--scanned"]); }
      catch { throw new Error("scan record is not valid JSON"); }
      assertScannedDigests({ dir: resolve(args["--dir"]), scanned });
    }
    verifyOverlayRelease({ manifest, dir: resolve(args["--dir"]) });
    console.log(`overlay-manifest: verified ${OVERLAY_PACKAGES.join(", ")} against commit ${manifest.commit}${args["--scanned"] !== undefined ? " and the scanned digests" : ""}`);
    return 0;
  }
  if (command === "digests") {
    const args = parseArgs(rest, ["--dir"]);
    if (!args["--dir"]) throw new UsageError("--dir is required");
    console.log(JSON.stringify(scannedDigests(resolve(args["--dir"]))));
    return 0;
  }
  if (command === "decide") {
    const args = parseArgs(rest, ["--manifest", "--main-tip", "--published", "--comparison"]);
    for (const flag of ["--manifest", "--main-tip"]) if (!args[flag]) throw new UsageError(`${flag} is required`);
    const decision = overlayPublishDecision({
      run: readJsonFile(args["--manifest"], "run manifest"),
      mainTip: args["--main-tip"],
      published: args["--published"] === undefined ? null : readJsonFile(args["--published"], "published manifest"),
      comparison: args["--comparison"],
    });
    // Two GITHUB_OUTPUT-shaped lines; the reason never holds a newline.
    console.log(`publish=${decision.publish}`);
    console.log(`reason=${decision.reason}`);
    return 0;
  }
  throw new UsageError("usage: overlay-manifest.mjs build|verify|digests|decide ...");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`overlay-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
