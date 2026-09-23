// Regression gate for issue #1250: a test that creates a temp fixture
// directory must remove it again, even on failure. Rather than re-deriving
// that property by reading every converted suite's source (a review step,
// not a gate), this runs a representative set of them for real, in a child
// process whose TMPDIR points at a fresh, otherwise-empty directory, and
// then looks at what that child process actually left behind.
//
// "Representative" here means: several different converted files, each
// using scripts/lib/tmp-fixture.mjs's makeTmpDirSync (the fix this gate
// protects), each with a different fixture shape (a throwaway git repo, a
// package-manifest tree, a route/skill-file tree) — not an exhaustive re-run
// of every scripts/**/*.test.mjs file, which would duplicate the rest of
// check:gates for no extra signal about leaking. A regression in the SHARED
// helper (the thing every converted file actually depends on) shows up here
// regardless of which of the five files exercises it; a regression isolated
// to one specific file's own call site is caught by that file's own
// presence in this list, not by exhaustiveness.
//
// Known fixture-directory prefixes, from issue #1250's own leak inventory
// and this repository's fix for it (kept here as a named, greppable record
// -- the actual assertion below is stricter: it requires the fresh TMPDIR to
// come back COMPLETELY empty, since nothing other than these five suites'
// own fixtures should ever be written into a TMPDIR this test controls):
//   artifact-reproducibility-*, touches-packages-*, observer-check-*,
//   materialise-pack-{checkout,tar,store,source,artifacts}-*,
//   bin-reachability-repo-*, controller-check-*, builder-check-*,
//   locksmith-check-*, locksmith-provider-custody-*, *-rate-check-*,
//   push-tree-identical-*, advisor-cli-*, publication-history-*,
//   malformed-later-publication-*, install-docs-*, pkg-skill-*,
//   publisher-web-routes-*
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

// Fast, dependency-free, no `npm run build` required -- every one of these
// already passes under `check:gates` on its own. Each uses a different
// fixture shape, so a helper regression that only breaks one shape (for
// example, an async cleanup path versus a sync one) is still caught.
const REPRESENTATIVE_SUITES = [
  "scripts/check-touches-packages.test.mjs",
  "scripts/push-tree-identical.test.mjs",
  "scripts/check-install-docs.test.mjs",
  "scripts/check-package-skills.test.mjs",
  "scripts/check-publisher-web-routes.test.mjs",
];

test("converted fixture suites leave no directory behind in a fresh TMPDIR", (t) => {
  const childTmpDir = makeTmpDirSync(t, "tmp-fixture-leak-gate-");

  const before = readdirSync(childTmpDir);
  assert.deepEqual(before, [], "the child's TMPDIR must start empty, or a leftover entry could be mistaken for one this run created");

  // node:test refuses to run nested `node --test` files when it can tell
  // it is itself already inside a test run (NODE_TEST_CONTEXT /
  // NODE_TEST_WORKER_ID, set on `process.env` for the duration of a
  // `node --test` invocation and inherited by any child process by
  // default) -- exactly the situation `check:gates` puts this gate in,
  // since check:gates is itself one `node --test` call over every gate
  // suite including this one. Left in place, the child silently prints
  // "skipping running files" and exits 0 having run nothing, which would
  // make this gate pass whether or not the suites below leak. Stripping
  // both keeps the child's own node:test run independent of the parent's.
  const childEnv = { ...process.env, TMPDIR: childTmpDir, TMP: childTmpDir, TEMP: childTmpDir };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;

  let output;
  try {
    output = execFileSync(
      process.execPath,
      ["--test", ...REPRESENTATIVE_SUITES],
      {
        cwd: repoRoot,
        env: childEnv,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
  } catch (error) {
    // node --test exits non-zero on any subtest failure. A failure inside
    // one of these suites is itself already covered by check:gates running
    // them directly; surface the child's own output here rather than
    // masking it as "assertion below found leftover directories", which
    // would misreport a functional failure as a leak.
    assert.fail(`representative suites failed under an isolated TMPDIR:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
  assert.match(output, /\bpass \d+/, "expected node --test's own summary in the child's output");

  const leftover = readdirSync(childTmpDir);
  assert.deepEqual(
    leftover,
    [],
    `${leftover.length} director${leftover.length === 1 ? "y" : "ies"} leaked into TMPDIR by the representative suites: ${leftover.join(", ")}`,
  );
});
