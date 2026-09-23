// Shared temp-directory fixture helper for scripts/**/*.test.mjs.
//
// Every test that needs a real, on-disk scratch directory must remove it
// again, even when the test throws — a directory a failed test leaves
// behind is exactly as much of a leak as one a passing test forgets to
// remove. node:test's own `t.after()` hook runs on both outcomes, so the
// fix is always the same three lines: make the dir, register its removal,
// hand back the path. This module makes that one call instead of three,
// so a new test can't add a fourth mkdtemp call without also adding its
// cleanup.
//
// See issue #1250: 5,593 leftover fixture directories, across a dozen
// mkdtemp call sites that never called their matching rm.
import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// maxRetries/retryDelay absorb the same transient EBUSY/ENOTEMPTY a fresh
// git checkout or an in-flight child process can cause on a recursive
// remove — see scripts/lib/artifact-reproducibility.test.mjs's own
// pre-existing use of the same options.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

/**
 * Create a fresh temp directory under os.tmpdir() and register its removal
 * on the given node:test context, synchronously.
 *
 * @param {{ after: (fn: () => void) => void }} t - a node:test TestContext
 *   (or suite context) — whatever `t` a `test("...", (t) => {})` callback
 *   receives.
 * @param {string} prefix - the mkdtemp prefix, e.g. "touches-packages-".
 *   Keep it a stable, greppable string: it is how a leftover directory is
 *   traced back to the test that created it, and it is how the leak gate
 *   (scripts/check-tmp-fixture-leaks.test.mjs) recognizes a known fixture.
 * @returns {string} the created directory's absolute path.
 */
export function makeTmpDirSync(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, RM_OPTIONS));
  return dir;
}

/**
 * Async equivalent of makeTmpDirSync, for tests already using the
 * node:fs/promises API.
 *
 * @param {{ after: (fn: () => Promise<void> | void) => void }} t
 * @param {string} prefix
 * @returns {Promise<string>}
 */
export async function makeTmpDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, RM_OPTIONS));
  return dir;
}

export { RM_OPTIONS as TMP_FIXTURE_RM_OPTIONS };
