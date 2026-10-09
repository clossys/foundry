import type { ResolvedSectionedViewDocument, ResolvedSectionedViewSection, SectionedViewGround } from "../../core/sectioned-view.js";

/** Where a band sits in a `LandingView`. */
export type LandingViewBandRole = "hero" | "band" | "closing" | "call-to-action";

/** One band of a `LandingView` page, top to bottom, with the ground it renders on. */
export interface LandingViewBandGround {
  /** The section id, or the call to action's id (`"call-to-action"` when it has none). */
  id: string;
  role: LandingViewBandRole;
  ground: SectionedViewGround;
  /** Whether the view chose this ground (`viewGrounds` rhythm, or the fixed closing pair). */
  assigned: boolean;
}

/** Two neighbouring bands on the same ground: the seam between them does not show. */
export interface LandingViewGroundRepeat {
  above: string;
  below: string;
  ground: SectionedViewGround;
}

export interface LandingViewGroundPlan {
  bands: LandingViewBandGround[];
  /** Neighbouring bands on the same ground. Empty for a conforming page. */
  repeats: LandingViewGroundRepeat[];
}

/** The closing pair's fixed grounds: a light last band, then the dark call to action. */
export const LANDING_VIEW_CLOSING_GROUND: SectionedViewGround = "base";
export const LANDING_VIEW_CALL_TO_ACTION_GROUND: SectionedViewGround = "inverse";

/** The plan's id for a call to action without its own id. */
const CALL_TO_ACTION_BAND_ID = "call-to-action";

/** The rhythm's two grounds; `inverse` is never assigned by rhythm. */
const RHYTHM: readonly [SectionedViewGround, SectionedViewGround] = ["base", "sunken"];

function otherRhythmGround(below: SectionedViewGround): SectionedViewGround {
  return below === RHYTHM[0] ? RHYTHM[1] : RHYTHM[0];
}

interface Candidate {
  section: ResolvedSectionedViewSection;
  assignable: boolean;
}

/**
 * The grounds a `LandingView` renders, top to bottom.
 *
 * - The hero keeps its own ground (the opening band).
 * - With a call to action, the closing pair is fixed by the view, whatever
 *   the documents say: the last band on `base`, the call to action on
 *   `inverse` (the ground a site footer usually takes).
 * - Every other band whose section omitted `ground` under the `"view"`
 *   rhythm (its document's `viewGrounds`) is assigned bottom-anchored:
 *   counting upward from the last band, each takes the rhythm ground that
 *   differs from the band below it. Authors never count sections, and the
 *   band above the last one never repeats its ground.
 * - An explicit section ground wins (outside the closing pair).
 *
 * `repeats` lists neighbouring bands left on the same ground (only possible
 * through explicit grounds), for a conformance check. The call to action and
 * whatever follows the view (a footer) are not compared: that seam is the
 * view's to draw.
 */
export function planLandingViewGrounds(
  document: ResolvedSectionedViewDocument,
  trailing: readonly ResolvedSectionedViewDocument[] = [],
  options: { callToAction?: boolean | { id?: string } } = {},
): LandingViewGroundPlan {
  const [hero, ...rest] = document.sections;
  const candidates: Candidate[] = [];
  for (const [owner, sections] of [[document, rest] as const, ...trailing.map((entry) => [entry, entry.sections] as const)]) {
    const assignable = new Set(owner.viewGrounds ?? []);
    for (const section of sections) candidates.push({ section, assignable: assignable.has(section.id) });
  }

  const hasCallToAction = options.callToAction !== undefined && options.callToAction !== false;
  const body: LandingViewBandGround[] = new Array(candidates.length);
  let below: SectionedViewGround | undefined;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const { section, assignable } = candidates[index]!;
    const closing = hasCallToAction && index === candidates.length - 1;
    let ground: SectionedViewGround;
    if (closing) ground = LANDING_VIEW_CLOSING_GROUND;
    else if (!assignable) ground = section.ground;
    else ground = below === undefined ? RHYTHM[0] : otherRhythmGround(below);
    body[index] = { id: section.id, role: closing ? "closing" : "band", ground, assigned: closing || assignable };
    below = ground;
  }

  const bands: LandingViewBandGround[] = [];
  if (hero !== undefined) bands.push({ id: hero.id, role: "hero", ground: hero.ground, assigned: false });
  bands.push(...body);
  if (hasCallToAction) {
    const id = typeof options.callToAction === "object" ? options.callToAction.id : undefined;
    bands.push({ id: id ?? CALL_TO_ACTION_BAND_ID, role: "call-to-action", ground: LANDING_VIEW_CALL_TO_ACTION_GROUND, assigned: true });
  }

  const repeats: LandingViewGroundRepeat[] = [];
  for (let index = 1; index < bands.length; index += 1) {
    const above = bands[index - 1]!;
    const current = bands[index]!;
    if (above.ground === current.ground) repeats.push({ above: above.id, below: current.id, ground: current.ground });
  }
  return { bands, repeats };
}

/** The documents with each band's planned ground written in, ready to render. */
export function applyLandingViewGrounds(
  plan: LandingViewGroundPlan,
  documents: readonly ResolvedSectionedViewDocument[],
): ResolvedSectionedViewDocument[] {
  const planned = new Map(plan.bands.filter((band) => band.role !== "call-to-action").map((band) => [band.id, band.ground] as const));
  return documents.map((entry) => ({
    ...entry,
    sections: entry.sections.map((section) => {
      const ground = planned.get(section.id);
      return ground === undefined || ground === section.ground ? section : { ...section, ground };
    }),
  }));
}
