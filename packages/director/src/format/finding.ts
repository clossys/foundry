import { isPlainObject } from "../validation.js";
import { isoDate, RECORD_ID_PATTERN } from "./ref.js";
import { parseDocument, readBullet, strings } from "./markdown.js";
import type { Finding, FormatIssue, FormatResult } from "./types.js";

function source(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value === "user") return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol); } catch { /* Relative evidence path. */ }
  return !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value) && !value.split("/").some(p => p === ".." || p === "." || !p);
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
  return issues.length ? { ok: false, issues } : { ok: true, value: { ...value, path: value.path ?? "" } as unknown as Finding };
}
export function parseFinding(text: string, path = ""): FormatResult<Finding> {
  const doc = parseDocument(text); if (!doc.ok) return doc;
  const { fields, fieldLines, body } = doc.value; const issues: FormatIssue[] = []; const bullets: Finding["bullets"] = [];
  for (const key of Object.keys(fields)) if (!["id", "source", "observed", "by", "value", "unit", "aliases"].includes(key)) issues.push({ path: key, line: fieldLines[key]!, message: "Unknown finding field" });
  for (const row of body) {
    if (!row.text.trim()) continue;
    const bullet = readBullet(row.text, row.line);
    if (bullet) bullets.push(bullet); else issues.push({ path: "body", line: row.line, message: "Expected a finding bullet" });
  }
  const result = validateFinding({ ...fields, bullets, path });
  if (!result.ok) issues.push(...result.issues.map(issue => ({ ...issue, line: fieldLines[issue.path] ?? issue.line })));
  return issues.length ? { ok: false, issues } : result;
}
