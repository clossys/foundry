/**
 * Pitch deck template (#1207): "Pitch deck: slide order, plus the
 * audience-variant mechanism." `PITCH_DECK_SLIDE_ORDER` is the pack's
 * default slide order; `PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS` is a
 * starting `DeckAudienceSelections` (see `../materials/audienceVariant.ts`)
 * that names which default slides are audience-specific out of the box —
 * every other slide in the order is shown to every audience by default,
 * matching `selectAudienceVariant`'s own opt-in-exclusion rule.
 */
import type { DeckAudienceSelections } from "../materials/types.js";

export const PITCH_DECK_SLIDE_ORDER: readonly string[] = [
  "cover",
  "problem",
  "solution",
  "market",
  "product",
  "traction",
  "business-model",
  "competition",
  "team",
  "financials",
  "ask",
  "close",
];

export const PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS: DeckAudienceSelections = {
  financials: ["investor", "board"],
  ask: ["investor"],
  "business-model": ["investor", "partner"],
};
