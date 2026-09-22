/**
 * Master brand mark contract — three SVG documents a consumer binds the way
 * they bind `brand.css`: lockup (wordmark + mark), mark-only, and inverse
 * lockup. This package ships no product logo, favicon PNGs, or social
 * images; it validates the shape downstream gates consume.
 *
 * Build glyph markup with the same token-backed shell as the `Icon` atom
 * (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `--ui-icon-*` sizing,
 * `--ui-icon-stroke`) so marks stay on-brand when tokens change.
 */

export type MasterMark = {
  lockup: string;
  mark: string;
  inverse: string;
};

export class MasterMarkValidationError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(reasons.join("; "));
    this.name = "MasterMarkValidationError";
    this.reasons = reasons;
  }
}

const SVG_DOCUMENT_RE = /^[\s\uFEFF]*<svg(?:\s|>)/i;

function isSvgDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!SVG_DOCUMENT_RE.test(trimmed)) return false;
  return /<\/svg\s*>/i.test(trimmed);
}

/**
 * Throws {@link MasterMarkValidationError} when `inverse` is missing, any
 * variant is empty, or any variant is not a complete `<svg>` document.
 */
export function validateMasterMark(mark: Partial<MasterMark>): asserts mark is MasterMark {
  const reasons: string[] = [];
  const keys: (keyof MasterMark)[] = ["lockup", "mark", "inverse"];

  for (const key of keys) {
    const value = mark[key];
    if (value === undefined) {
      reasons.push(`${key} is missing`);
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      reasons.push(`${key} is empty`);
      continue;
    }
    if (!isSvgDocument(value)) {
      reasons.push(`${key} must be a complete <svg> document`);
    }
  }

  if (reasons.length > 0) {
    throw new MasterMarkValidationError(reasons);
  }
}

/** Inline style matching `Icon` at size `lg` (see `atoms/Icon.tsx`). */
export const MASTER_MARK_ICON_SHELL_STYLE =
  "width:var(--ui-icon-lg, var(--spacing-2xl, 32px));height:var(--ui-icon-lg, var(--spacing-2xl, 32px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)";

/**
 * Wrap inner glyph markup in an `Icon`-aligned root `<svg>` for the mark-only
 * variant (or as the glyph half of a lockup the consumer composes).
 */
export function iconMarkSvg(
  innerMarkup: string,
  options?: { className?: string; ariaHidden?: boolean },
): string {
  const classAttr = options?.className ? ` class="${options.className}"` : "";
  const a11y = options?.ariaHidden === false ? "" : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="${MASTER_MARK_ICON_SHELL_STYLE}"${classAttr}${a11y}>${innerMarkup}</svg>`;
}
