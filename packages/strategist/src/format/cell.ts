import type { Cell, FormatIssue, FormatResult, Ref } from "./types.js";
import { CELL_ID_PATTERN, formatRef, isoDate, parseRef, positiveInteger } from "./ref.js";
import { parseDocument, readBullet, serializeScalar, strings } from "./markdown.js";

/** Parses structural syntax. Q1–Q7 and cross-file coherence belong to checks. */
export function parseCell(text: string, path = ""): FormatResult<Cell> {
  const doc = parseDocument(text); if (!doc.ok) return doc;
  const { fields: f, fieldLines: loc, body } = doc.value; const issues: FormatIssue[] = [];
  const add = (key: string, message: string, line = loc[key] ?? 1) => issues.push({ path: key, line, message });
  const allowed = ["id", "version", "status", "updated", "cites", "feeds", "functions", "confirmed", "note"];
  for (const key of Object.keys(f)) if (!allowed.includes(key)) add(key, "Unknown cell field");
  if (typeof f.id !== "string" || !CELL_ID_PATTERN.test(f.id)) add("id", "Expected l1.l2.l3 cell id");
  if (!positiveInteger(f.version)) add("version", "Expected a positive safe integer");
  if (typeof f.status !== "string" || !["draft", "active", "retired"].includes(f.status)) add("status", "Expected draft, active or retired");
  if (!isoDate(f.updated)) add("updated", "Expected a calendar date YYYY-MM-DD");
  for (const key of ["cites", "feeds", "functions"]) if (!strings(f[key])) add(key, "Expected a flow list of strings");
  const cites: Ref[] = [];
  if (strings(f.cites)) for (const text of f.cites) { const ref = parseRef(text); if (ref) cites.push(ref); else add("cites", "Invalid reference"); }
  const confirmed = typeof f.confirmed === "string" ? parseRef(f.confirmed) : undefined;
  if ((f.confirmed !== undefined || f.status === "active") && confirmed?.kind !== "msg") add("confirmed", "Expected a msg: confirmation reference");
  if (f.note !== undefined && typeof f.note !== "string") add("note", "Expected a scalar string");
  const cell: Cell = {
    id: f.id as string, version: f.version as number, status: f.status as Cell["status"], updated: f.updated as string,
    cites, feeds: f.feeds as string[], functions: f.functions as string[], ...(confirmed ? { confirmed } : {}),
    ...(typeof f.note === "string" ? { note: f.note } : {}), direction: [], because: [], watch: [], path,
  };
  const headings = ["## Direction", "## Because", "## Watch"]; const sections = [cell.direction, cell.because, cell.watch]; let section = -1;
  for (const row of body) {
    if (!row.text.trim()) continue;
    if (row.text.startsWith("#")) {
      if (row.text !== headings[section + 1]) add("body", "Expected Direction, Because, Watch sections in order", row.line);
      else section++;
      continue;
    }
    const bullet = readBullet(row.text, row.line);
    if (!bullet || section < 0) add("body", "Expected a bullet inside a cell section", row.line);
    else sections[section]!.push(bullet);
  }
  if (section !== 2) add("body", "Expected exactly three sections: Direction, Because, Watch", body.at(-1)?.line ?? 1);
  return issues.length ? { ok: false, issues } : { ok: true, value: cell };
}

/** Canonical flat Markdown; Bullet.text already contains its reference prose. */
export function serializeCell(cell: Cell): string {
  const list = (values: string[]) => `[${values.map(serializeScalar).join(", ")}]`;
  const lines = ["---", `id: ${serializeScalar(cell.id)}`, `version: ${cell.version}`, `status: ${cell.status}`, `updated: ${cell.updated}`,
    `cites: ${list(cell.cites.map(formatRef))}`, `feeds: ${list(cell.feeds)}`, `functions: ${list(cell.functions)}`];
  if (cell.confirmed) lines.push(`confirmed: ${serializeScalar(formatRef(cell.confirmed))}`);
  if (cell.note !== undefined) lines.push(`note: ${serializeScalar(cell.note)}`);
  lines.push("---");
  for (const [heading, bullets] of [["Direction", cell.direction], ["Because", cell.because], ["Watch", cell.watch]] as const) {
    lines.push("", `## ${heading}`, ...bullets.map(b => `- ${b.key ? `${b.key}: ` : ""}${b.text}`));
  }
  return `${lines.join("\n")}\n`;
}
