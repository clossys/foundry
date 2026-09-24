// The discovered set of `check:gates` node:test suites.
//
// Issue #907 (see also PR #1151) is "derive a hand-listed set from the
// tree, never hand-maintain a literal array that silently drifts stale."
// `check:gates` in package.json used to BE that literal array: one root
// script listing ~65 `scripts/*.test.mjs` paths on a single line, so every
// pull request that added a gate test conflicted with every other open one
// touching that same line -- the single most common merge-train conflict
// (see issue #1187's merge-train comments). This module is the fix: the set
// `check:gates` actually runs is now COMPUTED from the tree by
// `discoverGateTestFiles`, and `package.json`'s `check:gates` entry only
// names this module's own runner (`scripts/run-gate-suites.mjs`), never an
// individual suite.
//
// A file this module discovers is picked up automatically the next time
// `npm run check:gates` runs -- no package.json edit, no merge conflict.
// A file that must NOT run here (needs a build, needs the network, or is
// already covered by covered by its own dedicated `check:*` script) is
// listed in `GATE_TEST_EXCLUSIONS` below, by name, with a reason. An
// undocumented gap is exactly the class of defect issue #414 and #468 both
// describe -- a `check:*` gate, or a suite, that exists in the tree and
// runs nowhere -- so every exclusion here must be a reason, not a silence.
//
// `scripts/check-workflow-references.test.mjs`'s "every suite in check:gates
// imports only node builtins and local scripts" test calls
// `discoverGateTestFiles()` directly (not package.json) for exactly this
// reason: a newly added `scripts/*.test.mjs` file that imports a workspace
// package is swept in by this module automatically and then FAILS that
// test, forcing a contributor to either fix the import or add it here with
// a reason -- the same "picked up automatically, or refused with a reason"
// contract this module's own test proves with a synthetic fixture tree.
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // scripts/lib
export const REPO_ROOT = resolve(here, "..", "..");

// Directories, relative to the scan root, walked for `*.test.mjs` files.
// `.github/scripts` carries exactly one check:gates suite today
// (collect-credential-evidence.test.mjs) alongside assemble-verify-inputs's,
// which is excluded below -- see that entry's reason.
export const GATE_TEST_SCAN_ROOTS = ["scripts", ".github/scripts"];

/**
 * Suites this discovery would otherwise pick up, deliberately excluded, each
 * with the reason. Every key must be a real file (a test below guards
 * against a stale entry for a file that moved or was deleted) and every
 * reason must actually explain why -- "needs a build" or "already covered
 * by its own check:* script" are real reasons; "not ready" is not.
 */
export const GATE_TEST_EXCLUSIONS = Object.freeze({
  "scripts/lib/candidate-runner-acceptance.test.mjs":
    "runs the real, built candidate-runner framework end to end -- needs `npm run build` first. Its own check:candidate-runner-acceptance script runs it in ci.yml's build job, after install and build (see scripts/check-workflow-references.test.mjs's dedicated test for this exact ordering).",
  "scripts/observation-bundle.test.mjs":
    "round-trips through the real, built @clossys/builder writer/parser -- needs `npm run build` first. Wired as its own `node --test` step in ci.yml's build job, after build (see the file's own header).",
  "scripts/gate-run-history.test.mjs":
    "imports the real, built @clossys/observer package by bare specifier -- needs `npm run build` first. Wired as its own `node --test` step in ci.yml's build job, after build.",
  "scripts/check-fleet-coverage.test.mjs":
    "imports the real, built @clossys/observer package by bare specifier, same as gate-run-history.test.mjs above -- needs `npm run build` first (see the file's own header: 'it is not part of check:gates, which runs in the dependency-free safety job before any workspace build exists'). Wired as its own `node --test` step in ci.yml's build job.",
  "scripts/check-publication-map.test.mjs":
    "imports packages/publisher's own built entry point -- needs `npm run build` first. Wired as its own `node --test` step in ci.yml's build job, after build.",
  "scripts/collect-review-evidence.integration.test.mjs":
    "hands its fixtures to the REAL, compiled @clossys/controller and @clossys/inspector validators -- needs `npm run build` first (see the file's own header). scripts/collect-review-evidence.test.mjs, the pure-normalization half of the same suite, stays in check:gates; this integration half is wired as its own `node --test` step in ci.yml's build job.",
  ".github/scripts/assemble-verify-inputs.test.mjs":
    "already covered by its own check:verify-inputs script (`node --test .github/scripts/assemble-verify-inputs.test.mjs`), which per package.json's `//check-verify-inputs` comment runs after the built inspector bin is available -- the opposite precondition from check:gates' pre-build, dependency-free safety job. Running it again here would run it twice with no added coverage.",
  "scripts/check-public-npm-provenance.test.mjs":
    "already run transitively -- scripts/publish-workflow.test.mjs, which check:gates does run, imports this file directly (`import \"./check-public-npm-provenance.test.mjs\"`). Listing it again here would run its tests a second time.",
  "scripts/lib/public-npm-aggregate-canary.test.mjs":
    "already covered by its own check:public-npm-aggregate-canary script, which chains the canary/closure/transcript checks before this test (`node scripts/check-public-npm-aggregate-canary.mjs && ... && node --test scripts/lib/public-npm-aggregate-canary.test.mjs`). Running it again here would run it a second time, in isolation from that chain.",
  "scripts/lib/public-npm-aggregate-canary-v2.test.mjs":
    "already covered by its own check:public-npm-aggregate-canary-v2 script, same reason as the v1 canary test above.",
});

function walk(dir, scanRoot, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a scan root that does not exist (e.g. a synthetic fixture missing one side) contributes nothing
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // no dotfiles/dot-directories below a scan root
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, scanRoot, out);
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      out.push(relative(scanRoot, full).split(sep).join("/"));
    }
  }
}

/**
 * Every `*.test.mjs` file under the scan roots, root-relative, unfiltered --
 * BEFORE `GATE_TEST_EXCLUSIONS` is applied. Exists so a test can assert every
 * exclusion entry still names a real file (see gate-test-set.test.mjs).
 */
export function allGateTestFiles({ root = REPO_ROOT, scanRoots = GATE_TEST_SCAN_ROOTS } = {}) {
  const found = [];
  for (const scanRoot of scanRoots) {
    walk(join(root, scanRoot), root, found);
  }
  return [...new Set(found)].sort();
}

/**
 * The suites `check:gates` actually runs: every `*.test.mjs` file under the
 * scan roots, minus the documented exclusions.
 */
export function discoverGateTestFiles({ root = REPO_ROOT, scanRoots = GATE_TEST_SCAN_ROOTS, exclusions = GATE_TEST_EXCLUSIONS } = {}) {
  return allGateTestFiles({ root, scanRoots }).filter((file) => !(file in exclusions));
}

// Re-exported for callers (scripts/run-gate-suites.mjs) that want to fail
// fast on a directory that isn't there, rather than silently discover zero
// files from a typo'd scan root.
export function scanRootExists(root, scanRoot) {
  try {
    return statSync(join(root, scanRoot)).isDirectory();
  } catch {
    return false;
  }
}

// CI throughput (Refs: #1324): `check:gates`'s second half (this module's
// own `discoverGateTestFiles()`, run by scripts/run-gate-suites.mjs under
// one `node --test` invocation) measured 26m37s on a 4-vCPU GitHub-hosted
// runner (run 35957368169, job 107498450966, over the 98 suites discovered
// at that commit -- see ci.yml's own "gate regression tests" step comment
// for the full breakdown) and is the long pole of every `publish safety`
// run. The suite count itself is not pinned anywhere in this comment on
// purpose: `discoverGateTestFiles()` is the only thing that ever needs to
// know it, and it grows over time (99 by the time this sentence was last
// touched).
// `partitionFilesForShard` is the split: a pure, order-preserving
// round-robin over the SAME sorted list `discoverGateTestFiles()` already
// returns, so a file's shard assignment depends only on its position in
// that list, never on a wall-clock race or directory-listing order.
//
// Round-robin (`index % shardCount === shardIndex`), not a contiguous slice
// (`files[0..24]`, `files[25..49]`, ...): the discovered list is
// alphabetical, and several of the slowest suites here share an
// alphabetical neighbourhood (`scripts/publish-qualified-directory.
// test.mjs`, `scripts/publish-qualified-set.test.mjs`, `scripts/rehearse-
// publish-lifecycle.test.mjs`, `scripts/run-candidate-qualification.
// test.mjs` all sit within a few entries of each other). A contiguous slice
// would risk stacking most of that weight onto one shard; round-robin
// spreads consecutive files across DIFFERENT shards instead -- the same
// partition rule scripts/lib/candidate-qualification-shard.mjs already uses
// for sharding qualification records (see that module's own header), kept
// identical here rather than inventing a second shard convention.
//
// `shardIndex` is 0-based (0 <= shardIndex < shardCount), matching that
// same existing convention -- and, unlike it, this module's partition is
// pure and synchronous, so a test can assert completeness (every file
// assigned to exactly one shard, no shard empty) directly against the real
// discovered list without spawning any child process at all -- see
// gate-test-set.test.mjs's completeness-proof tests.
export function partitionFilesForShard(files, shardIndex, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new RangeError(`shardCount must be a positive integer, got ${shardCount}`);
  }
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new RangeError(`shardIndex must be an integer in [0, ${shardCount - 1}], got ${shardIndex}`);
  }
  return files.filter((_, i) => i % shardCount === shardIndex);
}

// argv parsing for scripts/run-gate-suites.mjs's `--shard-index`/
// `--shard-count` flags -- deliberately the same shape as
// scripts/lib/candidate-qualification-shard.mjs's `resolveShardArgs` (same
// flag names, same "both or neither" rule, same 0-based range check), kept
// as its own pure function for the same reason that module gives: testable
// without executing anything else, and importable from a test without
// running the real (multi-minute) suite. Not re-exported from that module
// instead, despite the near-identical shape, because these two shard spaces
// are unrelated (one partitions qualification records, this one partitions
// test files) and must be free to diverge without one's change silently
// affecting the other's contract.
// Only a bare decimal-digit string is a valid shard-index/shard-count value
// -- `Number(raw)` alone is too permissive for a value that ends up gating
// which tests actually run: `Number("")` is 0, `Number(" 1 ")` is 1,
// `Number("0x1")` is 1, `Number("1e1")` is 10, and `Number("+1")`/
// `Number("1.0")` both parse too. Every one of those is a plausible-looking
// mistake (an empty CI expression, a copy-pasted hex literal, stray
// whitespace) that `Number()` would silently accept and then hand to
// `partitionFilesForShard` as if it were a clean integer. Anchored
// `^\d+$` -- no sign, no decimal point, no exponent, no leading/trailing
// whitespace -- rejects all of those up front, before `Number()` ever sees
// the string.
const DECIMAL_INTEGER = /^\d+$/;

export function resolveGateShardArgs(argv) {
  const shardIndexIdx = argv.indexOf("--shard-index");
  const shardCountIdx = argv.indexOf("--shard-count");
  if (shardIndexIdx === -1 && shardCountIdx === -1) return { shard: null };
  if (shardIndexIdx === -1 || shardCountIdx === -1) {
    return { error: "--shard-index and --shard-count must both be given, or neither" };
  }
  const shardIndexRaw = argv[shardIndexIdx + 1];
  const shardCountRaw = argv[shardCountIdx + 1];
  if (typeof shardIndexRaw !== "string" || !DECIMAL_INTEGER.test(shardIndexRaw) || typeof shardCountRaw !== "string" || !DECIMAL_INTEGER.test(shardCountRaw)) {
    return {
      error: `--shard-index/--shard-count must each be a bare decimal integer matching ${DECIMAL_INTEGER} (no sign, decimal point, exponent, or whitespace) -- got ${JSON.stringify(shardIndexRaw)}/${JSON.stringify(shardCountRaw)}`,
    };
  }
  const shardIndex = Number(shardIndexRaw);
  const shardCount = Number(shardCountRaw);
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
    return {
      error: `--shard-index/--shard-count must satisfy 0 <= shard-index < shard-count (got ${JSON.stringify(shardIndexRaw)}/${JSON.stringify(shardCountRaw)})`,
    };
  }
  return { shard: { shardIndex, shardCount } };
}
