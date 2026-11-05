/**
 * The pinned Director slots the Designer brief reads (`clossys design --brief`): role, slot id and
 * whether the brief requires it. Every Designer slot decision reads this brief, so these are the
 * Director inputs each Designer slot declares.
 */
export const DESIGN_BRIEF_INPUTS = [
  ["essence", "identity.brand.essence", true],
  ["personality", "identity.brand.personality", true],
  ["visual-direction", "identity.visual.style", true],
  ["imagery", "identity.visual.imagery", false],
  ["voice", "identity.verbal.voice", true],
  ["audience", "focus.segment.core", true],
  ["position", "advantage.proposition.promise", true],
  ["category", "focus.category.definition", true],
] as const;
