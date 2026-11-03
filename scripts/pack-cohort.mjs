#!/usr/bin/env node
// pack-cohort — the six-package consumer cohort, packed from this checkout.
//
//   node scripts/pack-cohort.mjs --out <dir> [--draft [--preview-bindings <file>]]
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
//
// DRAFT PACKS
// -----------
// A release Studio build reads Studio copy only from pinned Writer candidates
// and native frames/sections only from pins. `--draft` passes explicit native
// bindings to pack-five as `--preview-bindings` instead: by default the
// bindings the committed Studio map (packages/producer/studio/generated/
// studio-map.json) was generated from, so the build reproduces that preview
// exactly. Studio then carries `preview` (status DRAFT, approved false,
// releaseQualified false) in producer.tgz's dist/studio/manifest.json. The
// overlay manifest keeps its exact schema, because consumer intake rejects any
// extra key, so that Studio manifest is where a pack says it is a draft;
// `--check` reports it.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const committedStudioMap = join(repoRoot, "packages/producer/studio/generated/studio-map.json");
const studioLibrary = join(repoRoot, "clossys/library");

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
 * The native bindings the committed Studio map was generated from: one
 * { slot, element, version, hash } row per item, the hash read from the
 * library record. Throws unless their digest is the map's own bindingDigest.
 */
export function committedDraftBindings(mapPath = committedStudioMap, library = studioLibrary) {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  if (map.assembly?.status !== "DRAFT" || !Array.isArray(map.items) || map.items.length === 0) throw new Error("the committed Studio map is not a DRAFT preview with items; pass --preview-bindings <file>");
  const rows = map.items.map(({ slot, element, version }) => {
    const record = JSON.parse(readFileSync(join(library, slot, element, `v${version}`, "element.json"), "utf8"));
    return { slot, element, version, hash: record.hash };
  }).sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  if (digest !== map.assembly.bindingDigest) throw new Error(`bindings derived from the committed Studio map digest to ${digest}, not its bindingDigest ${map.assembly.bindingDigest}`);
  return rows;
}

/** The Studio `preview` descriptor producer.tgz carries, or null for a release build. */
export function studioPreview(dir) {
  const raw = execFileSync("tar", ["-xzOf", join(dir, "producer.tgz"), STUDIO_MANIFEST_ENTRY], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(raw).preview ?? null;
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
  const preview = studioPreview(dir);
  if (preview !== null && (preview.status !== "DRAFT" || preview.releaseQualified !== false)) throw new Error("producer.tgz Studio preview must be DRAFT and not release-qualified");
  return { manifest, draft: preview };
}

/** Build, pack and write the cohort into `out` (empty or absent, outside the checkout). */
export function packCohort(out, { draft = false, bindingsPath } = {}) {
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
    const preview = [];
    if (draft) {
      let bindings = bindingsPath && resolve(bindingsPath);
      if (!bindings) {
        bindings = join(staging, "draft-bindings.json");
        writeFileSync(bindings, `${JSON.stringify(committedDraftBindings(), null, 2)}\n`);
      }
      preview.push("--preview-bindings", bindings);
    }
    const result = spawnSync(process.execPath, [packFive, "--out-dir", five, ...preview], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pack-five failed (${result.status ?? result.signal})`);
    const summary = JSON.parse(readFileSync(join(five, "summary.json"), "utf8"));
    if (summary.complete !== true || summary.studio?.status !== "built") throw new Error("pack-five did not build Studio; the cohort requires it");
    if (draft !== (summary.studio.preview?.status === "DRAFT")) throw new Error(`pack-five Studio is ${summary.studio.preview ? "DRAFT" : "release"}, not the requested ${draft ? "DRAFT" : "release"} build`);
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
    if ((checkCohort(packed, { expectedSha: commit }).draft !== null) !== draft) throw new Error("packed Studio DRAFT marker does not match the requested build");

    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(packed)) copyFileSync(join(packed, name), join(target, name));
    return checkCohort(target, { expectedSha: commit });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function report({ manifest, draft }, dir, verb) {
  for (const key of COHORT_PACKAGES) {
    const entry = manifest.packages[key];
    console.log(`pack-cohort: ${key}.tgz ${entry.name}@${entry.version} ${entry.tarballBytes} bytes, ${entry.files} files, sha256 ${entry.tarballSha256}`);
  }
  console.log(`pack-cohort: ${verb} ${dir} at commit ${manifest.commit} (${manifest.pendingChangesets.length} pending changeset(s))`);
  console.log(draft ? `pack-cohort: DRAFT pack, approved ${draft.approved}, release-qualified ${draft.releaseQualified}, binding digest ${draft.bindingDigest}` : "pack-cohort: release pack (pinned Studio)");
}

function main(argv) {
  const [flag, dir, ...rest] = argv;
  if (!dir || dir.startsWith("--")) throw new UsageError("usage: pack-cohort.mjs --out <dir> [--draft [--preview-bindings <file>]] | --check <dir> [--expected-sha <sha>]");
  const draftArgs = rest.length === 1 && rest[0] === "--draft" ? {} : rest.length === 3 && rest[0] === "--draft" && rest[1] === "--preview-bindings" && rest[2] && !rest[2].startsWith("--") ? { bindingsPath: rest[2] } : null;
  if (flag === "--out" && (rest.length === 0 || draftArgs)) {
    const result = packCohort(dir, rest.length ? { draft: true, ...draftArgs } : {});
    report(result, canonical(resolve(dir)), "packed");
    return 0;
  }
  if (flag === "--check" && (rest.length === 0 || (rest.length === 2 && rest[0] === "--expected-sha"))) {
    const expectedSha = rest[1];
    if (expectedSha !== undefined && !COMMIT.test(expectedSha)) throw new UsageError("--expected-sha must be a full 40-character lowercase sha");
    report(checkCohort(resolve(dir), { expectedSha }), resolve(dir), "verified");
    return 0;
  }
  throw new UsageError("usage: pack-cohort.mjs --out <dir> [--draft [--preview-bindings <file>]] | --check <dir> [--expected-sha <sha>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`pack-cohort: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
