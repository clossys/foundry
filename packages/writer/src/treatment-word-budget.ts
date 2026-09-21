/**
 * Treatment-level word budgets for registry entries — display headings,
 * eyebrows, button labels, and other short treatments that are not body
 * measure. Pure gate: takes an already-validated `CopyRegistry`, never I/O.
 */

import type { CopyEntryId, CopyRegistry, CopyRegistryEntry } from "./types.js";

/** Known slot treatments with a default maximum word count when the entry omits `maxWords`. */
export const DEFAULT_TREATMENT_WORD_BUDGETS: Readonly<Record<string, number>> = {
  "display-heading": 12,
  eyebrow: 8,
  button: 6,
};

export type TreatmentWordBudgetRule = "word-budget-exceeded" | "unknown-treatment";

export interface TreatmentWordBudgetFinding {
  rule: TreatmentWordBudgetRule;
  severity: "error";
  entryId: CopyEntryId;
  treatment: string;
  maxWords: number;
  actualWords: number;
  message: string;
}

export interface TreatmentWordBudgetResult {
  entriesChecked: number;
  findings: TreatmentWordBudgetFinding[];
}

/** Counts words in resolved copy text (whitespace-separated tokens). */
export function countCopyWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

function budgetForEntry(entry: CopyRegistryEntry): { treatment: string; maxWords: number } | undefined {
  const treatment = entry.treatment;
  if (typeof treatment !== "string" || treatment.trim().length === 0) return undefined;
  const normalized = treatment.trim();
  if (entry.maxWords !== undefined) {
    if (typeof entry.maxWords !== "number" || !Number.isFinite(entry.maxWords) || entry.maxWords < 1) {
      return undefined;
    }
    return { treatment: normalized, maxWords: Math.floor(entry.maxWords) };
  }
  const defaultMax = DEFAULT_TREATMENT_WORD_BUDGETS[normalized];
  if (defaultMax === undefined) return undefined;
  return { treatment: normalized, maxWords: defaultMax };
}

/**
 * Fails when an approved entry declares a `treatment` (or `maxWords`) and
 * its `text` exceeds the applicable budget. Draft and retired entries are
 * skipped — only copy that can resolve at render is measured.
 */
export function checkTreatmentWordBudgets(registry: CopyRegistry): TreatmentWordBudgetResult {
  const findings: TreatmentWordBudgetFinding[] = [];
  let entriesChecked = 0;

  for (const entry of registry.entries) {
    if (entry.status !== "approved") continue;
    const budget = budgetForEntry(entry);
    if (!budget) {
      if (typeof entry.treatment === "string" && entry.treatment.trim().length > 0) {
        const normalized = entry.treatment.trim();
        if (entry.maxWords === undefined && DEFAULT_TREATMENT_WORD_BUDGETS[normalized] === undefined) {
          findings.push({
            rule: "unknown-treatment",
            severity: "error",
            entryId: entry.id,
            treatment: normalized,
            maxWords: 0,
            actualWords: countCopyWords(entry.text),
            message: `Entry "${entry.id}" declares treatment "${normalized}" with no maxWords and no built-in default — add maxWords or use a known treatment (${Object.keys(DEFAULT_TREATMENT_WORD_BUDGETS).join(", ")}).`,
          });
        }
      }
      continue;
    }
    entriesChecked++;
    const actualWords = countCopyWords(entry.text);
    if (actualWords > budget.maxWords) {
      findings.push({
        rule: "word-budget-exceeded",
        severity: "error",
        entryId: entry.id,
        treatment: budget.treatment,
        maxWords: budget.maxWords,
        actualWords,
        message: `Entry "${entry.id}" (${budget.treatment}) has ${actualWords} word(s) but the budget is ${budget.maxWords}.`,
      });
    }
  }

  return { entriesChecked, findings };
}
