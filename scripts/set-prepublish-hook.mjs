#!/usr/bin/env node
// set-prepublish-hook — keep every published package's own npm lifecycle
// wired to check-name-collision.mjs, the way set-scope.mjs and
// set-registry.mjs already keep `scope` and `publishConfig.registry` honest.
//
//   node scripts/set-prepublish-hook.mjs [--check]
//
// WHY THIS EXISTS (issue #273)
// -----------------------------
// scripts/preflight-package.mjs and .github/workflows/publish.yml both run
// check-name-collision.mjs before anything reaches the registry — but both
// are things a contributor chooses to run. `npm publish` run BY HAND from a
// package directory is neither: npm's own publish command only executes a
// package's `prepublishOnly` script for a directory-type publish (see
// lib/commands/publish.js in the npm CLI — `if (spec.type === 'directory')`),
// and every manifest here declared `"prepublishOnly": "npm run build"` and
// nothing else. A hand-run `npm publish` therefore built and published
// without the collision check ever executing — the exact bypass this gate
// closes.
//
// WHERE THIS BINDS, AND WHERE IT DOES NOT
// ----------------------------------------
// npm's own dispatcher decides whether `prepublishOnly` runs at all, and it
// decides that from the SPEC TYPE of the publish target, not from whether
// the invocation happens to be CI or a human's shell. That is what makes
// this different from a check that "only runs in CI": it is not a workflow
// convention, it is the one lifecycle hook npm itself fires on exactly the
// invocation this issue describes (`npm publish` / `npm publish .` from
// inside a package directory), on every machine, unconditionally. This
// repository's own publish workflow (.github/workflows/publish.yml) never
// triggers it at all: that workflow packs a tarball once and calls
// `npm publish "$TARBALL"` — a FILE-type publish — for which npm's own
// dispatcher does not run prepublishOnly (confirmed by reading the installed
// npm CLI's publish.js locally: scripts only run "for directory type
// publishes"). So embedding the check here closes the direct-publish path
// without duplicating — or, worse, silently double-running — the
// workflow's own explicit collision-check step.
//
// This is NOT "mechanically unavoidable" in the strongest sense, and this
// file does not claim otherwise. Two things remain outside anything a
// repository file can enforce, because they are the same thing that makes
// `prepublishOnly` itself work: a person invoking `npm publish
// --ignore-scripts`, or a person who simply deletes this hook from their own
// checkout before running `npm publish`, is not bypassing a bug, they are
// choosing not to run the check that is already sitting in the file they
// control. A commit checked into a public repository cannot bind someone's
// own edited copy of that repository. What it CAN close — and does close —
// is every accidental, ordinary invocation of `npm publish`, which is what
// the issue actually describes: a maintainer reaching for the obvious
// command, not a maintainer deliberately working around a known gate.
//
// THE TRADE-OFF THE ISSUE ITSELF NAMED
// --------------------------------------
// Embedding the check here means every directory-type `npm publish` —
// including a local dry run — now depends on network reachability and a
// `read:packages`-scoped `gh` credential. That is deliberate, and it is the
// correct default for a check whose own contract is "a check that cannot
// run must never report success": check-name-collision.mjs already fails
// closed (exit 2) when it cannot list the owner's packages, and prepublishOnly
// failing for any reason blocks `npm publish` (npm does not distinguish exit
// 1 from exit 2 — both abort the publish). A contributor without the
// credential is stopped, not waved through.
//
// --check verifies every non-private packages/*/package.json's
// scripts.prepublishOnly is exactly the expected hook; without --check this
// REWRITES every non-private manifest to match, the same shape as
// set-scope.mjs / set-registry.mjs. Exit 0 = every checked manifest already
// matches (or was just rewritten and matches). Exit 1 = at least one
// manifest is wrong. Exit 2 = this could not be verified at all (packages/
// unreadable, empty, or a manifest that will not read or parse) — distinct
// from both, per this repository's own three-state gate contract.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");
const check = process.argv.includes("--check");

// The hook always sits at packages/<name>/package.json, exactly two levels
// below the repository root that scripts/ hangs off of, so the relative
// path back to the collision checker is fixed regardless of which package
// is being rewritten or checked.
const EXPECTED_PREPUBLISH = "node ../../scripts/check-name-collision.mjs . && npm run build";

// TEMPORARY, NAMED EXCEPTION — packages/builder is owned end-to-end by a
// concurrently active branch at the time this gate was added (issue #273's
// fix could not touch a single file under packages/builder/** without
// colliding with that work). Excluding it here, rather than editing it
// anyway, is deliberate: this script would otherwise report a false
// violation the moment it merges, on a package this change was never
// allowed to touch. Follow-up: once that branch lands, remove builder from
// this set in the same PR that adds its prepublishOnly hook — do not let
// this exception outlive the branch that required it.
const TEMPORARILY_EXCLUDED = new Set(["builder"]);

let packageDirs;
try {
  packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(packagesDir, name, "package.json")))
    .filter((name) => !TEMPORARILY_EXCLUDED.has(name));
} catch (err) {
  console.error(`set-prepublish-hook: could not read packages/ (${err.code ?? err.message}) — cannot verify anything.`);
  process.exit(2);
}
if (packageDirs.length === 0) {
  console.error("set-prepublish-hook: packages/ contains zero checkable packages — nothing to verify. Refusing to report a pass that checked nothing.");
  process.exit(2);
}

const findings = [];
const rewritten = [];

for (const name of packageDirs) {
  const manifestPath = join(packagesDir, name, "package.json");
  const manifestRel = relative(repoRoot, manifestPath);
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    console.error(`set-prepublish-hook: could not read ${manifestRel}: ${err.code ?? err.message}`);
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`set-prepublish-hook: could not parse ${manifestRel}: ${err.message}`);
    process.exit(2);
  }

  // A private package is never published, so it has nothing for this hook
  // to guard — same no-op check-name-collision.mjs itself makes.
  if (manifest.private === true) continue;

  const actual = manifest.scripts?.prepublishOnly;
  if (actual === EXPECTED_PREPUBLISH) continue;

  if (check) {
    findings.push(
      `  ${manifestRel}: scripts.prepublishOnly is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(EXPECTED_PREPUBLISH)}`,
    );
    continue;
  }

  // Rewrite in place with a literal string replace (never a JSON.parse /
  // JSON.stringify round trip) so a package's existing formatting survives
  // exactly as written — same discipline set-registry.mjs uses for
  // publishConfig.registry.
  const quotedActual = JSON.stringify(actual ?? "");
  const needle = `"prepublishOnly": ${quotedActual}`;
  if (actual !== undefined && raw.includes(needle)) {
    writeFileSync(manifestPath, raw.replace(needle, `"prepublishOnly": ${JSON.stringify(EXPECTED_PREPUBLISH)}`));
    rewritten.push(manifestRel);
  } else if (actual === undefined && manifest.scripts && Object.keys(manifest.scripts).length > 0) {
    // No prepublishOnly at all yet, but other scripts exist: refuse to guess
    // at insertion formatting. This has not happened for any package under
    // packages/ today (every one already declares prepublishOnly), and a
    // silent structural rewrite of a manifest with no textual anchor to
    // replace is exactly the kind of guess set-registry.mjs's own header
    // warns against making.
    findings.push(`  ${manifestRel}: has no scripts.prepublishOnly to rewrite in place — add one by hand, matching ${JSON.stringify(EXPECTED_PREPUBLISH)}`);
  } else {
    findings.push(`  ${manifestRel}: scripts.prepublishOnly is ${JSON.stringify(actual ?? null)}, could not locate the literal text to rewrite`);
  }
}

if (check) {
  if (findings.length) {
    console.error(`set-prepublish-hook --check: ${findings.length} manifest(s) do not carry the collision-check hook:`);
    for (const f of findings) console.error(f);
    console.error(`\nrun: node scripts/set-prepublish-hook.mjs`);
    process.exit(1);
  }
  console.log(`set-prepublish-hook --check: every non-private package under packages/ (excluding ${[...TEMPORARILY_EXCLUDED].join(", ") || "none"}) runs check-name-collision.mjs on prepublishOnly.`);
  process.exit(0);
}

if (findings.length) {
  console.error(`set-prepublish-hook: ${findings.length} manifest(s) still do not match after rewriting — refusing to declare success:`);
  for (const f of findings) console.error(f);
  process.exit(1);
}

console.log(
  rewritten.length
    ? `set-prepublish-hook: rewrote ${rewritten.length} manifest(s):\n  ${rewritten.join("\n  ")}`
    : "set-prepublish-hook: already up to date; nothing to do.",
);
