/**
 * Budget-preference card (issue #1219, Advisor side): one question, in
 * the same one-question-at-a-time conversation-contract style as
 * context-questions.ts and problem-questions.ts, asked once and written
 * into `clossys/preferences.json`. The fixed tier names come from
 * #1219's owner decision. Advisor never names a model: the preference is
 * a budget stance only; a host later maps it to models through its own
 * per-host profile (#1219's "tier-to-model profile" layer, owned by
 * Launcher).
 */
export type BudgetPreference = "cost-conscious" | "balanced" | "max-quality";

export interface BudgetPreferenceChoice {
  id: BudgetPreference | "unknown";
  label: string;
}

export interface BudgetPreferenceCard {
  prompt: string;
  choices: readonly BudgetPreferenceChoice[];
}

const UNKNOWN_ID = "unknown";

/** The single budget-preference question card. There is only ever one; unlike the context and problem cards, there is no sequence to step through. */
export const BUDGET_PREFERENCE_CARD: BudgetPreferenceCard = {
  prompt: "How should the team balance cost against quality?",
  choices: [
    { id: "cost-conscious", label: "Keep costs low; use the fastest capable option for each step." },
    { id: "balanced", label: "Balance cost and quality." },
    { id: "max-quality", label: "Prioritize the best quality available, cost aside." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
  ],
};

export type BudgetPreferenceApplyResult = { kind: "known"; value: BudgetPreference } | { kind: "unknown" } | { kind: "unknown-choice" };

/** Maps a chosen choice id to the outcome; never invents a preference the client did not choose. */
export function applyBudgetPreferenceChoice(choiceId: string): BudgetPreferenceApplyResult {
  if (choiceId === UNKNOWN_ID) return { kind: "unknown" };
  const known = BUDGET_PREFERENCE_CARD.choices.find((choice) => choice.id === choiceId && choice.id !== UNKNOWN_ID);
  if (known) return { kind: "known", value: known.id as BudgetPreference };
  return { kind: "unknown-choice" };
}

export interface AdvisorPreferences {
  schemaVersion: 1;
  budget: BudgetPreference | "unknown";
}

/** The exact `clossys/preferences.json` shape for the client's budget stance. */
export function toPreferencesFile(budget: BudgetPreference | "unknown"): AdvisorPreferences {
  return { schemaVersion: 1, budget };
}
