import { TOKENS } from "../tokens/tokens.js";
import { UI_LAYOUT_TAP_TARGET } from "../atoms/internal/ui-vars.js";

/** Existing registered layout values, matching AppFrame's resolved strings. */
export const PAGE_BAR_LAYOUT = {
  gutter: `var(--spacing-md, ${TOKENS["--spacing-md"]!.value})`,
  gap: `var(--spacing-sm, ${TOKENS["--spacing-sm"]!.value})`,
  tap: `var(--ui-layout-tap-target, ${TOKENS["--ui-layout-tap-target"]!.value})`,
  raised: `var(--color-surface-raised, ${TOKENS["--color-surface-raised"]!.value})`,
  glass: `var(--color-surface-glass, ${TOKENS["--color-surface-glass"]!.value})`,
  blur: `blur(var(--blur-glass, ${TOKENS["--blur-glass"]!.value}))`,
  barLayer: `var(--ui-z-sticky, ${TOKENS["--ui-z-sticky"]!.value})`,
} as const;

export const CONTROL = "inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-sm text-body text-ink-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent forced-colors:border-current";
export const TAP = { minBlockSize: UI_LAYOUT_TAP_TARGET, minInlineSize: UI_LAYOUT_TAP_TARGET };

/** Resolve computed direction, with the document attribute fallback for non-painting DOM hosts. */
export function pageBarDirection(element: HTMLElement): "ltr" | "rtl" {
  const direction = getComputedStyle(element).direction;
  return direction === "rtl" || (!direction && element.closest<HTMLElement>("[dir]")?.dir === "rtl") ? "rtl" : "ltr";
}
