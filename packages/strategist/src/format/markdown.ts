import type { Bullet, FormatIssue, FormatResult } from "./types.js";
import { parseRef } from "./ref.js";

type Scalar = string | number | boolean;
export type FlatValue = Scalar | Scalar[];
export interface FlatDocument { fields: Record<string, FlatValue>; fieldLines: Record<string, number>; body: { text: string; line: number }[] }
function scalar(text: string): Scalar | undefined {
  if (!text || /^[\[\]{}'&*!|>]/.test(text)) return undefined;
  if (text.startsWith('"')) {
    try { const value: unknown = JSON.parse(text); return typeof value === "string" ? value : undefined; } catch { return undefined; }
  }
  if (/[\[\]{}]/.test(text) || /:\s/.test(text)) return undefined;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    const n = Number(text); return Number.isFinite(n) ? n : undefined;
  }
  if (text === "true" || text === "false") return text === "true";
  return text;
}
function flatValue(text: string): FlatValue | undefined {
  if (!text.startsWith("[")) return scalar(text);
  if (!text.endsWith("]")) return undefined;
  const inner = text.slice(1, -1).trim(); if (!inner) return [];
  const tokens: string[] = []; let start = 0; let quote = false; let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (escaped) { escaped = false; continue; }
    if (quote && c === "\\") { escaped = true; continue; }
    if (c === '"') quote = !quote;
    if (c === "," && !quote) { tokens.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  if (quote) return undefined;
  tokens.push(inner.slice(start).trim());
  const values = tokens.map(scalar);
  return values.every((v): v is Scalar => v !== undefined) ? values : undefined;
}
/** Flat scalar/flow-list frontmatter only. All rejected syntax has its source line. */
export function parseDocument(text: string): FormatResult<FlatDocument> {
  const lines = text.split(/\r?\n/); const issues: FormatIssue[] = [];
  const add = (line: number, message: string) => issues.push({ path: "frontmatter", line, message });
  if (lines[0] !== "---") return { ok: false, issues: [{ path: "frontmatter", line: 1, message: "Expected opening ---" }] };
  const close = lines.indexOf("---", 1);
  if (close < 0) return { ok: false, issues: [{ path: "frontmatter", line: lines.length, message: "Expected closing ---" }] };
  const fields: Record<string, FlatValue> = Object.create(null); const fieldLines: Record<string, number> = Object.create(null);
  for (let i = 1; i < close; i++) {
    const match = /^([a-z][a-zA-Z]*): (.+)$/.exec(lines[i]!);
    if (!match) { add(i + 1, "Expected one-level key: scalar or key: [values]; nesting is unsupported"); continue; }
    const key = match[1]!;
    if (Object.hasOwn(fields, key)) { add(i + 1, "Duplicate frontmatter key"); continue; }
    const value = flatValue(match[2]!);
    if (value === undefined) { add(i + 1, "Unsupported scalar, list or nested YAML syntax"); continue; }
    fields[key] = value; fieldLines[key] = i + 1;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: { fields, fieldLines, body: lines.slice(close + 1).map((text, i) => ({ text, line: close + i + 2 })) } };
}
export function readBullet(text: string, line: number): Bullet | undefined {
  if (!text.startsWith("- ") || !text.slice(2).trim()) return undefined;
  const content = text.slice(2); const label = /^([A-Za-z][A-Za-z0-9 -]*):\s+(.*)$/.exec(content);
  const body = label ? label[2]! : content;
  // Only terminal parenthesised ref lists are citations; parentheses in ordinary prose remain prose.
  const suffix = /\(([^()]*)\)[.!?]?$/.exec(body);
  const candidates = suffix?.[1]?.split(",").map(s => parseRef(s.trim()));
  const refs = candidates?.every(r => r !== undefined) ? candidates : [];
  return { ...(label ? { key: label[1] } : {}), text: body, refs, line };
}
export function serializeScalar(value: Scalar): string {
  if (typeof value !== "string") return String(value);
  // Quotes also prevent strings that resemble numeric/boolean scalars changing type.
  return scalar(value) === value && !value.startsWith('"') && !value.includes(",") && !/[\r\n]/.test(value) ? value : JSON.stringify(value);
}
export function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === "string"); }
