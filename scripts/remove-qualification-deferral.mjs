#!/usr/bin/env node
// remove-qualification-deferral — issue #948, migrated to one file per
// package@version by issue #1254.
//
// scripts/check-qualification-record-required.mjs's own `stale-deferral`
// rule already says what must happen once a retained, matching
// qualification record exists for a package@version that
// governance/release-qualification-deferrals/ still names: the entry is
// stale, and the gate fails until it is removed (see that script's own
// STALE DEFERRALS section). This script performs that removal mechanically,
// so .github/workflows/qualify-candidate.yml can do it in the SAME change
// that retains the record, rather than leaving a stale entry that would
// fail the gate on this repository's very next unrelated pull request —
// check-qualification-record-required.mjs only re-checks the files it finds
// on disk; nothing about it ever edits them.
//
// Usage:
//   node scripts/remove-qualification-deferral.mjs --package <package-dir> --version <version>
//
// Exit codes (this repository's convention):
//   0  the one matching entry file was removed, or there was none to
//      remove — a package qualified with no prior deferral is not an
//      error, so a caller can always run this unconditionally after
//      retaining a record.
//   1  more than one file in the store resolves to this exact
//      package@version (by their own `package`/`version` contents, not
//      only by filename). check-qualification-record-required.mjs's own
//      `duplicate-deferral` rule should already have caught this on the
//      tree as committed; refuse rather than guess which one to drop.
//   2  indeterminate — the store directory is missing, unreadable, or the
//      one file this run needed is not the shape
//      check-qualification-record-required.mjs itself requires.
//
// ONE FILE PER package@version, NOT A SHARED ARRAY (issue #1254)
// ------------------------------------------------------------------
// governance/release-qualification-deferrals.json used to be a single JSON
// array every deferral — for every package, every version — appended to and
// removed from. Two qualify-candidate.yml runs for different packages could
// race on rewriting that one file (see that workflow's own concurrency
// comment), and two unrelated pull requests adding deferrals for different
// packages collided on the same lines. Each deferral now lives in its own
// file, governance/release-qualification-deferrals/<package>@<version>.json,
// so removing one is a file deletion, not a read-modify-write of shared
// state, and no other in-flight deferral is ever touched by this script.
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFERRALS_DIR = "governance/release-qualification-deferrals";
const USAGE = "Usage: --package <package-dir> --version <version>";
const FLAGS = ["package", "version"];

class UsageError extends Error {}
class IndeterminateError extends Error {}

function argsFrom(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index]?.startsWith("--") ? argv[index].slice(2) : undefined;
    const value = argv[index + 1];
    if (!flag || !FLAGS.includes(flag) || value === undefined || args[flag] !== undefined) throw new UsageError(USAGE);
    args[flag] = value;
  }
  if (!args.package || !args.version) throw new UsageError(USAGE);
  return args;
}

function deferralFileName(packageKey, version) {
  return `${packageKey}@${version}.json`;
}

/**
 * Every file in the store whose OWN `package`/`version` fields (not merely
 * its filename) name `packageKey`@`version`. Scanning by content rather than
 * trusting the filename alone preserves the old script's "refuse to guess
 * between duplicates" discipline even against a mis-named file — the same
 * defensive posture check-qualification-record-required.mjs's own
 * `deferral-file-name-mismatch` finding polices from the read side.
 *
 * A file that fails to parse as the required {package, version, reason,
 * issue} shape is itself reported as indeterminate ONLY when it is the file
 * this run actually needed (the canonically named one, or the one — if
 * any — a content-level match already found); an unrelated broken file
 * elsewhere in the store is not this script's business and does not block
 * removal of the one this run asked for.
 */
function matchingFiles(root, packageKey, version) {
  const dirPath = resolve(root, DEFERRALS_DIR);
  if (!existsSync(dirPath)) throw new IndeterminateError(`${DEFERRALS_DIR} does not exist.`);

  let fileNames;
  try {
    fileNames = readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .sort();
  } catch (error) {
    throw new IndeterminateError(`${DEFERRALS_DIR} could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const canonicalName = deferralFileName(packageKey, version);
  const matches = [];
  for (const fileName of fileNames) {
    const relPath = `${DEFERRALS_DIR}/${fileName}`;
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dirPath, fileName), "utf8"));
    } catch (error) {
      if (fileName === canonicalName) throw new IndeterminateError(`${relPath} is not valid JSON: ${error instanceof Error ? error.message : "parse error"}`);
      continue; // an unrelated broken file elsewhere in the store is not this run's problem.
    }
    if (typeof doc !== "object" || doc === null || typeof doc.package !== "string" || typeof doc.version !== "string" || typeof doc.issue !== "number") {
      if (fileName === canonicalName) throw new IndeterminateError(`${relPath} must be an object with string \`package\`, string \`version\`, and integer \`issue\`.`);
      continue;
    }
    if (doc.package === packageKey && doc.version === version) matches.push({ relPath, issue: doc.issue });
  }
  return matches;
}

/**
 * Remove the one deferral file naming `package`@`version`, if any.
 *
 * Returns `{ removed, path, issue }` without writing anything — `main()`
 * below is the only thing that touches disk, so this stays a pure function
 * a test can call directly against a fixture root.
 */
export function removeDeferral({ root = process.cwd(), package: packageKey, version }) {
  const matches = matchingFiles(root, packageKey, version);
  if (matches.length > 1) {
    throw new Error(
      `${DEFERRALS_DIR} names ${matches.length} deferral files for ${packageKey}@${version} (${matches.map((m) => m.relPath).join(", ")}); refusing to guess which one to remove. ` +
        "Fix the duplicate (check-qualification-record-required.mjs's own duplicate-deferral rule) first.",
    );
  }
  if (matches.length === 0) {
    return { removed: false, path: `${DEFERRALS_DIR}/${deferralFileName(packageKey, version)}`, issue: null };
  }
  return { removed: true, path: matches[0].relPath, issue: matches[0].issue };
}

function main() {
  let args;
  try {
    args = argsFrom(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let result;
  try {
    result = removeDeferral(args);
  } catch (error) {
    if (error instanceof IndeterminateError) {
      console.error(`INDETERMINATE — ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  }

  if (!result.removed) {
    console.log(`NO DEFERRAL TO REMOVE — no file in ${DEFERRALS_DIR} names ${args.package}@${args.version}.`);
    process.exit(0);
  }

  unlinkSync(resolve(process.cwd(), result.path));
  console.log(`DEFERRAL REMOVED — ${args.package}@${args.version} (issue #${result.issue}) removed from ${result.path}.`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
export { argsFrom, UsageError, IndeterminateError, DEFERRALS_DIR, deferralFileName };
