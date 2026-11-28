/**
 * The unit packet schema (CP1-UNITPACKET): one schema the Planner writes (`clossys unit new`), lints
 * (`clossys unit lint`, owner rule R-UNIT-PACKET) and briefs from (`clossys unit brief`), so a packet with a
 * missing section, field or write set never reaches a role prompt. Pure: no filesystem, clock or git here;
 * `./unit.ts` reads the packet, the Planner skill (role templates) and the rule registry and passes them in.
 */
import { readPacket, UnitReadError, UnitRefusal, withholdLocalPaths } from "./unit-rules.js";

export const PACKET_RULE = "R-UNIT-PACKET";

/** The sections every packet carries after its H1, in this order. */
export const PACKET_SECTIONS = Object.freeze([
  "Why", "Repository and base", "Objective", "Validation", "Forbidden", "Stop rule", "Output", "After the fold",
] as const);

/** The fields the Repository and base section must carry. */
export const PACKET_FIELDS = Object.freeze(["Branch", "Depends on", "Env", "Tier", "Write set"] as const);

/** The roles a brief is written for. */
export const BRIEF_ROLES = Object.freeze(["exec", "fix", "blind", "final", "delta"] as const);
export type BriefRole = (typeof BRIEF_ROLES)[number];

/** A placeholder `clossys unit new` writes; lint refuses a packet that still holds one. */
export const FILL = "<<fill:";

/** `# <ID>: <title> (<tier>, gate: yes|no)`. */
const H1 = /^#\s+([A-Za-z0-9][A-Za-z0-9._-]*):\s+(.+?)\s+\((low|mid|high),\s*gate:\s*(yes|no)\)\s*$/i;
/** A unit branch: one git ref, `claude/<name>` shaped, no spaces, no `..`, no trailing slash or `.lock`. */
const BRANCH_REF = /^claude\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const FENCE = /^\s*(```|~~~)/;

export interface LintResult {
  readonly path: string;
  readonly id: string | null;
  /** One line per violation, each naming the missing or malformed section, field or write set. */
  readonly findings: readonly string[];
}

function proseLines(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (!fenced) out.push(line);
  }
  return out;
}

/** Every field name a Repository and base line can carry; a field's value ends where the next one starts. */
const LINE_FIELDS = [...PACKET_FIELDS, "Base", "Repository", "Gate", "Step"];
const FIELD_ON_LINE = new RegExp(`(?:^|(?<=[\\s.;(]))(?:\\*\\*)?(${LINE_FIELDS.map(name => name.replace(/ /g, "\\s+")).join("|")})(?:\\*\\*)?:`, "gi");
const canonical = (name: string) => LINE_FIELDS.find(field => field.toLowerCase() === name.replace(/\s+/g, " ").toLowerCase())!;

/** The text after `<name>:` up to the next schema field on the same line, or the end of the line; one entry per occurrence. */
function fieldValues(lines: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const hits = [...line.matchAll(FIELD_ON_LINE)];
    hits.forEach((hit, index) => {
      if (canonical(hit[1]!) !== name) return;
      const end = hits[index + 1]?.index ?? line.length;
      out.push(line.slice(hit.index! + hit[0].length, end).trim().replace(/[.;]+$/, "").trim());
    });
  }
  return out;
}

/** The backticked paths or globs of a `Write set:` value. */
export function writeSetPaths(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map(match => match[1]!.trim()).filter(Boolean);
}

/**
 * R-UNIT-PACKET: the H1 carries the tier and gate class; every section of PACKET_SECTIONS is present, once,
 * in order, and not empty; the Repository and base section carries Branch (one backticked `claude/<name>`
 * ref), Depends on, Env, Tier (matching the H1) and a Write set of at least one backticked path; no
 * `<<fill:` placeholder is left. Each violation is one finding that names what is missing or malformed.
 */
export function lintPacket(markdown: string, path: string): LintResult {
  const findings: string[] = [];
  const lines = proseLines(markdown);
  const titleLine = lines.find(line => /^#\s+\S/.test(line));
  let id: string | null = null;
  let titleTier: string | null = null;
  if (!titleLine) findings.push('missing H1: "# <ID>: <title> (<tier>, gate: yes|no)"');
  else {
    const match = H1.exec(titleLine);
    if (!match) findings.push(`malformed H1: ${JSON.stringify(titleLine.trim())} is not "# <ID>: <title> (<tier>, gate: yes|no)"`);
    else { id = match[1]!; titleTier = match[3]!.toLowerCase(); }
  }

  const headings: { name: string; index: number }[] = [];
  lines.forEach((line, index) => { const match = /^##\s+(.+?)\s*$/.exec(line); if (match) headings.push({ name: match[1]!, index }); });
  const bodyOf = (name: string): string[] | null => {
    const at = headings.findIndex(heading => heading.name.toLowerCase() === name.toLowerCase());
    if (at < 0) return null;
    const end = headings[at + 1]?.index ?? lines.length;
    return lines.slice(headings[at]!.index + 1, end);
  };
  let last = -1;
  for (const name of PACKET_SECTIONS) {
    const found = headings.filter(heading => heading.name.toLowerCase() === name.toLowerCase());
    if (found.length === 0) { findings.push(`missing section: ## ${name}`); continue; }
    if (found.length > 1) findings.push(`section listed twice: ## ${name}`);
    const position = headings.indexOf(found[0]!);
    if (position < last) findings.push(`section out of order: ## ${name} comes after ## ${headings[last]!.name}`);
    last = Math.max(last, position);
    if (!bodyOf(name)!.join("\n").trim()) findings.push(`empty section: ## ${name}`);
  }

  const repo = bodyOf("Repository and base");
  if (repo) {
    const values = new Map(PACKET_FIELDS.map(name => [name, fieldValues(repo, name)] as const));
    for (const name of PACKET_FIELDS) {
      const found = values.get(name)!;
      if (found.length === 0) {
        findings.push(name === "Write set"
          ? "missing write set: a `Write set:` field listing the backticked paths or globs the unit may write"
          : `missing field: ${name}:`);
        continue;
      }
      if (found.length > 1) findings.push(`field listed twice: ${name}:`);
      if (!found[0]) findings.push(`empty field: ${name}:`);
    }
    const branch = values.get("Branch")![0];
    if (branch) {
      const refs = [...branch.matchAll(/`([^`]*)`/g)].map(match => match[1]!);
      const rest = branch.replace(/`[^`]*`/g, "").trim();
      if (refs.length !== 1 || rest !== "" || !BRANCH_REF.test(refs[0]!) || /\.\.|\.lock$|\/$/.test(refs[0]!)) {
        findings.push(`malformed branch line: Branch: ${JSON.stringify(branch)} is not one backticked \`claude/<name>\` ref`);
      }
    }
    const writeSet = values.get("Write set")![0];
    if (writeSet && !writeSet.includes(FILL) && writeSetPaths(writeSet).length === 0) {
      findings.push("missing write set: `Write set:` lists no backticked path or glob");
    }
    const tier = values.get("Tier")![0];
    if (tier && !tier.includes(FILL)) {
      const value = tier.replace(/[*`]/g, "").trim().split(/[\s.,;(]/)[0]!.toLowerCase();
      if (!["low", "mid", "high"].includes(value)) findings.push(`malformed field: Tier: ${JSON.stringify(tier)} is not low, mid or high`);
      else if (titleTier && value !== titleTier) findings.push(`Tier: ${value} contradicts the H1 tier ${titleTier}`);
    }
  }

  // The fields the env and tier rules read share one reader (CP1-PLANNERRUN): a malformed Env or Tier is named the same way.
  if (!markdown.includes(FILL)) {
    try { readPacket(markdown, path); } catch (error) {
      if (!(error instanceof UnitRefusal)) throw error;
      findings.push(`${error.rule}: ${error.message.replace(`${path}: `, "")}`);
    }
  }
  const unfilled = lines.filter(line => line.includes(FILL)).length;
  if (unfilled) findings.push(`unfilled skeleton: ${unfilled} line(s) still hold a ${FILL} ...>> placeholder`);
  return { path, id, findings };
}

/** The skeleton `clossys unit new <id>` writes: every section and field, each value a placeholder lint refuses. */
export function packetSkeleton(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new UnitReadError(`unit new: ${JSON.stringify(id)} is not a unit id (letters, digits, ".", "_" and "-")`);
  const fill = (what: string) => `${FILL} ${what}>>`;
  return [
    `# ${id}: ${fill("one-line outcome")} (mid, gate: no)`,
    "",
    "## Why",
    `- ${fill("the owner ask or gap this unit closes")}`,
    "",
    "## Repository and base",
    `- Repository: ${fill("owner/name")}. Base: ${fill("`<base branch>` or a commit")}. Branch: \`claude/${id.toLowerCase()}\`.`,
    `- Depends on: ${fill("the units this one waits for, or none")}.`,
    "- Env: cloud.",
    "- Tier: mid.",
    `- Write set: ${fill("the backticked paths or globs this unit may write")}.`,
    "",
    "## Objective",
    `- ${fill("one behaviour per item")}`,
    "",
    "## Validation",
    `- ${fill("the commands and named tests that prove it, each with its exit code")}`,
    "",
    "## Forbidden",
    `- ${fill("what the unit must not touch")}`,
    "",
    "## Stop rule",
    "- BLOCKED after the same error twice, and at once on a permission refusal.",
    "",
    "## Output",
    "- The unit branch and its `-report` branch pushed. The last line of the report is DONE or BLOCKED.",
    "",
    "## After the fold",
    `- ${fill("what the planner does once this unit folds")}`,
    "",
  ].join("\n");
}

/** One registry row as brief reads it. */
export interface RuleRow {
  readonly id: string;
  readonly owner_agent: string;
  readonly scope: readonly BriefRole[];
  readonly quote: string;
  readonly note: string | null;
}

/** The registry's rule rows with their role scope; a row with no `scope` applies to no brief role. */
export function readRuleRows(text: string, path: string): RuleRow[] {
  let doc: { rules?: unknown };
  try { doc = JSON.parse(text) as { rules?: unknown }; } catch { throw new UnitReadError(`the rule registry at ${path} is not JSON`); }
  if (!Array.isArray(doc.rules)) throw new UnitReadError(`the rule registry at ${path} has no rules list`);
  return doc.rules.map((row: Record<string, unknown>) => {
    const scope = row.scope === undefined ? [] : row.scope;
    if (!Array.isArray(scope) || scope.some(role => !(BRIEF_ROLES as readonly unknown[]).includes(role))) {
      throw new UnitReadError(`${path}: ${String(row.id)} has a scope that is not a list of ${BRIEF_ROLES.join(", ")}`);
    }
    const words = row.owner_words as { quote?: unknown } | undefined;
    return {
      id: String(row.id), owner_agent: String(row.owner_agent), scope: scope as BriefRole[],
      quote: typeof words?.quote === "string" ? words.quote : "", note: typeof row.note === "string" ? row.note : null,
    };
  });
}

/** The rules that apply to `role`: the rows whose scope names it, in registry order. */
export function rulesForRole(rows: readonly RuleRow[], role: BriefRole): RuleRow[] {
  return rows.filter(row => row.scope.includes(role));
}

export const ROLE_TABLE_START = "<!-- unit-roles:start";
export const ROLE_TABLE_END = "<!-- unit-roles:end -->";

/** The role templates between the unit-roles markers of the Planner skill: `| role | template |` rows. */
export function readRoleTemplates(skill: string, path: string): ReadonlyMap<BriefRole, string> {
  const start = skill.indexOf(ROLE_TABLE_START);
  const open = start < 0 ? -1 : skill.indexOf("-->", start);
  const end = open < 0 ? -1 : skill.indexOf(ROLE_TABLE_END, open);
  if (end < 0) throw new UnitReadError(`${path} has no role table (${ROLE_TABLE_START} ... ${ROLE_TABLE_END})`);
  const out = new Map<BriefRole, string>();
  for (const line of skill.slice(open + 3, end).split("\n").map(item => item.trim()).filter(Boolean)) {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
    if (cells.length !== 2) throw new UnitReadError(`${path}: a role table row is not "| role | template |": ${line}`);
    const [role, template] = cells as [string, string];
    if (role === "role" || /^-+$/.test(role)) continue;
    if (!(BRIEF_ROLES as readonly string[]).includes(role)) throw new UnitReadError(`${path}: role table row names ${JSON.stringify(role)}, not one of ${BRIEF_ROLES.join(", ")}`);
    if (out.has(role as BriefRole)) throw new UnitReadError(`${path}: the role table lists ${role} twice`);
    out.set(role as BriefRole, template);
  }
  const missing = BRIEF_ROLES.filter(role => !out.has(role));
  if (missing.length) throw new UnitReadError(`${path}: the role table has no template for ${missing.join(", ")}`);
  return out;
}

/** The brief for one role: its template, the packet (local paths withheld) and every rule scoped to the role. */
export function packetBrief(input: { role: BriefRole; template: string; markdown: string; rules: readonly RuleRow[] }): string {
  const rules = rulesForRole(input.rules, input.role);
  return [
    `# Brief: ${input.role}`,
    "",
    input.template,
    "",
    `## Rules for ${input.role}`,
    "",
    ...(rules.length ? rules.map(rule => `- ${rule.id} (owner_agent: ${rule.owner_agent}): "${rule.quote}"${rule.note ? ` ${rule.note}` : ""}`) : ["- none scoped to this role in the rule registry"]),
    "",
    "## Packet",
    "",
    withholdLocalPaths(input.markdown).trimEnd(),
    "",
  ].join("\n");
}
