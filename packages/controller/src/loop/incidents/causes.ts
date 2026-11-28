/**
 * Known causes as data (causes.json) and the registry check on them: no cause is closed without a
 * guard. A cause is refused when it has no guard, when its guard names no rule in the repository's
 * rule registry or one that is not enforced, when its remedy is neither a function in remedies.ts nor
 * `none`, or when its matcher is not a regular expression. check:rules proves separately that every
 * enforced rule's check fails on its violation fixture, so an enforced guard is a guard that fires.
 */
import { readFileSync } from "node:fs";
import { CAUSES_SCHEMA, type CausesDocument, type IncidentRecord, type KnownCause } from "./types.js";
import { NO_REMEDY } from "./remedies.js";

const CAUSE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const AGENT = /^[a-z][a-z0-9-]*$/;

/** The registry rows a cause's guard is checked against. */
export interface RegistryRow {
  readonly id: string;
  readonly status?: string;
  readonly checks?: readonly string[];
  readonly fixture_runs?: readonly unknown[];
}

export function readCauses(path: string): CausesDocument {
  return JSON.parse(readFileSync(path, "utf8")) as CausesDocument;
}

export function readRegistryRules(path: string): RegistryRow[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as { rules?: RegistryRow[] };
  return Array.isArray(doc.rules) ? doc.rules : [];
}

/** The text a cause's matcher runs over. */
export const matchText = (record: Pick<IncidentRecord, "stage" | "signature">): string => `${record.stage}\n${record.signature}`;

/** The first known cause whose matcher matches the record, in causes.json order. */
export function matchCause(record: Pick<IncidentRecord, "stage" | "signature">, causes: readonly KnownCause[]): KnownCause | undefined {
  const text = matchText(record);
  return causes.find(cause => {
    try { return new RegExp(cause.match, "m").test(text); } catch { return false; }
  });
}

/**
 * Findings for a causes document against the registry: empty when every cause is matchable, owned,
 * remedied by code or `none`, and guarded by an enforced rule.
 */
export function causeFindings(doc: unknown, registry: readonly RegistryRow[], remedies: readonly string[], options: { owners?: (agent: string) => boolean } = {}): string[] {
  const out: string[] = [];
  const causes = (doc as Partial<CausesDocument> | null)?.causes;
  if ((doc as Partial<CausesDocument> | null)?.schema !== CAUSES_SCHEMA) out.push(`causes: schema must be ${CAUSES_SCHEMA}`);
  if (!Array.isArray(causes)) { out.push("causes: expected { causes: [...] }"); return out; }
  const rules = new Map(registry.map(row => [row.id, row]));
  const seen = new Set<string>();
  for (const cause of causes as KnownCause[]) {
    const id = typeof cause?.id === "string" ? cause.id : "(no id)";
    if (!CAUSE_ID.test(id)) out.push(`cause ${id}: id must be kebab-case`);
    if (seen.has(id)) out.push(`cause ${id}: listed twice`);
    seen.add(id);
    try { new RegExp(cause.match, "m"); } catch { out.push(`cause ${id}: match is not a regular expression`); }
    if (typeof cause.owner !== "string" || !AGENT.test(cause.owner)) out.push(`cause ${id}: owner must name an agent package`);
    else if (options.owners && !options.owners(cause.owner)) out.push(`cause ${id}: owner ${cause.owner} is not a package`);
    if (typeof cause.blocker !== "string" || cause.blocker.trim() === "") out.push(`cause ${id}: blocker must say what blocks the step`);
    if (typeof cause.remedy !== "string" || (cause.remedy !== NO_REMEDY && !remedies.includes(cause.remedy))) {
      out.push(`cause ${id}: remedy ${String(cause.remedy)} is not a function in code (remedies.ts) or ${NO_REMEDY}`);
    }
    if (typeof cause.guard !== "string" || cause.guard.trim() === "") {
      out.push(`cause ${id} has no guard: no cause is closed without a guard (a rule in scripts/rules/registry.json whose check fails on its violation fixture)`);
      continue;
    }
    const rule = rules.get(cause.guard);
    if (!rule) out.push(`cause ${id}: guard ${cause.guard} is not a rule in scripts/rules/registry.json`);
    else if (rule.status !== "enforced" || !(rule.checks ?? []).length || !(rule.fixture_runs ?? []).length) {
      out.push(`cause ${id}: guard ${cause.guard} is not enforced by a check with a violation fixture`);
    }
    if (typeof cause.guard_landed !== "string" || Number.isNaN(Date.parse(cause.guard_landed))) out.push(`cause ${id}: guard_landed must be an ISO 8601 time`);
  }
  return out;
}
