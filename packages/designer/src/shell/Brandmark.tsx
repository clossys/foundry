import type { ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import {
  UI_BRANDMARK_GAP_LG,
  UI_BRANDMARK_GAP_MD,
  UI_BRANDMARK_GAP_SM,
  UI_BRANDMARK_HEIGHT_LG,
  UI_BRANDMARK_HEIGHT_MD,
  UI_BRANDMARK_HEIGHT_SM,
  UI_BRANDMARK_WORDMARK_SIZE_LG,
  UI_BRANDMARK_WORDMARK_SIZE_MD,
  UI_BRANDMARK_WORDMARK_SIZE_SM,
} from "./internal/shell-vars.js";

/** The two renderings: the mark alone, or the mark beside a live-text wordmark. */
export const BRANDMARK_VARIANTS = ["mark", "lockup"] as const;
export type BrandmarkVariant = (typeof BRANDMARK_VARIANTS)[number];

/** The closed size set; each step maps to a height token and a gap token. */
export const BRANDMARK_SIZES = ["sm", "md", "lg"] as const;
export type BrandmarkSize = (typeof BRANDMARK_SIZES)[number];

const SIZE_VARS: Readonly<Record<BrandmarkSize, { height: string; gap: string; wordmark: string }>> = {
  sm: { height: UI_BRANDMARK_HEIGHT_SM, gap: UI_BRANDMARK_GAP_SM, wordmark: UI_BRANDMARK_WORDMARK_SIZE_SM },
  md: { height: UI_BRANDMARK_HEIGHT_MD, gap: UI_BRANDMARK_GAP_MD, wordmark: UI_BRANDMARK_WORDMARK_SIZE_MD },
  lg: { height: UI_BRANDMARK_HEIGHT_LG, gap: UI_BRANDMARK_GAP_LG, wordmark: UI_BRANDMARK_WORDMARK_SIZE_LG },
};

interface BrandmarkBaseProps {
  /** Which step of the closed size set to render at. */
  size: BrandmarkSize;
  /**
   * The link's whole accessible name, supplied by the consumer — this
   * package ships no default copy and no `"{Brand} home"` template (see
   * this package's README, "Public contract"). Applied as the link's
   * `aria-label`, so the name is exactly this string whichever variant
   * renders, and the decorative image and any wordmark text add nothing
   * to it.
   */
  label: string;
  /**
   * URL of the mark image, rendered as `<img src>` — a URL only, never
   * injected markup. The image is decorative (`alt=""`): the link carries
   * the name.
   */
  markSrc: string;
  className?: string;
}

/**
 * `lockup` requires a `wordmark`; `mark` takes none. `href` and
 * `aria-label` are deliberately not props at all: the link always goes to
 * `"/"` and is always named by `label`.
 */
export type BrandmarkProps = BrandmarkBaseProps &
  (
    | { variant: "mark"; wordmark?: never }
    | {
        variant: "lockup";
        /**
         * The brand name, rendered as live text (not an image) in the display
         * font, sized from the mark's height. Nothing is rendered for an
         * empty wordmark: a lockup without one falls back to the mark alone.
         */
        wordmark: ReactNode;
      }
  );

/**
 * The site's identity link: a mark image, optionally beside a live-text
 * wordmark, pointing at the site root. Meant for `SiteHeader`'s `brand`
 * slot (or anywhere a home link belongs).
 *
 * Reads only defined custom properties (`--ui-brandmark-height-*`,
 * `--ui-brandmark-gap-*`); the wordmark's font-size is the mark's height
 * times a fixed ratio, so the two always scale together. Server-safe: no
 * hooks, no client directive, no `react-aria-components`. Never accepts or
 * renders markup — `markSrc` is a URL and `wordmark` is text.
 *
 * Deliberately no props spread onto the anchor: nothing a consumer passes
 * can reach `href` or `aria-label`, even past the type system.
 */
export function Brandmark(props: BrandmarkProps) {
  const { variant, size, label, markSrc, className } = props;
  const vars = SIZE_VARS[size];
  const wordmark = variant === "lockup" ? props.wordmark : undefined;
  const showWordmark = wordmark !== undefined && wordmark !== null && wordmark !== false && wordmark !== "";

  return (
    <a
      href="/"
      aria-label={label}
      className={cx(
        "inline-flex items-center no-underline text-ink-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      style={showWordmark ? { gap: vars.gap } : undefined}
    >
      <img src={markSrc} alt="" style={{ height: vars.height, width: "auto" }} />
      {showWordmark ? (
        <span className="font-display leading-none" style={{ fontSize: vars.wordmark }}>
          {wordmark}
        </span>
      ) : null}
    </a>
  );
}
