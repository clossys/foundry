import { cx } from "../atoms/internal/cx.js";
import { Logomark, type LogomarkProps } from "../atoms/Logomark.js";
import { Lockup } from "../blocks/Lockup.js";
import {
  BADGE_INSET_SHARE,
  BADGE_RADIUS_SHARE,
  UI_BRANDMARK_GAP_LG,
  UI_BRANDMARK_GAP_MD,
  UI_BRANDMARK_GAP_SM,
  UI_BRANDMARK_HEIGHT_LG,
  UI_BRANDMARK_HEIGHT_MD,
  UI_BRANDMARK_HEIGHT_SM,
  UI_BRANDMARK_WORDMARK_SIZE_LG,
  UI_BRANDMARK_WORDMARK_SIZE_MD,
  UI_BRANDMARK_WORDMARK_SIZE_SM,
} from "../internal/brandmark.js";

/** The two renderings: the mark alone, or the mark beside a live-text wordmark. */
export const BRANDMARK_VARIANTS = ["mark", "lockup"] as const;
export type BrandmarkVariant = (typeof BRANDMARK_VARIANTS)[number];

/** The closed size set; each step maps to a height token and a gap token. */
export const BRANDMARK_SIZES = ["sm", "md", "lg"] as const;
export type BrandmarkSize = (typeof BRANDMARK_SIZES)[number];

/**
 * Where the mark's plate comes from: `"self"` (the default) leaves the mark
 * as it is, its own edge being its plate; `"shared"` draws one rounded-square
 * plate behind it.
 */
export const BRANDMARK_PLATES = ["shared", "self"] as const;
export type BrandmarkPlate = (typeof BRANDMARK_PLATES)[number];

/** The image's side inside a shared plate, as a fraction of the plate's side. */
const PLATE_IMAGE_SHARE = 1 - 2 * BADGE_INSET_SHARE;

const SIZE_VARS: Readonly<Record<BrandmarkSize, { height: string; gap: string; wordmark: string }>> = {
  sm: { height: UI_BRANDMARK_HEIGHT_SM, gap: UI_BRANDMARK_GAP_SM, wordmark: UI_BRANDMARK_WORDMARK_SIZE_SM },
  md: { height: UI_BRANDMARK_HEIGHT_MD, gap: UI_BRANDMARK_GAP_MD, wordmark: UI_BRANDMARK_WORDMARK_SIZE_MD },
  lg: { height: UI_BRANDMARK_HEIGHT_LG, gap: UI_BRANDMARK_GAP_LG, wordmark: UI_BRANDMARK_WORDMARK_SIZE_LG },
};

/** `markSrc` as a quoted CSS `url()`; quotes, backslashes and line breaks are escaped. */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}")`;
}

/** Case-insensitive, whitespace-collapsed form used for the label-in-name comparison. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

interface BrandmarkBaseProps {
  /** Which step of the closed size set to render at. */
  size: BrandmarkSize;
  /** Explicit chrome sizing; omission preserves the legacy variant and size. */
  presentation?: "desktop" | "mobile" | "responsive";
  /** Producer-measured source viewBox and painted bounds for explicit presentations. */
  geometry?: LogomarkProps["geometry"];
  /**
   * The link's whole accessible name, supplied by the consumer — this
   * package ships no default copy and no `"{Brand} home"` template (see
   * this package's README, "Public contract"). Applied as the link's
   * `aria-label`, so the name is exactly this string whichever variant
   * renders, and the decorative image and any wordmark text add nothing
   * to it. Must not be empty or whitespace-only (an unnamed link is
   * refused), and for `variant="lockup"` must contain the visible
   * `wordmark` text (see {@link Brandmark}).
   */
  label: string;
  /**
   * URL of the mark image, rendered as `<img src>` — a URL only, never
   * injected markup. The image is decorative (`alt=""`): the link carries
   * the name.
   */
  markSrc: string;
  /**
   * `"self"` (the default, and what an omitted prop means): the mark is
   * rendered as it always was. `"shared"`: one rounded-square plate in the
   * base ink is drawn behind the mark (in a lockup, behind the mark only),
   * with the image inset on every side; supply a mark that reads on that ink,
   * as its contrast is not checked. The plate is CSS, never markup from the
   * consumer. Its geometry is `BADGE_RADIUS_SHARE` and `BADGE_INSET_SHARE`,
   * the same shares `badgePlatePath` draws.
   */
  plate?: BrandmarkPlate;
  /**
   * How the mark is painted. `"image"` (the default, and what an omitted prop
   * means) renders `markSrc` as it is. `"accent"` paints the mark's shape in
   * the accent token, using `markSrc` as a mask: supply a single-colour mark
   * whose transparent areas are its background. The accent mark is drawn in a
   * square of the size's height. Inside `SiteHeader`, an omitted `markInk`
   * becomes `"accent"`; pass `"image"` there to keep a multi-colour logo,
   * which the accent mask would flatten to a one-colour silhouette.
   * @default "image"
   */
  markInk?: "image" | "accent";
  /** Wordmark ink; auto keeps the base ink. @default "auto" */
  tone?: "auto" | "inverse";
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
         * font, sized from the mark's height. Text only: a string, never an
         * element or image. Nothing is rendered for an empty or
         * whitespace-only wordmark: a lockup without one falls back to the mark alone.
         */
        wordmark: string;
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
 *
 * Refuses (throws a plain `Error` that names the prop and never echoes its
 * value) a `label` that is empty, whitespace-only or not a string, since the
 * image is decorative and the link would have no accessible name. For the
 * lockup it also refuses a `label` that does not contain the visible
 * wordmark text, compared case-insensitively with whitespace normalised:
 * `aria-label` replaces the visible text as the link's name, so a label
 * without it fails WCAG 2.5.3 (label in name). The `mark` variant shows no
 * text and is not subject to that second check.
 */
export function Brandmark(props: BrandmarkProps) {
  const { variant, size, label, markSrc, className, plate, markInk = "image", tone = "auto" } = props;
  const vars = SIZE_VARS[size];
  const inverse = tone === "inverse";
  const wordmark = variant === "lockup" ? props.wordmark : undefined;
  const showWordmark = typeof wordmark === "string" && normalise(wordmark) !== "";

  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("Brandmark: `label` must be a non-empty string; it is the link's whole accessible name.");
  }
  if (showWordmark && !normalise(label).includes(normalise(wordmark))) {
    throw new Error(
      'Brandmark: for variant="lockup", `label` must contain the visible `wordmark` text (WCAG 2.5.3, label in name).',
    );
  }

  const linkClasses = cx(
    inverse
      ? "inline-flex items-center no-underline text-ink-on-inverse"
      : "inline-flex items-center no-underline text-ink-primary",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    inverse ? "focus-visible:outline-ink-on-inverse" : "focus-visible:outline-accent",
    className,
  );

  if (props.presentation !== undefined && props.geometry !== undefined) {
    const desktop = showWordmark
      ? <Lockup src={markSrc} size={size} wordmark={wordmark} plate={plate} tone={tone}
          presentation={props.presentation === "responsive" ? "desktop" : props.presentation} geometry={props.geometry} />
      : <Logomark src={markSrc} size={size} plate={plate}
          presentation={props.presentation === "responsive" ? "desktop" : props.presentation} geometry={props.geometry} />;
    const mobile = <Logomark src={markSrc} size={size} geometry={props.geometry}
      presentation={props.presentation === "responsive" ? "mobile" : props.presentation} />;
    return <a href="/" aria-label={label} className={linkClasses}>
      {props.presentation === "responsive"
        ? <><span className="hidden desktop:block">{desktop}</span><span className="inline-flex desktop:hidden">{mobile}</span></>
        : props.presentation === "mobile" ? mobile : desktop}
    </a>;
  }

  if (markInk !== "accent") {
    if (showWordmark) {
      return <Lockup as={"a"} href="/" aria-label={label} src={markSrc} size={size}
        wordmark={wordmark} plate={plate} tone={tone} className={linkClasses} />;
    }
    return (
      <a href="/" aria-label={label} className={linkClasses}>
        <Logomark src={markSrc} size={size} plate={plate} />
      </a>
    );
  }

  // The accent mark is a decorative span masked by the image, filled with the
  // accent token. data-brand-mark names the outermost accent mark element, so
  // header CSS can hide the wordmark alone; the image forms above keep their markup.
  const mark = (side: string, outermost: boolean) => (
    <span
      aria-hidden
      data-brand-mark={outermost ? "" : undefined}
      className="inline-block shrink-0 bg-accent"
      style={{
        height: side,
        width: side,
        maskImage: cssUrl(markSrc),
        WebkitMaskImage: cssUrl(markSrc),
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );

  return (
    <a href="/" aria-label={label} className={linkClasses} style={showWordmark ? { gap: vars.gap } : undefined}>
      {plate === "shared" ? (
        <span
          aria-hidden
          data-brand-mark=""
          className="inline-flex shrink-0 items-center justify-center bg-ink-primary"
          style={{
            height: vars.height,
            width: vars.height,
            borderRadius: `calc(${vars.height} * ${BADGE_RADIUS_SHARE})`,
          }}
        >
          {mark(`calc(${vars.height} * ${PLATE_IMAGE_SHARE})`, false)}
        </span>
      ) : (
        mark(vars.height, true)
      )}
      {showWordmark ? (
        <span className="font-display leading-none" style={{ fontSize: vars.wordmark }}>
          {wordmark}
        </span>
      ) : null}
    </a>
  );
}
