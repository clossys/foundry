import { readBullet } from "./markdown.js";
import type { Bullet, FormatIssue, FormatResult } from "./schema.js";

export interface BodyLine { text: string; line: number }
export type BodyToken =
  | { type: "heading"; depth: 2 | 3; text: string; line: number }
  | { type: "bullet"; bullet: Bullet; text: string; line: number }
  | { type: "json"; value: unknown; text: string; line: number; endLine: number }
  | { type: "raw"; text: string; line: number };

/** Tokenizes structure only; agent profiles decide section order and allowed raw text. */
export function tokenizeBody(body: readonly BodyLine[] | string): FormatResult<BodyToken[]> {
  const lines = typeof body === "string" ? body.split(/\r?\n/).map((text, i) => ({ text, line: i + 1 })) : body;
  const tokens: BodyToken[] = []; const issues: FormatIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]!;
    if (current.text === "```json") {
      const content: string[] = []; let end = i + 1;
      while (end < lines.length && lines[end]!.text !== "```") content.push(lines[end++]!.text);
      if (end === lines.length) {
        issues.push({ path: "body", line: current.line, message: "Expected closing JSON fence" }); break;
      }
      const text = content.join("\n");
      try { tokens.push({ type: "json", value: JSON.parse(text) as unknown, text, line: current.line, endLine: lines[end]!.line }); }
      catch { issues.push({ path: "body", line: current.line, message: "Invalid fenced JSON" }); }
      i = end; continue;
    }
    const heading = /^(#{2,3}) (.+)$/.exec(current.text);
    if (heading) { tokens.push({ type: "heading", depth: heading[1]!.length as 2 | 3, text: heading[2]!, line: current.line }); continue; }
    const bullet = readBullet(current.text, current.line);
    tokens.push(bullet ? { type: "bullet", bullet, text: current.text, line: current.line } : { type: "raw", ...current });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: tokens };
}
