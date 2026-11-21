/**
 * Write guards (slot-constitution.md sections 4-6): a write verb runs the constitution's own check
 * functions, filtered by each check's rules.json `guard` list, on the records it is about to write,
 * and refuses on any finding whatever the check's status. The guard is absolute: it never compares
 * the tree before and after the write, so a finding the write's records already carried refuses too.
 *
 * The verbs call this from the one writer (records/slot-write.ts) after the records and their ledger
 * event are in place and before the slot lock is released; a refusal undoes the write.
 *
 * Per-slot (INLINE-GATES, foundry-feedback-0018): the context is focused on the targets
 * (ConstitutionContext.focus), so the per-candidate checks judge only the one candidate being written
 * and R20 judges it before it is pinned; rows on other slots never refuse (the delta model). Every
 * refusal line ends with the check's one-line fix (rules.json `fix`). Pure and mechanical: no model,
 * network, clock or randomness; R05 certification is cached by (candidate, standard, contract, pin set).
 *
 * For an adopt (a Designer candidate the ladder or its lineage says is byte-exact) and for a
 * composition at any rung (a crafted section or frame that places only stock parts) the Designer's
 * ref-verbatim gate (`@clossys/designer/ref-verbatim`) runs too, on submit, pin, pick and reissue.
 * It is the Designer's own check with its own codes, not a rules.json check, so its verb list and fix
 * line live here (REF_VERBATIM_GUARD).
 */
import { dirname } from "node:path";
import { byteExactAdoption, checkRegistryItem } from "@clossys/designer/ref-verbatim";
import { rungKind } from "../pipeline/candidate-ladder.js";
import { buildContext, refreshContext, type ContextOptions } from "./context.js";
import { fixHint, REF_VERBATIM_FIX, REF_VERBATIM_ID } from "./fix.js";
import { registeredRules, type RegisteredRule } from "./registry.js";
import { submitOf } from "./rules/r03.js";
import { slotDoc } from "./checks/shared.js";
import { registerGuardRunner } from "../records/slot-write.js";
import { sourceKindOf } from "../records/source-kind.js";
import type { Check, ConstitutionContext, Row, RuleId } from "./types.js";

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
  /**
   * Run the Designer ref-verbatim gate on adopt targets. Default: on with the real registry, off
   * when `rules` injects one (a test's registry is its whole guard); pass true to run it with an
   * injected registry.
   */
  readonly refVerbatim?: boolean;
  /**
   * One run's guard session (U29c): the context the run's last passing guard (or its pin gate, pin-gate.ts) read.
   * A guard given one re-reads only its targets' slot folders and the agent-level files (refreshContext), not the
   * whole tree; the caller states that nothing else under `<consumer>/agents` was written since, which holds for a
   * run whose writes are its targets' folders under their slot locks (`clossys pin`, `clossys migrate slots`).
   * The rows judged are the same rows a fresh read gives (guard-session.test.ts). A refusal, or a check that throws,
   * clears it.
   */
  readonly session?: GuardSession;
}

/** The context a run's guards carry from one guarded write to the next (GuardOptions.session). */
export interface GuardSession { context?: ConstitutionContext }

/** The Designer ref-verbatim gate as a guard: the verbs it runs on and the fix its refusals print (fix.ts). */
export const REF_VERBATIM_GUARD = { id: REF_VERBATIM_ID, verbs: ["submit", "pin", "pick", "reissue"] as readonly GuardVerb[], fix: REF_VERBATIM_FIX } as const;

/** Why a target Designer candidate is an adopt (its submit's ladder rung, or its lineage), or undefined. */
export function adoptOf(ctx: ConstitutionContext, target: GuardTarget): string | undefined {
  if (target.agent !== "designer" || !target.candidate?.endsWith(".json")) return undefined;
  const slot = ctx.agents.find(agent => agent.agent === "designer")?.slots.get(target.slot);
  const candidate = slot?.candidates.find(each => each.name === target.candidate);
  if (!slot || !candidate) return undefined;
  const { submit } = submitOf(slot, candidate.name);
  if (submit && typeof submit.rung === "string" && rungKind("designer", submit.rung) === "adopt") return `ladder rung ${submit.rung}`;
  return candidate.json === undefined ? undefined : byteExactAdoption(slot.id, candidate.json);
}

/**
 * Why the ref-verbatim gate judges a target Designer candidate, or undefined: an adopt (adoptOf), else composition
 * lineage at any rung. A crafted composition (create.app-section, create.frame) is held to the gate's composition
 * rule, so every part is stock, every import a declared part and no raw markup is styled, whatever its rung.
 */
export function refVerbatimOf(ctx: ConstitutionContext, target: GuardTarget): { readonly label: "adopt" | "composition"; readonly why: string } | undefined {
  const adopt = adoptOf(ctx, target);
  if (adopt) return { label: "adopt", why: adopt };
  if (target.agent !== "designer" || !target.candidate?.endsWith(".json")) return undefined;
  const candidate = ctx.agents.find(agent => agent.agent === "designer")?.slots.get(target.slot)?.candidates.find(each => each.name === target.candidate);
  // The one kind reader (records/source-kind.ts sourceKindOf over the candidate's view): next --submit's recipe check reads the same field.
  return sourceKindOf(candidate?.json) === "composition" ? { label: "composition", why: "composition lineage" } : undefined;
}

/** The ref-verbatim rows of the gated targets (adopts and compositions): the Designer gate's strict findings, one row each. */
export function refVerbatimRows(ctx: ConstitutionContext, targets: readonly GuardTarget[]): Row[] {
  const rows: Row[] = [];
  for (const target of targets) {
    const gated = refVerbatimOf(ctx, target);
    if (!gated) continue;
    const slot = ctx.agents.find(agent => agent.agent === "designer")!.slots.get(target.slot)!;
    const candidate = slot.candidates.find(each => each.name === target.candidate)!;
    const base = { rule: "R03" as RuleId, check: REF_VERBATIM_GUARD.id, agent: target.agent, slot: target.slot, candidate: candidate.name, path: candidate.path };
    let findings: readonly { code: string; detail: string; file?: string }[];
    try {
      const doc = slotDoc(slot) as { uses?: readonly string[] } | undefined;
      findings = checkRegistryItem(ctx.consumer, slot.id, candidate.json, { strict: true, ...(doc ? { slotDoc: doc } : {}) }).findings;
    } catch (error) { findings = [{ code: "REF-NO-SOURCE", detail: `ref-verbatim could not run: ${error instanceof Error ? error.message : String(error)}` }]; }
    for (const finding of findings) rows.push({ ...base, reason: `${finding.code} ${finding.detail}${finding.file ? ` (${finding.file})` : ""} [${gated.label}: ${gated.why}]` });
  }
  return rows;
}

/**
 * Run `verb`'s guarded checks over the tree as it is now (the write's records already in place) and
 * return the rows about the targets' records. A check that throws is a finding on every target: the
 * guard fails closed.
 */
export function runGuard(consumer: string, verb: GuardVerb, targets: readonly GuardTarget[], options: GuardOptions = {}): Row[] {
  const checks = guardChecks(verb, options.rules);
  const refVerbatim = (options.refVerbatim ?? options.rules === undefined) && REF_VERBATIM_GUARD.verbs.includes(verb);
  const { session } = options;
  const prior = session?.context;
  if (session) delete session.context;
  if ((!checks.length && !refVerbatim) || !targets.length) return [];
  const focus = targets.map(target => ({ agent: target.agent, slot: target.slot, ...(target.candidate ? { candidate: target.candidate } : {}) }));
  const root = options.root ?? dirname(consumer);
  const ctx = prior && prior.root === root && prior.consumer === consumer
    ? refreshContext(prior, targets, { ...options, focus })
    : buildContext(root, consumer, { ...options, focus });
  const rows: Row[] = refVerbatim ? refVerbatimRows(ctx, targets) : [];
  for (const check of checks) {
    let found: Row[];
    try { found = check.fn(ctx); }
    catch (error) {
      const reason = `guard check threw: ${error instanceof Error ? error.message : String(error)}`;
      found = targets.map(target => ({ rule: check.rule, check: check.id, agent: target.agent, slot: target.slot, ...(target.candidate ? { candidate: target.candidate } : {}), reason, path: target.records?.[0] ?? `${target.agent}/${target.slot}` }));
    }
    rows.push(...targetRows(found.map(row => ({ ...row, check: row.check || check.id })), targets));
  }
  if (session && !rows.length) session.context = ctx;
  return rows;
}

/** The refusal lines of guard rows: `<check> <reason> (<path>); fix: <one line>`. */
export const guardMessages = (rows: readonly Row[]): string[] => rows.map(row => `${row.check} ${row.reason} (${row.path}); fix: ${fixHint(row.check)}`);

// The writers in records/slot-write.ts run this guard; they hold no value import of the registry.
registerGuardRunner({ run: runGuard, messages: guardMessages });
