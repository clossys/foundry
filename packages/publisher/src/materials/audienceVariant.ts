import type { SlidesDeckInput } from "../slides/index.js";
import type { DeckAudienceSelections } from "./types.js";

/**
 * Selects the audience variant of a pitch deck (#1206). One source deck,
 * one set of declared per-slide audience selections; a variant is never a
 * second, hand-maintained copy of the deck. A slide with no entry in
 * `selections` is shown to every audience — the selection mechanism is
 * opt-in exclusion, not opt-in inclusion, so a newly added slide defaults
 * to visible rather than silently disappearing from every existing
 * variant.
 *
 * Deck order and speaker notes are preserved for the slides that remain;
 * `notes` entries for a filtered-out slide are dropped along with it
 * (matching `RenderSlidesResult.unknownNoteKeys`'s own "reported, never
 * silently kept for a slide that no longer exists" discipline one layer
 * up).
 */
export function selectAudienceVariant(source: SlidesDeckInput, selections: DeckAudienceSelections, audience: string): SlidesDeckInput {
  const kept = source.slides.filter((slide) => {
    const tags = selections[slide.id];
    return tags === undefined || tags.includes(audience);
  });
  const keptIds = new Set(kept.map((slide) => slide.id));
  const notes = source.notes ? Object.fromEntries(Object.entries(source.notes).filter(([id]) => keptIds.has(id))) : undefined;
  return {
    id: `${source.id}-${audience}`,
    slides: kept,
    ...(notes ? { notes } : {}),
  };
}

/** Every audience named anywhere in `selections`, sorted — the set of variants a source deck actually has. */
export function declaredAudiences(selections: DeckAudienceSelections): readonly string[] {
  const audiences = new Set<string>();
  for (const tags of Object.values(selections)) for (const audience of tags) audiences.add(audience);
  return [...audiences].sort();
}
