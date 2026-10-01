/**
 * `checkWontClaimDrift` — does any surface make a claim the strategy brief
 * says it must never make? Pure: takes already-read `ScannedFile[]` and an
 * already-validated `StrategyBrief` (`strategy-brief.ts`); does no I/O and
 * never throws.
 *
 * W1  A phrase matches literally, case-insensitively, on word boundaries.
 *     Each phrase is regex-escaped before it becomes a pattern (runs of
 *     whitespace in it match any whitespace run), so a phrase is never a
 *     pattern and there is no user regex. "unguaranteed results" is not a
 *     hit for "guaranteed results".
 * W2  A hit is a finding (file, line, id), one per id per line. A line
 *     carrying `wont-claim:ignore` inside a comment opener (`<!--`, `/*`,
 *     `{/*`, `//`, or `#` as the first non-blank character of the line) is
 *     listed in `ignored` and not checked. Recorded, never silent.
 * W3  An entry with no `matchPhrases` is listed in `unchecked` — recorded,
 *     but nothing can mechanically check it — and never changes the state.
 * W4  Fails closed, like `brand-facts-drift.ts`: zero files checked is
 *     "indeterminate", never "clean", and a line over `MAX_LINE_CHARS` is
 *     not checked at all — it makes the result "indeterminate", naming
 *     file:line. The cap is applied before the ignore marker, so a line that
 *     was not read is neither clean nor an override. Indeterminate wins over
 *     a hit; findings are still returned.
 * W5  `strategy-brief.json` itself is never a finding source: it lists the
 *     very phrases being searched for. A file with that name is skipped, and
 *     is not counted as scanned.
 *
 * Detection is lexical: it finds the phrases the record lists, and a claim
 * made in any other words is not detected.
 */

import { MAX_LINE_CHARS } from "./brand-facts-drift.js";
import type { ScannedFile } from "./facts-gate.js";
import { STRATEGY_BRIEF_FILE, type StrategyBrief } from "./strategy-brief.js";

export interface WontClaimFinding {
  id: string;
  file: string;
  /** 1-based. */
  line: number;
  /** The text on the line that matched, as written there. */
  found: string;
  message: string;
}

export type WontClaimState = "clean" | "hit" | "indeterminate";

export interface WontClaimResult {
  state: WontClaimState;
  findings: WontClaimFinding[];
  ignored: { file: string; line: number; snippet: string }[];
  /** Ids of entries with no `matchPhrases`: recorded, not mechanically checked (W3). */
  unchecked: string[];
  /** Files actually checked; `strategy-brief.json` is not counted (W5). */
  filesScanned: number;
  /** Non-empty exactly when `state` is "indeterminate". */
  indeterminateReasons: string[];
}

/** `#` opens the marker only as the first non-blank character; anywhere else it is a URL fragment or a heading. */
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*wont-claim:ignore\b|^\s*#\s*wont-claim:ignore\b/i;
/** How many over-cap lines are listed one by one in `indeterminateReasons`; the rest are counted. */
const MAX_LONG_LINE_REASONS = 20;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-phrase, case-insensitive matcher for one literal phrase (W1). */
function phraseRegExp(phrase: string): RegExp {
  const literal = escapeRegExp(phrase.trim()).replace(/\s+/g, String.raw`\s+`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])${literal}(?![\p{L}\p{N}_])`, "iu");
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function isBriefRecord(path: string): boolean {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] === STRATEGY_BRIEF_FILE;
}

export function checkWontClaimDrift(files: readonly ScannedFile[], brief: StrategyBrief): WontClaimResult {
  const findings: WontClaimFinding[] = [];
  const ignored: WontClaimResult["ignored"] = [];
  const longLineReasons: string[] = [];
  let longLines = 0;

  const checked = brief.wontClaim.flatMap((entry) =>
    (entry.matchPhrases ?? []).length === 0 ? [] : [{ id: entry.id, patterns: (entry.matchPhrases ?? []).map(phraseRegExp) }],
  );
  const unchecked = brief.wontClaim.filter((entry) => (entry.matchPhrases ?? []).length === 0).map((entry) => entry.id);

  const scanned = files.filter((file) => !isBriefRecord(file.path));
  for (const file of scanned) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = (lines[i] as string).replace(/\r$/, "");
      const lineNo = i + 1;
      // The cap comes first: a line that was not read is neither clean nor an override.
      if (raw.length > MAX_LINE_CHARS) {
        longLines++;
        if (longLines <= MAX_LONG_LINE_REASONS) {
          longLineReasons.push(
            `${file.path}:${lineNo} is ${raw.length} characters, over the ${MAX_LINE_CHARS} character limit, and was not checked`,
          );
        }
        continue;
      }
      if (IGNORE_MARKER_RE.test(raw)) {
        ignored.push({ file: file.path, line: lineNo, snippet: snippetOf(raw) });
        continue;
      }
      for (const entry of checked) {
        for (const pattern of entry.patterns) {
          const match = pattern.exec(raw);
          if (match === null) continue;
          const found = match[0];
          findings.push({
            id: entry.id,
            file: file.path,
            line: lineNo,
            found,
            message: `"${found}" makes a claim the strategy brief says it will not make (${entry.id}).`,
          });
          break; // one finding per id per line
        }
      }
    }
  }

  const indeterminateReasons: string[] = [...longLineReasons];
  if (longLines > longLineReasons.length) {
    indeterminateReasons.push(`${longLines - longLineReasons.length} more line(s) over the ${MAX_LINE_CHARS} character limit were not checked`);
  }
  if (scanned.length === 0) indeterminateReasons.push("no files scanned");

  const state: WontClaimState = indeterminateReasons.length > 0 ? "indeterminate" : findings.length > 0 ? "hit" : "clean";
  return { state, findings, ignored, unchecked, filesScanned: scanned.length, indeterminateReasons };
}
