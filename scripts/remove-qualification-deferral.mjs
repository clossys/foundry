#!/usr/bin/env node
// remove-qualification-deferral — issue #948.
//
// scripts/check-qualification-record-required.mjs's own `stale-deferral`
// rule already says what must happen once a retained, matching
// qualification record exists for a package@version that
// governance/release-qualification-deferrals.json still names: the entry is
// stale, and the gate fails until it is removed (see that script's own
// STALE DEFERRALS section). This script performs that removal mechanically,
// so .github/workflows/qualify-candidate.yml can do it in the SAME change
// that retains the record, rather than leaving a stale entry that would
// fail the gate on this repository's very next unrelated pull request —
// check-qualification-record-required.mjs only re-checks the file it finds
// on disk; nothing about it ever edits that file.
//
// Usage:
//   node scripts/remove-qualification-deferral.mjs --package <package-dir> --version <version>
//
// Exit codes (this repository's convention):
//   0  the one matching entry was removed, or there was none to remove — a
//      package qualified with no prior deferral is not an error, so a
//      caller can always run this unconditionally after retaining a record.
//   1  the file names MORE THAN ONE entry for this exact package@version.
//      check-qualification-record-required.mjs's own `duplicate-deferral`
//      rule should already have caught this on the file as committed;
//      refuse rather than guess which one to drop.
//   2  indeterminate — the file is missing, unreadable, or not the shape
//      check-qualification-record-required.mjs itself requires.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFERRALS_PATH = "governance/release-qualification-deferrals.json";
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

/**
 * Remove the one deferral entry naming `package`@`version`, if any.
 *
 * Returns `{ removed, path, doc, issue }` without writing anything — `main()`
 * below is the only thing that touches disk, so this stays a pure function
 * a test can call directly against a fixture root.
 */
export function removeDeferral({ root = process.cwd(), package: packageKey, version }) {
  const path = resolve(root, DEFERRALS_PATH);
  if (!existsSync(path)) throw new IndeterminateError(`${DEFERRALS_PATH} does not exist.`);

  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new IndeterminateError(`${DEFERRALS_PATH} is not valid JSON: ${error instanceof Error ? error.message : "parse error"}`);
  }
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.deferrals)) {
    throw new IndeterminateError(`${DEFERRALS_PATH} must be an object with a \`deferrals\` array.`);
  }

  const matches = doc.deferrals.filter((entry) => entry?.package === packageKey && entry?.version === version);
  if (matches.length > 1) {
    throw new Error(
      `${DEFERRALS_PATH} names ${matches.length} deferral entries for ${packageKey}@${version}; refusing to guess which one to remove. ` +
        "Fix the duplicate (check-qualification-record-required.mjs's own duplicate-deferral rule) first.",
    );
  }
  if (matches.length === 0) {
    return { removed: false, path, doc, issue: null };
  }

  const remaining = doc.deferrals.filter((entry) => entry !== matches[0]);
  return { removed: true, path, doc: { ...doc, deferrals: remaining }, issue: matches[0].issue };
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
    console.log(`NO DEFERRAL TO REMOVE — no entry in ${DEFERRALS_PATH} names ${args.package}@${args.version}.`);
    process.exit(0);
  }

  writeFileSync(result.path, `${JSON.stringify(result.doc, null, 2)}\n`);
  console.log(`DEFERRAL REMOVED — ${args.package}@${args.version} (issue #${result.issue}) removed from ${DEFERRALS_PATH}.`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
export { argsFrom, UsageError, IndeterminateError, DEFERRALS_PATH };
