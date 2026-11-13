import type { IconNode } from "../icons/types.js";
import { Check } from "../icons/Check.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronUp } from "../icons/ChevronUp.js";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { Minus } from "../icons/Minus.js";
import { X } from "../icons/X.js";

/** Plain glyph data from a consumer's asset module, keyed by catalog leaf. */
export type GlyphBindings = Readonly<Partial<Record<`assets.icon-${string}`, IconNode>>>;
/**
 * Owner LAD-3 (2026-11-11): icons are lucide, so GlyphProvider is removed. Built-in controls draw these lucide
 * glyphs; a consumer's icon assets reach a leaf through the emitted Icon adapter, never a context override.
 */
const DEFAULT_GLYPHS = {
  "assets.icon-check": Check,
  "assets.icon-chevron-down": ChevronDown,
  "assets.icon-chevron-up": ChevronUp,
  "assets.icon-chevron-left": ChevronLeft,
  "assets.icon-chevron-right": ChevronRight,
  "assets.icon-close": X,
} as const;

export function useGlyph(asset: keyof typeof DEFAULT_GLYPHS): IconNode {
  return DEFAULT_GLYPHS[asset];
}

/** The mixed checkbox mark; no asset leaf maps it. */
export function useIndeterminateGlyph(): IconNode {
  return Minus;
}
