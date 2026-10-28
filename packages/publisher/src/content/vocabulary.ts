/** Runtime vocabularies shared by stored content and structural validators. */
export const CANDIDATE_STATES = Object.freeze(["draft", "in-review", "approved", "active", "retired"] as const);
export const CANDIDATE_ORIGINS = Object.freeze(["agent-draft", "alternative", "rewrite", "imported"] as const);
export const SLOT_KINDS = Object.freeze(["content", "redirect", "status"] as const);
export const SECTION_INTENTS = Object.freeze(["continues", "contrasts", "zooms-in", "proof", "call-to-action"] as const);
export const LINK_RELATIONS = Object.freeze(["nav", "next", "cta", "branch"] as const);
export type CandidateState = (typeof CANDIDATE_STATES)[number];
export type CandidateOrigin = (typeof CANDIDATE_ORIGINS)[number];
export type SlotKind = (typeof SLOT_KINDS)[number];
export type SectionIntent = (typeof SECTION_INTENTS)[number];
export type LinkRelation = (typeof LINK_RELATIONS)[number];
export type RevisionId = `r${number}`;

/** No floating revision or zero revision can stand in for a pinned snapshot. */
export function isRevisionId(value: unknown): value is RevisionId {
  return typeof value === "string" && /^r[1-9][0-9]*$/.test(value);
}

/** Validate a locale tag without rewriting the stored selection. */
export function isContentLocale(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}
