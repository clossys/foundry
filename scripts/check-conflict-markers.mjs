/**
 * check-conflict-markers — an unresolved merge left in a committed file.
 *
 * Found the hard way: `packages/controller/CHANGELOG.md` and
 * `packages/controller/README.md` both carried `<<<<<<< HEAD` / `=======` /
 * `>>>>>>> origin/main` on `main` of a PUBLIC repository, through a full
 * `npm run check` that passed, because nothing here looks for them. A sibling
 * repository in this fleet has had a blocking conflict-markers gate for a
 * while; this one did not.
 *
 * WHY THE GATE NEAREST THE DAMAGE COULD NOT SEE IT. `check:readme` is a
 * PARITY gate: it compares a package's real exports against the rows of the
 * README table. A `<<<<<<< HEAD` line does not parse as a row, so it is not a
 * mismatch — it is nothing at all. The check closest to the broken file was
 * structurally incapable of noticing, which is the recurring shape here: the
 * absence of a signal read as the absence of a problem.
 *
 * WHAT COUNTS AS A MARKER. Only the three git conflict forms, anchored to the
 * START of a line, which is where git writes them:
 *
 *   <<<<<<< <label>     a conflict opened
 *   =======             the divider, EXACTLY seven equals and nothing else
 *   >>>>>>> <label>     a conflict closed
 *
 * The divider is the one that needs care. A bare `=======` line is also how
 * plenty of documents underline a heading, so requiring exactly seven and
 * nothing else keeps a Setext `====` underline or a `========` rule out of the
 * findings. A divider alone is never reported either — it is only a finding
 * when it appears between an opener and a closer, because that pairing is what
 * makes it a conflict rather than punctuation.
 *
 * Scans the git tree, not the working directory: a marker only matters once it
 * is committed, and an in-progress local merge is not this gate's business.
 *
 * TERNARY. satisfied 0 · violated 1 · indeterminate 2. Indeterminate when the
 * file list cannot be read at all — never reported as "no markers found",
 * because a scan that could not look has not established anything.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OPENER = /^<{7}(?: |$)/;
const CLOSER = /^>{7}(?: |$)/;
const DIVIDER = /^={7}$/;

/**
 * Find conflict blocks in one file's text.
 *
 * Pure and exported so the tests can hand it the awkward cases directly —
 * a Setext underline, a horizontal rule, an opener with no closer.
 */
export function findConflictBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let open = null;
  let sawDivider = false;
  for (const [index, line] of lines.entries()) {
    if (OPENER.test(line)) { open = index + 1; sawDivider = false; continue; }
    if (open !== null && DIVIDER.test(line)) { sawDivider = true; continue; }
    if (open !== null && CLOSER.test(line)) {
      blocks.push({ startLine: open, endLine: index + 1, hadDivider: sawDivider });
      open = null;
      sawDivider = false;
    }
  }
  // An opener with no closer is still an unresolved merge, and is worse than a
  // complete block: the rest of the file is inside it.
  if (open !== null) blocks.push({ startLine: open, endLine: null, hadDivider: sawDivider });
  return blocks;
}

/** Every file git tracks. Binary files are skipped by git's own -I when we read them. */
function trackedFiles(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((entry) => entry.length > 0);
}

export function run({ root = process.cwd(), files = undefined, read = (path) => readFileSync(path, "utf8") } = {}) {
  let list;
  try {
    list = files ?? trackedFiles(root);
  } catch (error) {
    return { verdict: "indeterminate", findings: [], reason: `could not list tracked files: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (list.length === 0) {
    return { verdict: "indeterminate", findings: [], reason: "git reported zero tracked files — a scan of nothing is not a clean scan" };
  }

  const findings = [];
  for (const relative of list) {
    let text;
    try { text = read(`${root}/${relative}`); } catch { continue; } // unreadable/binary: not this gate's finding
    if (!text.includes("<<<<<<<") && !text.includes(">>>>>>>")) continue; // cheap pre-filter
    for (const block of findConflictBlocks(text)) {
      findings.push({
        file: relative,
        startLine: block.startLine,
        endLine: block.endLine,
        detail: block.endLine === null
          ? `unresolved conflict opened at line ${block.startLine} and never closed`
          : `unresolved conflict, lines ${block.startLine}-${block.endLine}${block.hadDivider ? "" : " (no divider — check this is a real conflict)"}`,
      });
    }
  }
  return { verdict: findings.length === 0 ? "satisfied" : "violated", findings, reason: null, scanned: list.length };
}

export const EXIT_CODES = Object.freeze({ satisfied: 0, violated: 1, indeterminate: 2 });

function main() {
  const result = run();
  for (const f of result.findings) console.log(`  [conflict-marker] ${f.file} — ${f.detail}`);
  if (result.verdict === "satisfied") console.log(`\ncheck-conflict-markers: OK — ${result.scanned} tracked file(s), no unresolved merge committed.`);
  else if (result.verdict === "violated") console.log(`\ncheck-conflict-markers: FAIL — ${result.findings.length} unresolved conflict(s) committed.`);
  else console.log(`\ncheck-conflict-markers: INDETERMINATE — ${result.reason}`);
  process.exit(EXIT_CODES[result.verdict]);
}

if (process.argv[1] && process.argv[1].endsWith("check-conflict-markers.mjs")) main();
