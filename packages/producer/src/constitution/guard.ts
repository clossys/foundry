/**
 * Write guards (slot-constitution.md sections 4-6): a write verb runs the constitution's own check
 * functions, filtered by each check's rules.json `guard` list, on the records it is about to write,
 * and refuses on any finding whatever the check's status. The guard is absolute: it never compares
 * the tree before and after the write, so a finding the write's records already carried refuses too.
 *
 * The verbs call this from the one writer (records/slot-write.ts) after the records and their ledger
 * event are in place and before the slot lock is released; a refusal undoes the write.
 */
import { dirname } from "node:path";
import { buildContext, type ContextOptions } from "./context.js";
import { registeredRules, type RegisteredRule } from "./registry.js";
import { registerGuardRunner } from "../records/slot-write.js";
import type { Check, Row, RuleId } from "./types.js";

/** The verbs a rules.json `guard` list may name: the ledger verb table plus `reject` (section 6). */
export const GUARD_VERBS = ["submit", "options", "verdict", "pick", "pin", "retire", "reissue", "ia", "migrate", "standard", "critique", "request", "task", "triage", "reject"] as const;
export type GuardVerb = (typeof GUARD_VERBS)[number];

/** One guarded check: its rule, id and function. */
export interface GuardCheck { readonly rule: RuleId; readonly id: string; readonly fn: Check }

/** The checks guarding `verb`, in rules.json order: every check whose `guard` lists it, whatever its status. */
export function guardChecks(verb: GuardVerb, rules: readonly RegisteredRule[] = registeredRules()): GuardCheck[] {
  return rules.flatMap(rule => rule.run.filter(check => check.guard.includes(verb)).map(check => ({ rule: rule.id, id: check.id, fn: check.fn })));
}
/** The check ids guarding `verb`, in rules.json order. */
export const guardCheckIds = (verb: GuardVerb, rules?: readonly RegisteredRule[]): string[] => guardChecks(verb, rules).map(check => check.id);

/** Issues with the registry's guard lists: a verb outside GUARD_VERBS, or a check with no `guard` list. */
export function guardListIssues(rules: readonly RegisteredRule[] = registeredRules()): string[] {
  const issues: string[] = [];
  for (const rule of rules) for (const check of rule.checks) {
    if (!Array.isArray(check.guard)) { issues.push(`${check.id} has no guard list`); continue; }
    for (const verb of check.guard) if (!(GUARD_VERBS as readonly string[]).includes(verb)) issues.push(`${check.id} guard names ${verb}, not a write verb (${GUARD_VERBS.join(", ")})`);
  }
  return issues;
}

/**
 * What one write puts on disk, as the rows name it: the slot, the candidate file it adds or pins
 * (every row about that candidate refuses), and the record files it replaces, workspace-relative
 * (`clossys/agents/<agent>/<slot>/pin.json`; every slot-level row on one of them refuses).
 */
export interface GuardTarget {
  readonly agent: string;
  readonly slot: string;
  readonly candidate?: string;
  readonly records?: readonly string[];
}

/** The rows that are about a target's records. Pending stubs and workspace-wide (`*`) rows are not. */
export function targetRows(rows: readonly Row[], targets: readonly GuardTarget[]): Row[] {
  return rows.filter(row => !row.pending && targets.some(target => row.agent === target.agent && row.slot === target.slot
    && ((target.candidate !== undefined && row.candidate === target.candidate) || (row.candidate === undefined && (target.records ?? []).includes(row.path)))));
}

export interface GuardOptions extends ContextOptions {
  /** Workspace root the rows are relative to; defaults to the consumer's parent (`<root>/clossys`). */
  readonly root?: string;
  /** The registry; defaults to rules.json joined to the rule modules. */
  readonly rules?: readonly RegisteredRule[];
}

/**
 * Run `verb`'s guarded checks over the tree as it is now (the write's records already in place) and
 * return the rows about the targets' records. A check that throws is a finding on every target: the
 * guard fails closed.
 */
export function runGuard(consumer: string, verb: GuardVerb, targets: readonly GuardTarget[], options: GuardOptions = {}): Row[] {
  const checks = guardChecks(verb, options.rules);
  if (!checks.length || !targets.length) return [];
  const ctx = buildContext(options.root ?? dirname(consumer), consumer, options);
  const rows: Row[] = [];
  for (const check of checks) {
    let found: Row[];
    try { found = check.fn(ctx); }
    catch (error) {
      const reason = `guard check threw: ${error instanceof Error ? error.message : String(error)}`;
      found = targets.map(target => ({ rule: check.rule, check: check.id, agent: target.agent, slot: target.slot, ...(target.candidate ? { candidate: target.candidate } : {}), reason, path: target.records?.[0] ?? `${target.agent}/${target.slot}` }));
    }
    rows.push(...targetRows(found.map(row => ({ ...row, check: row.check || check.id })), targets));
  }
  return rows;
}

/** The refusal lines of guard rows: `<check> <reason> (<path>)`. */
export const guardMessages = (rows: readonly Row[]): string[] => rows.map(row => `${row.check} ${row.reason} (${row.path})`);

// The writers in records/slot-write.ts run this guard; they hold no value import of the registry.
registerGuardRunner({ run: runGuard, messages: guardMessages });
