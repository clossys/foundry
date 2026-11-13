import { isPlainObject } from "../validation.js";
import { CELL_ID_PATTERN, isoDate, RECORD_ID_PATTERN } from "./ref.js";
import { parseDocument, readBullet, strings } from "./markdown.js";
import type { Finding, FormatIssue, FormatResult } from "./types.js";

function source(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value === "user") return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol); } catch { /* Relative evidence path. */ }
  return !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value) && !value.split("/").some(p => p === ".." || p === "." || !p);
}
const CELL_PART = CELL_ID_PATTERN.source.slice(1, -1);
/** A judge id the checks accept as a verdict key: the storyline critic, a judge contradiction pair, or one cell's Q judgement. */
export const JUDGE_ID_PATTERN = new RegExp(`^(?:C4|C2:X[1-9][0-9]*|Q[1-7]:${CELL_PART}@[1-9][0-9]*)$`);
const JUDGED_REF_PATTERN = new RegExp(`^${CELL_PART}@[1-9][0-9]*$`);
/** A run citation: the traced step id and the 16-hex run id of one record in `.clossys/runs/<step>.jsonl`. */
export const RUN_CITATION_PATTERN = /^([A-Za-z0-9][A-Za-z0-9:._-]*)#([0-9a-f]{16})$/;

/**
 * A judgement finding records a judge verdict (the critic's storyline read, a judge contradiction pair)
 * on exact pinned cell versions: `judge`, `verdict` and `judged` are given together or not at all.
 */
function judgement(value: Record<string, unknown>, add: (path: string, message: string) => void): void {
  const given = ["judge", "verdict", "judged"].filter(key => value[key] !== undefined);
  if (!given.length) return;
  if (given.length !== 3) { add(given[0]!, "Expected judge, verdict and judged together"); return; }
  if (typeof value.judge !== "string" || !JUDGE_ID_PATTERN.test(value.judge)) add("judge", "Expected C4, C2:X<n> or Q<n>:<cell-id>@<N>");
  if (value.verdict !== "pass" && value.verdict !== "fail") add("verdict", "Expected pass or fail");
  if (!strings(value.judged) || !value.judged.length || value.judged.some(ref => !JUDGED_REF_PATTERN.test(ref)) || new Set(value.judged).size !== value.judged.length) add("judged", "Expected unique <cell-id>@<N> refs");
}

/** A judgement may cite the run record of the judge's run; only a judgement cites one. */
function runCitation(value: Record<string, unknown>, add: (path: string, message: string) => void): void {
  if (value.run === undefined) return;
  if (value.judge === undefined) add("run", "Only a judgement finding cites a run");
  else if (typeof value.run !== "string" || !RUN_CITATION_PATTERN.test(value.run)) add("run", "Expected <step>#<16-hex run id>");
}

/** Findings have scalar evidence values; nested data is outside the YAML subset. */
export function validateFinding(value: unknown): FormatResult<Finding> {
  const issues: FormatIssue[] = []; const add = (path: string, message: string) => issues.push({ path, line: 1, message });
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "finding", line: 1, message: "Expected a finding object" }] };
  if (typeof value.id !== "string" || !RECORD_ID_PATTERN.test(value.id)) add("id", "Expected a kebab-case finding id");
  if (!source(value.source)) add("source", "Expected an HTTP(S) URL, repository-relative path or user");
  if (!isoDate(value.observed)) add("observed", "Expected a calendar date YYYY-MM-DD");
  if (typeof value.by !== "string" || !value.by.trim()) add("by", "Expected a role");
  if (value.value !== undefined && !(["string", "number", "boolean"].includes(typeof value.value)) || typeof value.value === "number" && !Number.isFinite(value.value)) add("value", "Expected a finite scalar value");
  if (value.unit !== undefined && typeof value.unit !== "string") add("unit", "Expected a string");
  if (value.aliases !== undefined && !strings(value.aliases)) add("aliases", "Expected a list of strings");
  if (!Array.isArray(value.bullets) || value.bullets.some(b => !isPlainObject(b) || typeof b.text !== "string" || !b.text.trim() || !Array.isArray(b.refs) || !Number.isSafeInteger(b.line) || Number(b.line) < 1)) add("bullets", "Expected parsed bullets");
  if (value.path !== undefined && typeof value.path !== "string") add("path", "Expected a string");
  judgement(value, add);
  runCitation(value, add);
  return issues.length ? { ok: false, issues } : { ok: true, value: { ...value, path: value.path ?? "" } as unknown as Finding };
}
export function parseFinding(text: string, path = ""): FormatResult<Finding> {
  const doc = parseDocument(text); if (!doc.ok) return doc;
  const { fields, fieldLines, body } = doc.value; const issues: FormatIssue[] = []; const bullets: Finding["bullets"] = [];
  for (const key of Object.keys(fields)) if (!["id", "source", "observed", "by", "value", "unit", "aliases", "judge", "verdict", "judged", "run"].includes(key)) issues.push({ path: key, line: fieldLines[key]!, message: "Unknown finding field" });
  for (const row of body) {
    if (!row.text.trim()) continue;
    const bullet = readBullet(row.text, row.line);
    if (bullet) bullets.push(bullet); else issues.push({ path: "body", line: row.line, message: "Expected a finding bullet" });
  }
  const result = validateFinding({ ...fields, bullets, path });
  if (!result.ok) issues.push(...result.issues.map(issue => ({ ...issue, line: fieldLines[issue.path] ?? issue.line })));
  return issues.length ? { ok: false, issues } : result;
}
