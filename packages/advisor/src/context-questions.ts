import { ENGAGEMENT_CONTEXT_FIELD_IDS, fieldById } from "./context.js";
import type { EngagementContext, EngagementContextFieldId } from "./context.js";

/**
 * Founder-facing context question cards (issue #1173), extending the same
 * card pattern as sponsor-questions.ts's `nextSponsorQuestion()` /
 * `applySponsorChoice()`: one unknown field at a time, a short fixed
 * choice list with the recommended option first, an explicit "not sure
 * yet" that keeps the field honestly unknown, and "something else" for
 * anything the fixed choices do not cover. Only questions a non-technical
 * founder can answer; technical facts are never asked here.
 */
export interface ContextQuestionChoice {
  id: string;
  label: string;
}

export interface ContextQuestionCard {
  prompt: string;
  fieldId: EngagementContextFieldId;
  choices: readonly ContextQuestionChoice[];
  /** Short follow-up when the founder picks something else; not a stored slug. */
  somethingElseFollowUp: string;
}

export type ContextChoiceApplyResult =
  | { kind: "known"; value: string }
  | { kind: "unknown" }
  | { kind: "something-else" }
  | { kind: "unknown-choice" };

const UNKNOWN_ID = "unknown";
const SOMETHING_ELSE_ID = "something-else";
const SOMETHING_ELSE_FOLLOW_UP = "Say it in one sentence.";

const PROMPTS: Record<EngagementContextFieldId, string> = {
  business: "What kind of business is this?",
  product: "What are you offering?",
  audience: "Who is it for?",
  stage: "Where are things today?",
  intent: "What do you want right now?",
  constraints: "Anything limiting what's possible right now?",
};

const CHOICES: Record<EngagementContextFieldId, readonly ContextQuestionChoice[]> = {
  business: [
    { id: "product-or-service", label: "A product or service business." },
    { id: "agency-or-services", label: "An agency, studio, or consultancy." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
  product: [
    { id: "software", label: "Software — an app, site, or platform." },
    { id: "physical-or-in-person", label: "A physical product or in-person service." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
  audience: [
    { id: "consumers", label: "Everyday consumers (B2C)." },
    { id: "businesses", label: "Other businesses (B2B)." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
  stage: [
    { id: "building", label: "Building or about to launch the first version." },
    { id: "established", label: "Already launched and operating." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
  intent: [
    { id: "validate", label: "Find out if this is worth doing." },
    { id: "grow", label: "Get more reach or revenue from what already works." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
  constraints: [
    { id: "none-known", label: "Nothing in particular." },
    { id: "tight-budget-or-time", label: "Tight budget or time." },
    { id: UNKNOWN_ID, label: "Not sure yet." },
    { id: SOMETHING_ELSE_ID, label: "Something else." },
  ],
};

function cardFor(fieldId: EngagementContextFieldId): ContextQuestionCard {
  return { prompt: PROMPTS[fieldId], fieldId, choices: CHOICES[fieldId], somethingElseFollowUp: SOMETHING_ELSE_FOLLOW_UP };
}

/** Returns the first unanswered context field's card, in the fixed field order, or null once every field is known. */
export function nextContextQuestion(context: Pick<EngagementContext, "fields">): ContextQuestionCard | null {
  for (const fieldId of ENGAGEMENT_CONTEXT_FIELD_IDS) {
    const field = fieldById(context, fieldId);
    if (!field || field.state === "unknown") return cardFor(fieldId);
  }
  return null;
}

/**
 * Maps a chosen choice id to the field outcome. Choosing "unknown" or
 * "something-else" never invents a value: the field stays unknown until a
 * caller separately records the founder's freeform answer as evidence,
 * exactly as `applySponsorChoice`'s "something-else" leaves fit/readiness
 * state to the caller.
 */
export function applyContextChoice(fieldId: EngagementContextFieldId, choiceId: string): ContextChoiceApplyResult {
  if (choiceId === SOMETHING_ELSE_ID) return { kind: "something-else" };
  if (choiceId === UNKNOWN_ID) return { kind: "unknown" };
  const known = CHOICES[fieldId]?.some((choice) => choice.id === choiceId);
  if (!known) return { kind: "unknown-choice" };
  return { kind: "known", value: choiceId };
}
