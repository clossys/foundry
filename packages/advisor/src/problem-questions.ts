import { CLIENT_PROBLEMS } from "./client-problems.js";
import type { ClientProblem } from "./client-problems.js";

/**
 * Problem confirmation cards (issue #1176, owner comment "De-risking
 * dynamic composition", 2026-09-22), reusing the same card pattern as
 * context-questions.ts's `nextContextQuestion()`/`applyContextChoice()`
 * and sponsor-questions.ts before it: the client confirms a PROBLEM,
 * never picks a package. Advisor offers one candidate problem at a time
 * from this repository's client problem vocabulary; the client's answer never
 * invents a value the client did not choose.
 */
export interface ProblemQuestionChoice {
  id: "confirmed" | "declined" | "unknown" | "something-else";
  label: string;
}

export interface ProblemQuestionCard {
  prompt: string;
  problemId: string;
  statement: string;
  choices: readonly ProblemQuestionChoice[];
  somethingElseFollowUp: string;
}

export type ProblemConfirmationState = "confirmed" | "declined" | "unknown";

export interface ProblemConfirmation {
  id: string;
  state: ProblemConfirmationState;
}

export type ProblemChoiceApplyResult =
  | { kind: "confirmed" }
  | { kind: "declined" }
  | { kind: "unknown" }
  | { kind: "something-else" }
  | { kind: "unknown-choice" };

const CHOICES: readonly ProblemQuestionChoice[] = [
  { id: "confirmed", label: "Yes, that's us." },
  { id: "declined", label: "No, not really." },
  { id: "unknown", label: "Not sure." },
  { id: "something-else", label: "Something else." },
];

const SOMETHING_ELSE_FOLLOW_UP = "Say it in one sentence.";

function cardFor(problem: ClientProblem): ProblemQuestionCard {
  return { prompt: "Does this sound like you?", problemId: problem.id, statement: problem.statement, choices: CHOICES, somethingElseFollowUp: SOMETHING_ELSE_FOLLOW_UP };
}

/**
 * Returns the next candidate problem card the client has not yet answered,
 * in this repository's client problem vocabulary order, or null once every
 * candidate has a confirmation recorded. The skill decides when enough
 * problems are confirmed to compose from — this engine only tracks what
 * has and has not been asked.
 */
export function nextProblemQuestion(confirmations: readonly ProblemConfirmation[]): ProblemQuestionCard | null {
  const answered = new Map(confirmations.map((item) => [item.id, item.state]));
  for (const problem of CLIENT_PROBLEMS) {
    const state = answered.get(problem.id);
    if (!state || state === "unknown") return cardFor(problem);
  }
  return null;
}

/**
 * Maps a chosen choice id to the outcome. "unknown" and "something-else"
 * never invent a confirmation: the caller records nothing beyond
 * `unknown`, or separately captures the client's freeform answer as
 * evidence, exactly as `applyContextChoice`'s "something-else" does.
 */
export function applyProblemChoice(choiceId: string): ProblemChoiceApplyResult {
  if (choiceId === "confirmed") return { kind: "confirmed" };
  if (choiceId === "declined") return { kind: "declined" };
  if (choiceId === "unknown") return { kind: "unknown" };
  if (choiceId === "something-else") return { kind: "something-else" };
  return { kind: "unknown-choice" };
}
