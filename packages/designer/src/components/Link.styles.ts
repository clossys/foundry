import type { LinkVariant } from "./Link.types.js";

export const LINK_BASE = "text-body font-body outline-none disabled:cursor-not-allowed";

export const LINK_VARIANT_CLASSES: Record<LinkVariant, string> = {
  default: "text-accent-text underline decoration-transparent hover:decoration-current",
  muted: "text-ink-muted hover:text-ink-secondary",
  standalone: "text-ink-primary hover:underline",
};


/**
 * The skip link's look: visually hidden until focused, then a fixed primary
 * plate at the inline-start corner on the skip-link layer. The Link keeps its
 * own focus ring.
 */
export const SKIP_LINK_CLASSES = "sr-only focus:not-sr-only layer-skip-link focus:fixed focus:skip-link-inset focus:rounded-control focus:bg-primary focus:text-body focus:text-primary-foreground focus:outline-none";
