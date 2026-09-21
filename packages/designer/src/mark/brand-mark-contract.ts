/**
 * Shared contract for the master brand mark template and
 * `checkBrandMark` — the three variant export names and the sentinel a
 * consumer replaces when filling `templates/mark-template.tsx`.
 */

export const BRAND_MARK_TEMPLATE_PLACEHOLDER = "REPLACE_ME";

/** Wordmark + mark — the full lockup. */
export const BRAND_LOCKUP_EXPORT = "BrandLockup";

/** Mark without the wordmark. */
export const BRAND_MARK_ONLY_EXPORT = "BrandMark";

/** Lockup styled for an inverse (dark) ground. */
export const BRAND_LOCKUP_INVERSE_EXPORT = "BrandLockupInverse";

export const BRAND_MARK_EXPORTS = [
  BRAND_LOCKUP_EXPORT,
  BRAND_MARK_ONLY_EXPORT,
  BRAND_LOCKUP_INVERSE_EXPORT,
] as const;

export type BrandMarkExportName = (typeof BRAND_MARK_EXPORTS)[number];

export const BRAND_WORDMARK_BINDING = "BRAND_WORDMARK";

/** Token utility classes the inverse variant must use to stay legible on inverse ground. */
export const INVERSE_SURFACE_CLASS = "bg-surface-inverse";
export const INVERSE_INK_CLASS = "text-ink-on-inverse";

export function isPlaceholderAuthoredValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return trimmed === BRAND_MARK_TEMPLATE_PLACEHOLDER;
}
