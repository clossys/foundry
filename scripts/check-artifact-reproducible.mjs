#!/usr/bin/env node
// check-artifact-reproducible — is this package's dist/ stale, and does a
// candidate tarball reproduce from a clean build of this checkout?
//
//   node scripts/check-artifact-reproducible.mjs <packageDir> [--tarball <candidate.tgz>]
//
// Exit 0 = reproducible. Exit 1 = a measured mismatch. Exit 2 = the question
// could not be asked (indeterminate, never a pass).
//
// TWO MODES, AND THE DIFFERENCE MATTERS
// -------------------------------------
//   without --tarball : packs the package AS IT SITS, then removes every
//                       packages/*/dist, rebuilds, and packs again. This
//                       answers "is my working tree's dist/ stale?" and is
//                       the developer-machine question. Both tarballs are
//                       packed here, in this run, so the comparison is
//                       runtime-independent and the pinned release runtime is
//                       NOT required.
//   with --tarball    : compares a tarball produced ELSEWHERE — the qualify
//                       job's `candidate.tgz` — against a clean build here.
//                       This is the question a qualification record's
//                       immutability rests on, and it DOES require the pinned
//                       release runtime: gzip bytes are a function of the
//                       zlib that produced them, so off-runtime the
//                       comparison measures the runtime rather than the
//                       artifact and is reported as indeterminate.
//
// generate-qualification-record.mjs runs the second mode itself, before it
// writes anything, so a record cannot be bound to an unreproducible tarball
// even by someone who never runs this command (issue #893). This CLI exists
// for the case before that one: asking the question while it is still free.
//
// DESTRUCTIVE, DELIBERATELY. Both modes remove every packages/*/dist and
// rebuild. A failed build leaves them missing and says so.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReproducibilityIndeterminate,
  ReproducibilityMismatch,
  assertTarballReproducible,
  cleanRebuildAndPack,
  packAsIs,
} from "./lib/artifact-reproducibility.mjs";

const USAGE = "usage: check-artifact-reproducible.mjs <packageDir> [--tarball <candidate.tgz>]";
const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const argv = process.argv.slice(2);
const packageDir = argv.filter((value) => !value.startsWith("--"))[0];
const tarballIndex = argv.indexOf("--tarball");
const tarballPath = tarballIndex >= 0 ? argv[tarballIndex + 1] : undefined;

if (!packageDir || (tarballIndex >= 0 && (!tarballPath || tarballPath.startsWith("--")))) {
  console.error(USAGE);
  process.exit(2);
}

function fail(code, message) {
  console.error(`${code === 1 ? "NOT REPRODUCIBLE" : "INDETERMINATE"} — ${message}`);
  process.exit(code);
}

try {
  if (tarballPath) {
    const absolute = resolve(tarballPath);
    if (!existsSync(absolute)) fail(2, `candidate tarball could not be read: ${tarballPath}`);
    const bytes = readFileSync(absolute);
    const expected = Object.fromEntries(["sha1", "sha256", "sha512"].map((algorithm) => [algorithm, createHash(algorithm).update(bytes).digest("hex")]));
    const reproduced = assertTarballReproducible({ root, packageDir, expected });
    console.log(`REPRODUCIBLE — ${packageDir} packs to sha256 ${reproduced.sha256} from a clean build, matching ${tarballPath}.`);
  } else {
    const asIs = packAsIs({ root, packageDir });
    const clean = cleanRebuildAndPack({ root, packageDir });
    if (asIs.sha256 !== clean.sha256) {
      fail(
        1,
        `${packageDir}/dist was STALE. As it sat, the package packed to sha256 ${asIs.sha256}; after removing every packages/*/dist and rebuilding it packs to ` +
          `sha256 ${clean.sha256}. dist/ is gitignored, so git status cannot show this. The tree has now been rebuilt clean; re-pack and re-qualify from here.`,
      );
    }
    console.log(`REPRODUCIBLE — ${packageDir} packs to sha256 ${clean.sha256} both as it sat and after a clean rebuild.`);
  }
} catch (error) {
  if (error instanceof ReproducibilityMismatch) fail(1, error.message);
  if (error instanceof ReproducibilityIndeterminate) fail(2, error.message);
  fail(2, error instanceof Error ? error.message : "unknown error");
}
