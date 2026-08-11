import { createElement, forwardRef } from "react";
import type { CSSProperties, ReactNode, SVGProps } from "react";
import type { IconNode } from "../icons/types.js";

export type { IconNode } from "../icons/types.js";

export type IconSize = "sm" | "md" | "lg";

/**
 * The accessibility contract every `Icon` is built around: an icon is
 * either decorative (hidden from assistive technology) or it carries a
 * real accessible name — never neither, and never both at once. A
 * discriminated union rather than two optional props with a runtime
 * default, specifically so the wrong state is a COMPILE-TIME error, not a
 * silent default: omitting both `decorative` and `label` doesn't fail
 * closed to "hidden" or fail open to "unlabeled" — it doesn't type-check at
 * all. Ported from this scope's own pre-merge, standalone `icons`
 * package's `src/types.ts` `IconAccessibilityProps` (that package is
 * folded into this one — see this file's own "Why a render contract lives
 * here" note below) — same shape, same reasoning.
 *
 * See `src/atoms/internal/icon-contract.check.tsx` for the
 * compile-time enforcement (a `.check.tsx` file, not `.test.tsx` — this
 * package's `tsconfig.json`, like every package in this repo, excludes
 * `**\/*.test.ts(x)` from the real `tsc` run, so a `@ts-expect-error` living
 * in a test file would never actually be checked by `npm run typecheck`;
 * see that file's own header comment, and issue #24, for the concrete
 * defect this works around).
 */
export type IconAccessibilityProps =
  | {
      /** This icon adds no information beyond text already next to it (a button's icon beside its own visible label, a decorative flourish). Hidden from assistive technology. */
      decorative: true;
      label?: undefined;
    }
  | {
      decorative?: false;
      /** Required when the icon is not decorative — becomes the icon's `aria-label`. Use when the icon is the ONLY signal of what a control does (an icon-only button, a status glyph with no adjacent text). */
      label: string;
    };

/**
 * Exactly one of two ways to supply an icon's markup, mutually exclusive at
 * the type level:
 *
 * - `glyph`: structured `[tag, attrs]` tuple DATA — the shape
 *   `@vespeneventures/ui/icons` ships (and the shape any similarly-vendored
 *   glyph set — a consumer's own copied-in icon library, a design tool's
 *   JSON export — is likely already in). Plain data: easy to store, diff,
 *   generate, and swap.
 * - `children`: raw SVG child elements (`<path>`, `<g>`, ...) or a
 *   component that renders them, for a one-off brand mark pasted straight
 *   from a design tool's "copy as SVG" output, or any icon whose markup
 *   doesn't happen to fit the `[tag, attrs]` shape (a `<linearGradient>`
 *   def, several `<path>`s with different `fill-rule`s). Both paths render
 *   INSIDE the one `<svg>` this atom itself owns (viewBox, stroke, size,
 *   accessibility) — this is not a place to nest a second, independent
 *   `<svg>`; `children` supplies inner markup, not a whole replacement icon.
 *
 * Both exist because neither alone covers every real input: `glyph` is what
 * every atom/data-driven caller reaches for (including this package's own
 * `@vespeneventures/ui/icons`), and `children` is the escape hatch for
 * markup that was never going to fit a `[tag, attrs]` tuple, or that a
 * consumer already has as JSX and shouldn't have to convert.
 */
type IconContentProps =
  | { glyph: IconNode; children?: undefined }
  | { glyph?: undefined; children: ReactNode };

export type IconProps = IconAccessibilityProps &
  IconContentProps & {
    /** @default "md" */
    size?: IconSize;
    className?: string;
    style?: CSSProperties;
  } & Omit<
    SVGProps<SVGSVGElement>,
    | "children"
    | "color"
    | "fill"
    | "stroke"
    | "width"
    | "height"
    | "strokeWidth"
    | "aria-hidden"
    | "aria-label"
    | "role"
    | "className"
    | "style"
  >;

/**
 * `size` -> this package's token-layer `--ui-icon-*` step, each carrying its
 * own literal pixel fallback (defense-in-depth for a consumer who hasn't
 * imported `@vespeneventures/ui/tokens.css` yet — the same
 * `var(--token, <fallback>)` shape that package's own `--ui-density-*`
 * aliases use internally, and the shape this scope's pre-merge, standalone
 * `icons` package's own `SIZE_TOKENS` used before this atom absorbed it).
 * Reading the `--ui-icon-*` alias (rather than `--spacing-*` directly,
 * which is what that pre-merge package did) is what makes icon size
 * independently tunable by a consumer
 * without moving the padding scale everything else on the page reads from
 * — see this package's token changelog for the token family itself.
 */
const SIZE_VARS: Record<IconSize, string> = {
  sm: "var(--ui-icon-sm, var(--spacing-lg, 16px))",
  md: "var(--ui-icon-md, var(--spacing-xl, 24px))",
  lg: "var(--ui-icon-lg, var(--spacing-2xl, 32px))",
};

/**
 * The glyph data this atom renders is authored at a single fixed stroke
 * weight with no lever of its own to make it lighter or heavier — that
 * lever is this token, read via `style` (not the `strokeWidth` SVG
 * attribute) for the same reason `width`/`height` below are: applying a
 * `var(...)` reference through an inline STYLE property is reliably
 * resolved by every browser, where a raw presentation-attribute value has
 * spottier cross-browser `var()` support historically. `--ui-icon-stroke`
 * is `brandable: true` in this package's token layer — a real brand lever,
 * the same category as `--radius-default` — unlike the three size steps.
 */
const STROKE_WIDTH_VAR = "var(--ui-icon-stroke, 2)";

/**
 * The glyph-rendering contract: size, colour, and accessibility, applied to
 * either structured glyph DATA or arbitrary `children`. Colour always
 * inherits `currentColor` — there is no `color`/`fill`/`stroke` prop (see
 * `IconProps`'s `Omit`), so passing one is a compile-time error rather than
 * a silently-ignored prop. To change how an icon renders, set CSS `color`
 * on the icon itself or an ancestor, the same mechanism `Spinner` and
 * `Skeleton` already use in this package.
 *
 * ### Why a render contract lives here, and glyph data lives in `./icons`
 *
 * A prior design shipped size/colour/accessibility bundled INSIDE a
 * separate, standalone glyph package this scope used to publish (folded
 * into this one — see `@vespeneventures/ui/icons`). That put the rendering CONTRACT
 * in a package whose only other job was shipping path data, and left this
 * package (`ui`) with no `Icon` atom of its own — every consumer wanting a
 * styled, accessible icon had to reach past `ui` entirely. This atom moves
 * the contract to where the rest of this package's contracts already live;
 * `@vespeneventures/ui/icons` now ships pure `[tag, attrs]` data with no
 * rendering logic of its own (see that subpath's own README section).
 *
 * ### No name lookup — glyph (or a custom SVG) always arrives as a slot
 *
 * There is no `<Icon name="clock" />` string-keyed registry. This is this
 * package's own "Slots beat mode props" rule (see the README, "Placement
 * rules") applied one level further: a NAME string is itself a mode prop in
 * disguise — it makes `Icon` responsible for knowing every glyph a caller
 * might ever want, the same unbounded-growth failure the README's variant
 * rule describes for a structural mode prop. A `glyph`/`children` SLOT
 * instead makes a consumer's own glyph — vendored from this package's
 * `./icons` subpath, hand-copied from a design tool, or a whole custom
 * brand mark — a first-class input with no extension mechanism to learn,
 * the same way `Menu`'s `trigger` or `PageHeader`'s `actions` already are.
 */
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(props, ref) {
  const { size = "md", className, style, decorative, label, glyph, children, ...rest } = props;
  const dimension = SIZE_VARS[size];

  const a11yProps = decorative
    ? ({ "aria-hidden": "true" } as const)
    : ({ role: "img", "aria-label": label } as const);

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{
        width: dimension,
        height: dimension,
        flexShrink: 0,
        strokeWidth: STROKE_WIDTH_VAR,
        ...style,
      }}
      {...a11yProps}
      {...rest}
    >
      {glyph ? glyph.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })) : children}
    </svg>
  );
});

Icon.displayName = "Icon";
