/**
 * `advisor relations [--set <file>]`: a read-only note about sister repositories, for agents' context.
 * Each entry is a name, a relation and a one-line note; no path, URL or command is accepted, and nothing
 * here reads, writes or runs anything in a sister repository.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSecretPath } from "./guard.js";
import { ok, refused, type VerbResult } from "./host.js";

export const RELATIONS_RECORD = "clossys/advisor/relations.json";
export const RELATIONS_SCHEMA = "clossys.advisor-relations/1";
export const RELATION_KINDS = ["upstream", "downstream", "sibling"] as const;
const ENTRY_KEYS = ["name", "relation", "note"];

export interface SisterRepo { readonly name: string; readonly relation: (typeof RELATION_KINDS)[number]; readonly note: string }

export function relationsIssues(doc: unknown): string[] {
  const value = doc as { schema?: unknown; sisters?: unknown };
  if (typeof doc !== "object" || doc === null || value.schema !== RELATIONS_SCHEMA || !Array.isArray(value.sisters)) return [`must be {"schema":"${RELATIONS_SCHEMA}","sisters":[{name, relation, note}]}`];
  const extraTop = Object.keys(doc).filter(key => key !== "schema" && key !== "sisters");
  const issues = extraTop.map(key => `unknown key ${key}`);
  const names = new Set<string>();
  value.sisters.forEach((raw: unknown, index: number) => {
    const entry = raw as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) { issues.push(`sisters[${index}] must be an object`); return; }
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.includes(key)) issues.push(`sisters[${index}].${key} is not allowed (only name, relation, note; no path, URL or command)`);
    if (typeof entry.name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.name)) issues.push(`sisters[${index}].name must be a plain repository name`);
    else if (names.has(entry.name)) issues.push(`sisters[${index}].name ${entry.name} repeats`); else names.add(entry.name);
    if (!(RELATION_KINDS as readonly unknown[]).includes(entry.relation)) issues.push(`sisters[${index}].relation must be one of ${RELATION_KINDS.join(", ")}`);
    const note = entry.note;
    if (typeof note !== "string" || !note.trim() || note.length > 280 || /[\r\n]/.test(note)) issues.push(`sisters[${index}].note must be one line of at most 280 characters`);
    else if (/:\/\/|(^|\s)[~/]|\\|`|\$\(/.test(note)) issues.push(`sisters[${index}].note must not hold a path, URL or command`);
  });
  return issues;
}

export function runRelations(root: string, set: string | undefined): VerbResult {
  const file = join(root, RELATIONS_RECORD);
  if (set === undefined) {
    if (!existsSync(file)) return ok(["relations: none recorded; advisor relations --set <file> records them"], { schema: RELATIONS_SCHEMA, sisters: [] });
    const doc = JSON.parse(readFileSync(file, "utf8")) as { sisters: SisterRepo[] };
    return ok(doc.sisters.map(entry => `${entry.relation} ${entry.name}: ${entry.note}`), doc);
  }
  if (isSecretPath(set)) return refused(["relations: refused: --set names a secret or environment file"]);
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(set, "utf8")); } catch { return refused([`relations: cannot read ${set} as JSON`]); }
  const issues = relationsIssues(doc);
  if (issues.length) return refused(issues.map(issue => `relations: refused: ${issue}`));
  mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return ok([`relations: wrote ${RELATIONS_RECORD} (${(doc as { sisters: unknown[] }).sisters.length} sister repositories, context only)`], doc);
}
