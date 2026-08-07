import type { SVGProps } from "react";

/**
 * The three icon sizes this package ships, each bound to a step of
 * `@vespeneventures/tokens`' `--spacing-*` scale rather than a raw pixel
 * value — see `createIcon.tsx`'s `SIZE_TOKENS` for the exact mapping. There
 * is no numeric escape hatch (no `size={18}`): every consumer of this
 * package renders one of these three sizes, the same closed `"sm" | "md" |
 * "lg"` shape `@vespeneventures/ui`'s own atoms (`Avatar`, `Dialog`,
 * `Spinner`, ...) already use, so an icon dropped next to one of those
 * atoms sizes itself from the same vocabulary rather than a second, private
 * scale.
 */
export type IconSize = "sm" | "md" | "lg";

/**
 * The accessibility contract every icon this package ships is built
 * around: an icon is either decorative (hidden from assistive technology)
 * or it carries a real accessible name — never neither, and never both at
 * once. This is a discriminated union rather than two optional props with a
 * runtime default specifically so the wrong state is a **compile-time**
 * error, not a silent default: omitting both `decorative` and `label`
 * doesn't fail closed to "hidden" or fail open to "unlabeled" — it doesn't
 * type-check at all. See README.md "Accessibility" for the reasoning and
 * `src/accessibility.test.tsx` for the enforcement (including the required
 * "this actually fails to compile" proof).
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
 * Every prop a generated icon component accepts: the accessibility union
 * above, plus `size` and `className`, plus every SVG attribute React's own
 * `SVGProps<SVGSVGElement>` allows — EXCEPT the ones this package's
 * accessibility/color/size contract already owns and never lets a call
 * site override:
 *
 * - `color` / `fill` / `stroke` — every icon strokes with `currentColor`,
 *   never a prop-supplied value (see README "Color"). A consumer who wants
 *   a different rendered color sets CSS `color` on an ancestor, the same
 *   way any `currentColor`-based glyph does — there is no per-icon color
 *   prop to reach for instead, so there's nothing to set to a hardcoded hex
 *   value.
 * - `width` / `height` — size comes from the `size` prop's token mapping
 *   only (see `IconSize` above); a raw pixel override would defeat the
 *   entire point of a token-driven scale.
 * - `aria-hidden` / `aria-label` / `role` — fully owned by the
 *   `decorative`/`label` union; a call site sets its accessibility intent
 *   through that union, never these DOM attributes directly (setting them
 *   directly is exactly how an icon ends up hidden from assistive tech by
 *   accident, or unlabeled by accident — the failure mode this package
 *   exists to make hard to reach).
 * - `children` — an icon's markup is fixed; there is no slot for one.
 */
export type IconProps = IconAccessibilityProps & {
  /** @default "md" */
  size?: IconSize;
  className?: string;
} & Omit<
    SVGProps<SVGSVGElement>,
    | "children"
    | "color"
    | "fill"
    | "stroke"
    | "width"
    | "height"
    | "aria-hidden"
    | "aria-label"
    | "role"
  >;

/**
 * One SVG child element of an icon's fixed markup: `["path", { d: "..." }]`,
 * `["circle", { cx: "12", cy: "12", r: "10" }]`, and so on — the same
 * `[tag, attrs]` tuple shape every icon component in this package (and
 * `createIcon`'s consumer-facing extension seam) is built from.
 */
export type IconNode = ReadonlyArray<
  readonly [tag: string, attrs: Record<string, string>]
>;
