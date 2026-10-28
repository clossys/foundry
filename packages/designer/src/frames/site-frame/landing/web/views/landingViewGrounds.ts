import { planContentGrounds } from "../../core/content-ground.js";
import type { ResolvedSectionedViewDocument, SectionedViewGround } from "../../core/sectioned-view.js";

/** Where a band sits in a `LandingView`. */
export type LandingViewBandRole = "hero" | "band" | "closing" | "call-to-action";

/** One band of a `LandingView` page, top to bottom, with the ground it renders on. */
export interface LandingViewBandGround {
  /** The section id, or the call to action's id (`"call-to-action"` when it has none). */
  id: string;
  role: LandingViewBandRole;
  ground: SectionedViewGround;
  /** Whether the view chose this ground (automatic cadence, legacy close, or call to action). */
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

/** The final legacy band's CTA ground, and the call to action's fixed ground. */
export const LANDING_VIEW_CLOSING_GROUND: SectionedViewGround = "base";
export const LANDING_VIEW_CALL_TO_ACTION_GROUND: SectionedViewGround = "inverse";

/** Canonical omission shares the page cadence; explicit inverse remains an anchor. */
export function planLandingViewGrounds(
  document: ResolvedSectionedViewDocument,
  trailing: readonly ResolvedSectionedViewDocument[] = [],
  options: { callToAction?: boolean | { id?: string } } = {},
): LandingViewGroundPlan {
  const plan = planContentGrounds([document, ...trailing], options);
  return { bands: plan.bands.map(({ id, role, ground, assigned }) => ({ id, role, ground, assigned })), repeats: plan.repeats };
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
