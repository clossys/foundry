import type { AdvisorState } from "./types.js";

/** Founder-facing one-line summary derived from the assessment state; callers cannot supply this. */
export function sponsorSummaryForState(state: AdvisorState): string {
  switch (state) {
    case "satisfied":
      return "the engagement can take one approved next step, and nothing runs until that step is authorized.";
    case "violated":
      return "something already recorded blocks the next step, and that blocker has to clear before any new work.";
    case "indeterminate":
      return "there is not enough current evidence to choose a next step. That is a rest state, not a failed check.";
  }
}
