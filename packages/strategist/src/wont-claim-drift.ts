/** Checks quoted prohibitions from the active Proof and Voice cells.
 * Matching is literal, case-insensitive and bounded by words. Comment ignore
 * markers are recorded. Zero files, invalid active sources and overlong lines
 * are indeterminate; indeterminate wins over hits. Unquoted bullets remain
 * explicitly unchecked. This pure checker performs no filesystem reads.
 */

import type { StrategyModel } from "./format/types.js";
const MAX_LINE_CHARS = 16384;
import type { ScannedFile } from "./facts-gate.js";

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
  /** Files actually checked. */
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

/** Checks the active Proof and Voice prohibitions. */
export function checkWontClaimDrift(files: readonly ScannedFile[], source: StrategyModel): WontClaimResult {
  const selected = activeWontClaim(source);
  const brief = { wontClaim: selected.entries };
  const findings: WontClaimFinding[] = [];
  const ignored: WontClaimResult["ignored"] = [];
  const longLineReasons: string[] = [];
  let longLines = 0;

  const checked = brief.wontClaim.flatMap((entry) =>
    (entry.matchPhrases ?? []).length === 0 ? [] : [{ id: entry.id, patterns: (entry.matchPhrases ?? []).map(phraseRegExp) }],
  );
  const unchecked = brief.wontClaim.filter((entry) => (entry.matchPhrases ?? []).length === 0).map((entry) => entry.id);

  const scanned = files;
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
            message: `"${found}" makes a claim the active strategy says it will not make (${entry.id}).`,
          });
          break; // one finding per id per line
        }
      }
    }
  }

  const indeterminateReasons: string[] = [...selected.issues, ...longLineReasons];
  if (longLines > longLineReasons.length) {
    indeterminateReasons.push(`${longLines - longLineReasons.length} more line(s) over the ${MAX_LINE_CHARS} character limit were not checked`);
  }
  if (scanned.length === 0) indeterminateReasons.push("no files scanned");

  const state: WontClaimState = indeterminateReasons.length > 0 ? "indeterminate" : findings.length > 0 ? "hit" : "clean";
  return { state, findings, ignored, unchecked, filesScanned: scanned.length, indeterminateReasons };
}


/** Only Direction labels in the tree-selected active Proof and Voice govern copy. */
function activeWontClaim(model: StrategyModel): { entries: { id: string; statement: string; matchPhrases: string[] }[]; issues: string[] } {
  const entries: { id: string; statement: string; matchPhrases: string[] }[] = []; const issues: string[] = [];
  const sources = [["advantage.proposition.proof", "Never-claim"], ["identity.verbal.voice", "Never"]] as const;
  for (const issue of model.issues) {
    if (issue.path === "." || issue.path === "tree.json" || sources.some(([id]) => issue.path === `cells/${id}` || issue.path === `cells/${id}/v${model.tree?.active[id]}.md`)) {
      issues.push(`${issue.path}:${issue.line}: ${issue.message}`);
    }
  }
  if (!model.tree) issues.push("tree.json: no valid active pointers");
  for (const [id, key] of sources) {
    const version = model.tree?.active[id];
    const cells = model.cells.filter(c => c.id === id && c.version === version);
    const cell = cells[0];
    if (version == null || cells.length !== 1 || cell?.status !== "active") {
      issues.push(`${id}: active cell is missing or disagrees with tree.json`); continue;
    }
    const bullets = cell.direction.filter(b => b.key === key);
    if (!bullets.length) issues.push(`${cell.path}: missing ${key}: label`);
    for (const bullet of bullets) {
      // Delimiters sit outside words; apostrophes inside words belong to the phrase.
      const phrases = [...bullet.text.matchAll(/(?<![\p{L}\p{N}_])(?:"((?:[^"\\]|\\.)+)"|“([^”]+)”|'((?:[^'\n]|(?<=[\p{L}\p{N}_])'(?=[\p{L}\p{N}_]))+)'|‘((?:[^’\n]|(?<=[\p{L}\p{N}_])’(?=[\p{L}\p{N}_]))+)’)(?![\p{L}\p{N}_])/gu)]
        .map(m => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim()).filter(Boolean);
      entries.push({ id: `${id}@${version}#${bullet.line}`, statement: bullet.text, matchPhrases: phrases });
    }
  }
  return { entries, issues };
}
