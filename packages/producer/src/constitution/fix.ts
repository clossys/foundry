/**
 * The one-line fix a maker is shown beside a failing check id (INLINE-GATES, foundry-feedback-0018):
 * rules.json `fix` on the check, else its rule's statement. The write guards print it on every
 * refusal line and the `--slot` preflight and `check:changed` on every row. Pure.
 */
import { registeredRules, type RegisteredRule } from "./registry.js";

/** The Designer ref-verbatim gate's id and fix (constitution/guard.ts runs it on adopts). */
export const REF_VERBATIM_ID = "ref-verbatim";
export const REF_VERBATIM_FIX = "copy the vendored reference files unchanged, or submit at the adapt rung and record each adaptation in meta.refVerbatim";

/** Every registered check's one-line fix, plus ref-verbatim's. */
export function fixHints(rules: readonly RegisteredRule[] = registeredRules()): Map<string, string> {
  const hints = new Map<string, string>([[REF_VERBATIM_ID, REF_VERBATIM_FIX]]);
  for (const rule of rules) for (const check of rule.run) hints.set(check.id, check.fix ?? `meet ${rule.id}: ${rule.statement}`);
  return hints;
}

let installed: Map<string, string> | undefined;
/** The one-line fix printed for a check id. */
export const fixHint = (check: string): string => (installed ??= fixHints()).get(check) ?? "see slot-constitution.md for the rule this check enforces";
