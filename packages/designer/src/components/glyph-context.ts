import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { IconNode } from "../icons/types.js";
import { Check } from "../icons/Check.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronUp } from "../icons/ChevronUp.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { Minus } from "../icons/Minus.js";
import { X } from "../icons/X.js";

/** Plain glyph data from a consumer's asset module, keyed by catalog leaf. */
export type GlyphBindings = Readonly<Partial<Record<`assets.icon-${string}`, IconNode>>>;
const DEFAULT_GLYPHS = {
  "assets.icon-check": Check,
  "assets.icon-chevron-down": ChevronDown,
  "assets.icon-chevron-up": ChevronUp,
  "assets.icon-chevron-right": ChevronRight,
  "assets.icon-close": X,
} as const;
const GlyphContext = createContext({ glyphs: DEFAULT_GLYPHS as GlyphBindings, indeterminate: Minus });

/** Client controls inherit overrides; omitted assets keep their parent binding. */
export interface GlyphProviderProps {
  glyphs: GlyphBindings;
  /** No asset leaf currently maps the mixed checkbox mark; supply its glyph explicitly. */
  indeterminateGlyph?: IconNode;
  children: ReactNode;
}
export function GlyphProvider({ glyphs, indeterminateGlyph, children }: GlyphProviderProps) {
  const parent = useContext(GlyphContext);
  return createElement(GlyphContext.Provider, {
    value: { glyphs: { ...parent.glyphs, ...glyphs }, indeterminate: indeterminateGlyph ?? parent.indeterminate },
  }, children);
}

export function useGlyph(asset: keyof typeof DEFAULT_GLYPHS): IconNode {
  return useContext(GlyphContext).glyphs[asset] ?? DEFAULT_GLYPHS[asset];
}

/** Explicit input until the asset catalog has an indeterminate leaf. */
export function useIndeterminateGlyph(): IconNode {
  return useContext(GlyphContext).indeterminate;
}
