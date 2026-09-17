// artifact-reproducibility — prove that a candidate tarball is one a CLEAN
// build of this checkout actually produces, rather than one that happens to
// be sitting on disk.
//
// WHY THIS EXISTS (issue #893)
// ----------------------------
// `dist/` is gitignored, so every content join this repository computes from
// the git tree -- `packageTreeSha1` above all -- is structurally blind to it.
// And `dist/` is exactly what dominates a tarball: `dist` is the first entry
// in almost every package's `files` array. A qualification record can
// therefore report PRESENT, join cleanly against the tree, pass every
// pull-request check, and still bind tarball bytes that no clean build of
// the recorded commit reproduces. Because records are immutable, that
// version is then permanently unpublishable -- validate-candidate-publish
// correctly refuses it at the last possible moment, which is far too late.
// Two versions were burned this way and had to be skipped rather than fixed.
//
// The mechanism is not exotic and needs no mistake to trigger:
//
//   * `tsc` NEVER deletes an output whose source has gone away. Delete or
//     rename `src/foo.ts`, rebuild, and `dist/foo.js`, `dist/foo.d.ts` and
//     both `.map` files stay behind forever. They pack. Measured on
//     packages/writer: a stale tree packs to a different tarball than the
//     clean tree does, deterministically, with a completely clean
//     `git status`.
//   * An artifact carried across a rebase has the same shape from the other
//     direction: the bytes are a clean build of a DIFFERENT commit.
//
// WHAT THIS MODULE DOES
// ---------------------
// It answers one question and refuses to answer any other: does packing this
// checkout, after removing every build output directory first, produce
// exactly the bytes in hand? That is the only question the record's
// immutability actually depends on.
//
// Removing EVERY packages/*/dist, not just the candidate's, is deliberate.
// It is what a fresh CI runner has, which is the state the qualify job packs
// from; and TypeScript declaration emit reads its siblings' .d.ts, so a
// stale sibling can move a candidate's own declaration bytes. The root
// `build` script recompiles every workspace anyway (no tsbuildinfo anywhere
// here -- `tsc -p tsconfig.json`, not `tsc --build`), so clearing all of
// them costs the deletes and nothing else.
//
// This is destructive by design: it leaves the checkout with freshly rebuilt
// dist/ directories. If the build fails it leaves them missing, and says so,
// rather than silently restoring a tree whose staleness is the thing under
// test.
//
// EXIT DISCIPLINE (the repository convention, preserved through to callers)
// ------------------------------------------------------------------------
//   satisfied     -- the tarball is reproducible.
//   Mismatch      -- a real, measured disagreement. This is a FAILURE (1).
//   Indeterminate -- the build or the pack could not be run at all, or the
//                    runtime is not the pinned release runtime. Nothing was
//                    concluded (2). Never a pass.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { assertReleaseRuntime } from "./release-runtime.mjs";

/** A measured disagreement between the tarball in hand and a clean build. */
export class ReproducibilityMismatch extends Error {}
/** The question could not be asked. Never a pass. */
export class ReproducibilityIndeterminate extends Error {}

const PACKAGE_DIR_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALGORITHMS = ["sha1", "sha256", "sha512"];

function defaultRun(file, args, options) {
  return spawnSync(file, args, { stdio: "pipe", encoding: "utf8", ...options });
}

function digest(bytes) {
  return Object.fromEntries(ALGORITHMS.map((algorithm) => [algorithm, createHash(algorithm).update(bytes).digest("hex")]));
}

/**
 * Every packages/<name>/dist under `root` that is a real directory beside a
 * real manifest. Nothing outside packages/ is ever considered, and a name
 * that is not a plain lowercase package directory name is skipped rather
 * than interpreted.
 */
export function buildOutputDirectories(root) {
  const packagesRoot = join(root, "packages");
  if (!existsSync(packagesRoot)) return [];
  const found = [];
  for (const name of readdirSync(packagesRoot).sort()) {
    if (!PACKAGE_DIR_NAME.test(name)) continue;
    if (!existsSync(join(packagesRoot, name, "package.json"))) continue;
    const dist = join(packagesRoot, name, "dist");
    let stat;
    try { stat = statSync(dist); } catch { continue; }
    if (stat.isDirectory()) found.push(dist);
  }
  return found;
}

function resolvePackageDirectory(root, packageDir) {
  const absolute = resolve(root, packageDir);
  if (relative(root, absolute).startsWith("..") || !existsSync(join(absolute, "package.json"))) {
    throw new ReproducibilityIndeterminate(`no package manifest at ${packageDir} inside this checkout.`);
  }
  return absolute;
}

/** Pack the package exactly as the qualify job does, without touching dist/. */
export function packAsIs({ root, packageDir, run = defaultRun, destination }) {
  const absolute = resolvePackageDirectory(root, packageDir);
  const out = destination ?? mkdtempSync(join(tmpdir(), "artifact-reproducibility-"));
  const packed = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", out], { cwd: absolute });
  if (packed?.error || packed?.signal || packed?.status !== 0) {
    throw new ReproducibilityIndeterminate(`npm pack failed in ${packageDir}: ${String(packed?.stderr ?? packed?.error?.message ?? "unknown error").trim().slice(0, 600)}`);
  }
  let filename;
  try { filename = JSON.parse(String(packed.stdout))[0].filename; }
  catch { throw new ReproducibilityIndeterminate("npm pack --json did not report a packed filename."); }
  const path = join(out, filename);
  let bytes;
  try { bytes = readFileSync(path); } catch { throw new ReproducibilityIndeterminate(`npm pack reported ${filename} but it could not be read.`); }
  return { path, ...digest(bytes) };
}

/**
 * Remove every build output directory, rebuild the workspace, and pack the
 * candidate. The returned digests are, by construction, the digests a fresh
 * checkout of this commit produces.
 */
export function cleanRebuildAndPack({ root, packageDir, run = defaultRun, destination, buildArgs = ["run", "build"] }) {
  const absolute = resolvePackageDirectory(root, packageDir);
  for (const dist of buildOutputDirectories(root)) rmSync(dist, { recursive: true, force: true });
  const built = run("npm", buildArgs, { cwd: root });
  if (built?.error || built?.signal || built?.status !== 0) {
    throw new ReproducibilityIndeterminate(
      "the clean rebuild failed, so no reproducible tarball could be produced. Every packages/*/dist was removed first and has NOT been restored; " +
        `fix the build and run this again. npm said: ${String(built?.stderr ?? built?.error?.message ?? "unknown error").trim().slice(0, 600)}`,
    );
  }
  return packAsIs({ root, packageDir: absolute, run, destination });
}

/**
 * Refuse unless `expected` is exactly what a clean build of this checkout
 * packs.
 *
 * `requireReleaseRuntime` defaults to true and must stay true wherever
 * `expected` came from somewhere else -- a CI artifact, say. Gzip bytes are a
 * function of the zlib build that produced them, so comparing a tarball
 * packed on the pinned release runtime against one packed on some other
 * runtime measures the runtime, not the artifact. That comparison is
 * INDETERMINATE, and this module says so rather than reporting a mismatch it
 * cannot attribute.
 */
export function assertTarballReproducible({ root, packageDir, expected, run = defaultRun, destination, requireReleaseRuntime = true, buildArgs }) {
  for (const algorithm of ALGORITHMS) {
    if (typeof expected?.[algorithm] !== "string" || expected[algorithm].length === 0) {
      throw new ReproducibilityIndeterminate(`expected tarball digests are incomplete (missing ${algorithm}).`);
    }
  }
  if (requireReleaseRuntime) {
    try { assertReleaseRuntime(); }
    catch (error) {
      throw new ReproducibilityIndeterminate(
        `${error instanceof Error ? error.message : "release runtime could not be read"}. A tarball's gzip bytes are a function of the runtime that packed them, ` +
          "so reproducing a candidate packed on the pinned release runtime can only be attempted on that same runtime.",
      );
    }
  }
  const reproduced = cleanRebuildAndPack({ root, packageDir, run, destination, buildArgs });
  const differing = ALGORITHMS.filter((algorithm) => reproduced[algorithm] !== expected[algorithm]);
  if (differing.length > 0) {
    throw new ReproducibilityMismatch(
      `the candidate tarball is NOT what a clean build of this checkout produces (${differing.join(", ")} differ). ` +
        `A clean rebuild packs sha256 ${reproduced.sha256}; the tarball in hand is sha256 ${expected.sha256}. ` +
        "dist/ is gitignored, so no tree digest can see this. The usual causes are a dist/ left over from a source file that has since been deleted or renamed " +
        "(tsc never removes an orphaned output), or an artifact carried across a rebase, which is a clean build of a different commit. " +
        "Re-run the qualify job at this exact commit and use the artifact it produces.",
    );
  }
  return reproduced;
}
