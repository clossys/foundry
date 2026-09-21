import { REQUIRED_FIT_CRITERIA, REQUIRED_READINESS_CRITERIA } from "./assessment.js";
import type {
  AdvisorAssessmentInput,
  FitSignal,
  ReadinessCriterion,
  ReadinessState,
  RequiredFitCriterionId,
  RequiredReadinessCriterionId,
  SignalState,
} from "./types.js";

export interface SponsorQuestionChoice {
  id: string;
  label: string;
}

/** One founder-facing multiple-choice card for a single fit or readiness criterion. */
export interface SponsorQuestionCard {
  prompt: string;
  criterionId: RequiredFitCriterionId | RequiredReadinessCriterionId;
  choices: readonly SponsorQuestionChoice[];
  /** Short follow-up when the sponsor picks something else; not a stored slug. */
  somethingElseFollowUp: string;
}

export type SponsorQuestionInput = Pick<AdvisorAssessmentInput, "fitSignals" | "prerequisiteObservations">;

export type SponsorChoiceApplyResult =
  | { kind: "fit"; state: SignalState }
  | { kind: "readiness"; state: ReadinessState }
  | { kind: "something-else" }
  | { kind: "unknown-choice" };

const SOMETHING_ELSE_ID = "something-else";

const FIT_CHOICES: readonly SponsorQuestionChoice[] = [
  { id: "supported", label: "The evidence supports this." },
  { id: "contradicted", label: "The evidence contradicts this." },
  { id: "unknown", label: "There is not enough evidence yet." },
  { id: SOMETHING_ELSE_ID, label: "Something else." },
];

const READINESS_CHOICES: readonly SponsorQuestionChoice[] = [
  { id: "satisfied", label: "This requirement is met." },
  { id: "violated", label: "Something recorded blocks this." },
  { id: "unknown", label: "There is not enough evidence yet." },
  { id: SOMETHING_ELSE_ID, label: "Something else." },
];

const SOMETHING_ELSE_FOLLOW_UP = "Say it in one sentence.";

/** Founder-facing card prompts; criterion ids remain the machine vocabulary. */
const FOUNDER_FIT_PROMPTS: Record<RequiredFitCriterionId, string> = {
  "sponsor-mandate": "Who can say yes to this work?",
  "material-need": "What is going wrong now that this would change?",
  "offering-operating-compatibility": "Does this way of working fit how you already operate?",
  "expected-value-burden": "Is the gain worth the time and attention it will take?",
  "adoption-capacity": "Who will keep this going after the first week?",
  "legal-ethical-safety": "Is there a legal, ethical, or safety reason to stop?",
};

const FOUNDER_READINESS_PROMPTS: Record<RequiredReadinessCriterionId, string> = {
  "scope-repository-inventory": "Which repositories and surfaces are in play?",
  "read-access": "Can we actually read the work we would judge?",
  "authority-approval": "Who can approve a change in those places?",
  "initiative-mutation-dependency-inventory": "What else is moving in the same places?",
  "immutable-artifact-access": "Can we pin the exact package we would install?",
  baseline: "Do we have a starting number for the thing we want to change?",
  "independent-outcome-owner": "Who other than the doer will say if it worked?",
  "rollback-review-window": "If this goes wrong, how do we undo it, and by when do we look?",
};

const fitIds = new Set(REQUIRED_FIT_CRITERIA.map((criterion) => criterion.id));
const readinessIds = new Set(REQUIRED_READINESS_CRITERIA.map((criterion) => criterion.id));

function fitCard(criterionId: RequiredFitCriterionId): SponsorQuestionCard {
  return { prompt: FOUNDER_FIT_PROMPTS[criterionId], criterionId, choices: FIT_CHOICES, somethingElseFollowUp: SOMETHING_ELSE_FOLLOW_UP };
}

function readinessCard(criterionId: RequiredReadinessCriterionId): SponsorQuestionCard {
  return {
    prompt: FOUNDER_READINESS_PROMPTS[criterionId],
    criterionId,
    choices: READINESS_CHOICES,
    somethingElseFollowUp: SOMETHING_ELSE_FOLLOW_UP,
  };
}

const fitCards = new Map(REQUIRED_FIT_CRITERIA.map((criterion) => [criterion.id, fitCard(criterion.id as RequiredFitCriterionId)]));
const readinessCards = new Map(
  REQUIRED_READINESS_CRITERIA.map((criterion) => [criterion.id, readinessCard(criterion.id as RequiredReadinessCriterionId)]),
);

function signalById(signals: readonly FitSignal[], id: string): FitSignal | undefined {
  return signals.find((signal) => signal.id === id);
}

function observationById(observations: readonly ReadinessCriterion[], id: string): ReadinessCriterion | undefined {
  return observations.find((observation) => observation.id === id);
}

/** Returns the first unknown fit criterion card, then the first unknown readiness card, otherwise null. */
export function nextSponsorQuestion(input: SponsorQuestionInput): SponsorQuestionCard | null {
  for (const criterion of REQUIRED_FIT_CRITERIA) {
    const signal = signalById(input.fitSignals, criterion.id);
    if (!signal || signal.state === "unknown") return fitCards.get(criterion.id) ?? null;
  }
  for (const criterion of REQUIRED_READINESS_CRITERIA) {
    const observation = observationById(input.prerequisiteObservations, criterion.id);
    if (!observation || observation.state === "unknown") return readinessCards.get(criterion.id) ?? null;
  }
  return null;
}

/** Maps a known choice to engine state; something-else and unknown choice ids are distinct outcomes. */
export function applySponsorChoice(criterionId: string, choiceId: string): SponsorChoiceApplyResult {
  if (choiceId === SOMETHING_ELSE_ID) return { kind: "something-else" };
  if (fitIds.has(criterionId)) {
    if (choiceId === "supported" || choiceId === "contradicted" || choiceId === "unknown") {
      return { kind: "fit", state: choiceId };
    }
    return { kind: "unknown-choice" };
  }
  if (readinessIds.has(criterionId)) {
    if (choiceId === "satisfied" || choiceId === "violated" || choiceId === "unknown") {
      return { kind: "readiness", state: choiceId };
    }
    return { kind: "unknown-choice" };
  }
  return { kind: "unknown-choice" };
}
