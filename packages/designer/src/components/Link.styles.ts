import type { LinkVariant } from "./Link.types.js";

export const LINK_BASE = "text-body font-body outline-none disabled:cursor-not-allowed";

export const LINK_VARIANT_CLASSES: Record<LinkVariant, string> = {
  default: "text-accent-text underline decoration-transparent hover:decoration-current",
  muted: "text-ink-muted hover:text-ink-secondary",
  standalone: "text-ink-primary hover:underline",
};

