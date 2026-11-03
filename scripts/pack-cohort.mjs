#!/usr/bin/env node
// pack-cohort — the six-package consumer cohort, packed from this checkout.
//
//   node scripts/pack-cohort.mjs --out <dir>
//   node scripts/pack-cohort.mjs --check <dir> [--expected-sha <sha>]
//
// Exit 0 = packed / verified. Exit 1 = fail closed. Exit 2 = usage error.
//
// `--out` builds and packs producer, strategist, designer, writer, publisher
// and controller from the current HEAD (which must be clean) and writes
// exactly <key>.tgz for each plus overlay-manifest.json, the same
// `foundry-overlay-manifest` schema the overlay prerelease uses, over all six.
// A consumer's intake script (for example a `foundry-local` verifier) reads
// that directory as is. docs/releasing/overlay.md, "Consumer cohort pack".
//
// Nothing here is new packing logic. Building, the Studio standalone build
// (packages/producer/dist/studio, which `clossys produce` starts) and
// `npm pack --ignore-scripts` are packages/producer/scripts/pack-five.mjs;
// tree digests, integrity and the manifest are scripts/overlay-manifest.mjs.
// This script runs the first into a private staging directory, renames each
// tarball to <key>.tgz and builds and checks the manifest with the second.
// Versions are packed as they are; nothing is bumped or published.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COHORT_PACKAGES,
  MANIFEST_FILE,
  assertOverlayPackagesPublic,
  buildOverlayManifest,
  committedAtFromGit,
  expectedFromPackagesRoot,
  overlayDirectoryFiles,
  verifyOverlayRelease,
} from "./overlay-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packFive = join(repoRoot, "packages/producer/scripts/pack-five.mjs");
const COMMIT = /^[a-f0-9]{40}$/;
/** The file whose presence in producer.tgz proves Studio shipped (build-studio.mjs writes it). */
export const STUDIO_MANIFEST_ENTRY = "package/dist/studio/manifest.json";

class UsageError extends Error {}

const git = (args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function inside(parent, path) {
  const rel = relative(parent, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function canonical(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonical(dirname(path)), basename(path));
}

function tarEntries(tarball) {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean);
}

/**
 * Verify a cohort directory: exactly the six tarballs and the manifest, each
 * tarball matching its manifest entry byte for byte and tree for tree, every
 * packed package.json public, and producer.tgz carrying the built Studio.
 */
export function checkCohort(dir, { expectedSha } = {}) {
  overlayDirectoryFiles(dir, COHORT_PACKAGES);
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")); }
  catch { throw new Error(`${MANIFEST_FILE} is missing or not valid JSON`); }
  verifyOverlayRelease({ manifest, dir, packages: COHORT_PACKAGES });
  if (expectedSha !== undefined && manifest.commit !== expectedSha) throw new Error(`manifest commit ${manifest.commit} is not the expected ${expectedSha}`);
  for (const key of COHORT_PACKAGES) {
    if (manifest.packages[key].name !== `@clossys/${key}`) throw new Error(`${key}.tgz holds ${manifest.packages[key].name}, not @clossys/${key}`);
  }
  if (!tarEntries(join(dir, "producer.tgz")).includes(STUDIO_MANIFEST_ENTRY)) {
    throw new Error(`producer.tgz has no ${STUDIO_MANIFEST_ENTRY}: the Studio standalone build is missing, so \`clossys produce\` cannot start`);
  }
  return manifest;
}

/** Build, pack and write the cohort into `out` (empty or absent, outside the checkout). */
export function packCohort(out) {
  const target = canonical(resolve(out));
  if (inside(realpathSync(repoRoot), target)) throw new UsageError("--out must be outside the checkout");
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) throw new UsageError("--out must be an empty or absent directory");
  const packagesRoot = join(repoRoot, "packages");
  assertOverlayPackagesPublic(packagesRoot, COHORT_PACKAGES);
  if (git(["status", "--porcelain=v1", "--untracked-files=all"]).length > 0) throw new Error("checkout is not clean; the manifest commit must name exactly what was packed");
  const commit = git(["rev-parse", "HEAD"]).trim();

  const staging = mkdtempSync(join(tmpdir(), "pack-cohort-"));
  try {
    const five = join(staging, "five");
    const result = spawnSync(process.execPath, [packFive, "--out-dir", five], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pack-five failed (${result.status ?? result.signal})`);
    const summary = JSON.parse(readFileSync(join(five, "summary.json"), "utf8"));
    if (summary.complete !== true || summary.studio?.status !== "built") throw new Error("pack-five did not build Studio; the cohort requires it");
    if (summary.source?.dirty !== false || summary.source?.head !== commit) throw new Error(`pack-five packed ${summary.source?.head ?? "an unknown head"} (dirty: ${summary.source?.dirty}), not clean ${commit}`);

    const packed = join(staging, "packed");
    mkdirSync(packed);
    for (const key of COHORT_PACKAGES) {
      const entry = summary.packages.find((pkg) => pkg.name === `@clossys/${key}`);
      if (!entry) throw new Error(`pack-five produced no @clossys/${key}`);
      copyFileSync(join(five, entry.filename), join(packed, `${key}.tgz`));
    }
    const manifest = buildOverlayManifest({
      packedDir: packed,
      changesetsDir: join(repoRoot, ".changesets"),
      commit,
      committedAt: committedAtFromGit(repoRoot, commit),
      expected: expectedFromPackagesRoot(packagesRoot, COHORT_PACKAGES),
      packages: COHORT_PACKAGES,
    });
    writeFileSync(join(packed, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    checkCohort(packed, { expectedSha: commit });

    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(packed)) copyFileSync(join(packed, name), join(target, name));
    return checkCohort(target, { expectedSha: commit });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function report(manifest, dir, verb) {
  for (const key of COHORT_PACKAGES) {
    const entry = manifest.packages[key];
    console.log(`pack-cohort: ${key}.tgz ${entry.name}@${entry.version} ${entry.tarballBytes} bytes, ${entry.files} files, sha256 ${entry.tarballSha256}`);
  }
  console.log(`pack-cohort: ${verb} ${dir} at commit ${manifest.commit} (${manifest.pendingChangesets.length} pending changeset(s))`);
}

function main(argv) {
  const [flag, dir, ...rest] = argv;
  if (!dir || dir.startsWith("--")) throw new UsageError("usage: pack-cohort.mjs --out <dir> | --check <dir> [--expected-sha <sha>]");
  if (flag === "--out" && rest.length === 0) {
    const manifest = packCohort(dir);
    report(manifest, canonical(resolve(dir)), "packed");
    return 0;
  }
  if (flag === "--check" && (rest.length === 0 || (rest.length === 2 && rest[0] === "--expected-sha"))) {
    const expectedSha = rest[1];
    if (expectedSha !== undefined && !COMMIT.test(expectedSha)) throw new UsageError("--expected-sha must be a full 40-character lowercase sha");
    const manifest = checkCohort(resolve(dir), { expectedSha });
    report(manifest, resolve(dir), "verified");
    return 0;
  }
  throw new UsageError("usage: pack-cohort.mjs --out <dir> | --check <dir> [--expected-sha <sha>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`pack-cohort: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
