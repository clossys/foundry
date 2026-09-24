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
  "scripts/check-strategist-subject.test.mjs":
    "runs the real, compiled packages/strategist/dist/cli.js against fixture docs trees -- needs `npm run build` first. Run by `npm run check:strategist-subject` itself (the test, then the gate), which ci.yml's `prose quality` job invokes after its own minimal `npm run build --workspace=packages/strategist` (moved there from the build job in issue #1420 review round 3 -- it reads prose-tier docs/PUBLISHING.md, which the build job is skipped for on the 'prose' tier).",
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
