import { KIT_PRESETS_DATA } from "./generated/offering.generated.js";

/**
 * A curated starting-point composition (issue #1176).
 * Presets are fallbacks and best-sellers Advisor can offer when a client's
 * stated problem matches one closely — never an exhaustive partition of
 * the package catalogue. For every other problem, Advisor composes a
 * custom kit with {@link composeKit} instead. Ids are the stable machine
 * vocabulary; `label` may be renamed without touching `id`.
 */
export interface KitPreset {
  id: string;
  label: string;
  problem: string;
  roles: readonly string[];
  /** Present only for a preset that extends another, e.g. "grow" extends "launch". */
  addOnTo?: string;
}

/** The curated kit presets frozen at advisor's own build time. */
export const KIT_PRESETS: readonly KitPreset[] = KIT_PRESETS_DATA;
