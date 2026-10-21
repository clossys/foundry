import { TOKENS } from "../tokens/tokens.js";
import { UI_LAYOUT_TAP_TARGET } from "../atoms/internal/ui-vars.js";

const variable = (name: keyof typeof TOKENS) => `var(${name}, ${TOKENS[name]!.value})`;
/** Existing registered layout values, matching AppFrame's resolved strings. */
export const PAGE_BAR_LAYOUT = {
  gutter: variable("--spacing-md"),
  gap: variable("--spacing-sm"),
  tap: variable("--ui-layout-tap-target"),
  raised: variable("--color-surface-raised"),
  glass: variable("--color-surface-glass"),
  blur: `blur(${variable("--blur-glass")})`,
  barLayer: variable("--ui-z-sticky"),
} as const;

export const CONTROL = "inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-sm text-body text-ink-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent forced-colors:border-current";
export const TAP = { minBlockSize: UI_LAYOUT_TAP_TARGET, minInlineSize: UI_LAYOUT_TAP_TARGET };

/** Resolve computed direction, with the document attribute fallback for non-painting DOM hosts. */
export function pageBarDirection(element: HTMLElement): "ltr" | "rtl" {
  const direction = getComputedStyle(element).direction;
  return direction === "rtl" || (!direction && element.closest<HTMLElement>("[dir]")?.dir === "rtl") ? "rtl" : "ltr";
}
