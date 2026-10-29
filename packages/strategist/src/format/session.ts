import { refsInText, sessionId } from "./ref.js";
import type { FormatIssue, FormatResult, Session, SessionLine } from "./types.js";

export function parseSession(text: string, id: string, path = ""): FormatResult<Session> {
  const issues: FormatIssue[] = []; const lines: SessionLine[] = []; const index: Record<string, SessionLine> = Object.create(null);
  if (!sessionId(id)) issues.push({ path: "id", line: 1, message: "Expected a dated session id YYYY-MM-DD-n" });
  for (const [i, row] of text.split(/\r?\n/).entries()) {
    if (!row.trim()) continue;
    const match = /^- ([US])([1-9]\d*): (\S.*)$/.exec(row);
    if (!match || !Number.isSafeInteger(Number(match[2]))) { issues.push({ path: "body", line: i + 1, message: "Expected - U<n>: text or - S<n>: text" }); continue; }
    const lineId = `${match[1]}${match[2]}`;
    if (Object.hasOwn(index, lineId)) { issues.push({ path: lineId, line: i + 1, message: "Duplicate session line id" }); continue; }
    const line: SessionLine = { id: lineId, role: match[1] === "U" ? "user" : "strategist", text: match[3]!, line: i + 1, refs: refsInText(match[3]!) };
    lines.push(line); index[lineId] = line;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: { id, path, lines, index } };
}
