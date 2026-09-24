#!/usr/bin/env node
// check-changeset-style — report-only prose lint over pending .changesets/*.md
// summaries, against the style rule issue #1423 set: one factual sentence per
// change, in consumer terms (what a user can now do, or what now behaves
// differently), with no absolute qualifier ("exactly", "never", "always",
// "independently", "append-only", "fully", "guaranteed", ...) unless a test
// proves it, and no description of what did NOT change. See .changesets/
// README.md's "Style" section for the rule itself and worked examples.
//
//   node scripts/check-changeset-style.mjs [--json]
//
// REPORT-ONLY, ALWAYS. This never blocks a pull request or a release: it
// exists to surface prose worth a second look before the release PR turns
// it into a CHANGELOG line verbatim, not to gate on wording nobody has
// taught a machine to judge reliably. A finding here is a nudge, not a
// verdict.
//
// EXIT CONTRACT — deliberately NOT the usual 0/1/2 ternary every other gate
// in this repository uses. This lint reports the same way regardless of
// how many findings it has: exit 0 whenever the input was readable, findings
// or not. The ONLY nonzero exit is 2, and only when .changesets/ itself (or
// a file inside it) could not be read -- an environment or filesystem
// problem, not a style judgment. This mirrors check-install-docs.mjs's
// "printed and counted, never a failure" pattern, extended one step further
// (that gate still fails at 1; this one never does, by design, because
// unlike a missing install claim a wording judgment is not something CI
// should ever block a merge over).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANGESETS_DIR, loadChangesets } from "./collect-changesets.mjs";

// The configurable list the rule names explicitly (issue #1423): absolute
// qualifiers a changeset summary should carry only when a test proves them.
// Matched as whole words/phrases, case-insensitively, against prose only --
// see `stripCodeSpans` below for why code spans are excluded first.
export const DEFAULT_ABSOLUTE_QUALIFIERS = [
  "exactly",
  "never",
  "always",
  "independently",
  "append-only",
  "fully",
  "guaranteed",
];

// Chosen from the current `.changesets/` distribution (34 pending entries,
// measured 2026-09-24 by this script's own author while writing it):
// lengths ranged 159-2620 characters, median 555, mean 679, and the 75th
// percentile sits at 787-901. 800 characters is just inside that 75th
// percentile: long enough to leave an ordinary one-paragraph technical
// summary alone, short enough to flag the multi-bug bundles and
// capability-map essays that run 1300-2600 characters -- entries that are
// usually several factual sentences bundled together, which is exactly what
// the "one factual sentence per change" rule is about. Configurable via
// `--max-length`.
export const DEFAULT_LENGTH_THRESHOLD = 800;

// Negative-change phrasing: a changeset summary describing what did NOT
// change, rather than what a consumer can now do. Two shapes named in the
// issue, plus the general "no-change" vocabulary that kept showing up in
// this repository's own corrected release text (see .changesets/README.md's
// "Style" section for two real, generalized examples this rule would have
// caught).
const NEGATIVE_PHRASING_PATTERNS = [
  // "no longer ... [that were] never ..." -- a double negative describing
  // an absence of a past absence, rather than the present behavior.
  { name: "no-longer-never", regex: /\bno longer\b[\s\S]*?\bnever\b|\bnever\b[\s\S]*?\bno longer\b/i },
  // "only <scope>, not <other scope>" -- states what is excluded rather
  // than what the change does.
  { name: "only-not", regex: /\bonly\b[^.!?]{0,80}?\bnot\b/i },
  // "no <...> change[d/s]" within a short span -- "No schema or field
  // change", "no behavior change", etc.
  { name: "no-change", regex: /\bno\b[^.!?]{0,40}?\bchange[ds]?\b/i },
  // Direct "nothing changed here" vocabulary that doesn't fit the two
  // patterns above.
  { name: "explicit-no-change", regex: /\b(?:remains? unchanged|nothing (?:else )?chang(?:ed|es)|unaffected|prose only|does not change|did not change)\b/i },
];

// Markdown inline code spans (`` `text` ``) are stripped before keyword
// matching so a proofCase id or CLI flag that happens to contain a
// configured word ({@link DEFAULT_ABSOLUTE_QUALIFIERS}'s "append-only" is a
// real substring of the `record-append-only-clean` proofCase id already
// shipped in .changesets/capability-map-publisher.md) is never mistaken for
// the prose claim the rule is actually about. Length is measured on the
// UNSTRIPPED summary -- a long code-heavy summary is still a long summary.
export function stripCodeSpans(text) {
  return text.replace(/`[^`]*`/g, " ");
}

function wordBoundaryRegex(term) {
  // Hyphenated terms ("append-only") need `-` treated as a boundary-safe
  // literal, not a regex range; \b still anchors correctly on either side.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

/**
 * Evaluates one changeset entry's summary against the style rule. Pure and
 * side-effect-free so the regression tests need no filesystem.
 *
 * @param {{file: string, summary: string}} entry
 * @param {{absoluteQualifiers?: string[], lengthThreshold?: number}} [options]
 * @returns {Array<{rule: string, severity: "warning", file: string, message: string}>}
 */
export function evaluateChangesetStyle(entry, options = {}) {
  const absoluteQualifiers = options.absoluteQualifiers ?? DEFAULT_ABSOLUTE_QUALIFIERS;
  const lengthThreshold = options.lengthThreshold ?? DEFAULT_LENGTH_THRESHOLD;
  const { file, summary } = entry;
  const findings = [];
  const prose = stripCodeSpans(summary);

  for (const term of absoluteQualifiers) {
    if (wordBoundaryRegex(term).test(prose)) {
      findings.push({
        rule: "absolute-qualifier",
        severity: "warning",
        file,
        message: `summary uses the absolute qualifier "${term}" -- keep it only if a test proves it, otherwise say what is actually true`,
      });
    }
  }

  const length = summary.trim().length;
  if (length > lengthThreshold) {
    findings.push({
      rule: "over-length",
      severity: "warning",
      file,
      message: `summary is ${length} characters, over the ${lengthThreshold}-character threshold -- likely several factual sentences bundled into one changeset; consider one sentence per change`,
    });
  }

  for (const pattern of NEGATIVE_PHRASING_PATTERNS) {
    if (pattern.regex.test(prose)) {
      findings.push({
        rule: "negative-change-phrasing",
        severity: "warning",
        file,
        message: `summary describes what did NOT change ("${pattern.name}" phrasing) -- say what a consumer can now do or what now behaves differently instead`,
      });
    }
  }

  return findings;
}

/**
 * Evaluates every well-formed changeset entry `collect-changesets.mjs`
 * already parsed. Malformed files are `collect-changesets.mjs`'s own
 * concern (`check:changesets`) and are not re-reported here.
 *
 * @param {Array<{file: string, summary: string}>} entries
 */
export function evaluateChangesetStyleAll(entries, options = {}) {
  const findings = [];
  for (const entry of entries) {
    findings.push(...evaluateChangesetStyle(entry, options));
  }
  return findings;
}

function isDirectInvocation(moduleUrl, argvPath) {
  if (argvPath === undefined) return false;
  try {
    return fileURLToPath(moduleUrl) === resolve(argvPath);
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  let maxLength = DEFAULT_LENGTH_THRESHOLD;
  const idx = argv.indexOf("--max-length");
  if (idx !== -1 && argv[idx + 1] !== undefined) {
    const parsed = Number(argv[idx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) maxLength = parsed;
  }
  return { json, maxLength };
}

function printText(entries, findings, maxLength) {
  if (entries.length === 0) {
    console.log("no pending changesets.");
  } else if (findings.length === 0) {
    console.log(`0 style findings across ${entries.length} pending changeset(s).`);
  } else {
    for (const f of findings) {
      console.log(`  [${f.rule}] ${f.file} -- ${f.message}`);
    }
    const byFile = new Set(findings.map((f) => f.file)).size;
    console.log("");
    console.log(`${findings.length} style finding(s) across ${byFile} of ${entries.length} pending changeset(s) (threshold: ${maxLength} characters).`);
  }
  console.log("Report-only: this never fails the check. See .changesets/README.md's \"Style\" section for the rule and examples.");
}

export function main(argv, root = process.cwd()) {
  const { json, maxLength } = parseArgs(argv);
  let entries;
  try {
    ({ entries } = loadChangesets(root));
  } catch (error) {
    const message = `could not read ${CHANGESETS_DIR}/: ${error instanceof Error ? error.message : String(error)}`;
    if (json) console.log(JSON.stringify({ error: message, findings: [] }, null, 2));
    else console.error(`check-changeset-style: ${message}`);
    return 2;
  }

  const styleFindings = evaluateChangesetStyleAll(entries, { lengthThreshold: maxLength });

  if (json) {
    console.log(JSON.stringify({ pending: entries.length, findings: styleFindings }, null, 2));
  } else {
    printText(entries, styleFindings, maxLength);
  }
  return 0;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
