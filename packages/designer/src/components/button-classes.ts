import type { ButtonSize, ButtonVariant } from "./Button.js";

/**
 * The grounds a control is drawn for: the page ground (`base`), a sunken
 * band (`sunken`) or the dark inverse plate (`inverse`). Only the ground-aware
 * looks (`tonal`, `quiet` and the icon-only control) change with it.
 */
export type ControlGround = "base" | "sunken" | "inverse";

const BASE =
  "inline-flex max-w-full items-center justify-center gap-sm whitespace-nowrap rounded-control text-body font-body transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<Exclude<ButtonVariant, "tonal" | "quiet">, string> = {
  primary: "bg-action text-ink-on-action hover:bg-action-hover data-pressed:bg-action-pressed",
  secondary: "bg-surface-raised text-ink-primary border border-line-control hover:bg-control-tonal-hover",
  ghost: "text-ink-primary hover:bg-control-tonal-hover",
  danger: "bg-status-danger text-ink-on-accent hover:bg-status-danger-text",
  outline:
    "bg-transparent ring-inset ring-current ring-1 hover:ring-2",
};

/*
 * `tonal` (T3) is a neutral tonal fill with the ground's primary ink and no
 * edge: the primary ink at low alpha (`--color-control-tonal`, denser on
 * hover) on a light ground, the on-inverse ink at low alpha on the inverse
 * plate. Translucent, so it reads on base and sunken alike.
 */
const TONAL_GROUND_CLASSES: Record<ControlGround, string> = {
  base: "bg-control-tonal text-ink-primary hover:bg-control-tonal-hover",
  sunken: "bg-control-tonal text-ink-primary hover:bg-control-tonal-hover",
  inverse: "bg-control-tonal-inverse text-ink-on-inverse hover:bg-control-tonal-inverse-hover",
};

/*
 * `quiet` (T4) is a chevron text button: no fill, no edge and no inline
 * padding, so it aligns to the text edge. `quiet-action` (a `theme.css`
 * utility) pads the block to the 44px tap target and nudges the trailing
 * icon toward the inline end on hover, never under reduced motion; hover
 * also underlines the label. Its ink is `--color-control-quiet` on a light
 * ground and the on-inverse ink on the inverse plate.
 */
const QUIET_BASE =
  "inline-flex items-center gap-xs rounded-control font-body quiet-action underline-offset-4 hover:underline transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed";

const QUIET_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-body-s",
  md: "text-body",
  lg: "text-body-l",
};

const QUIET_GROUND_CLASSES: Record<ControlGround, string> = {
  base: "text-control-quiet",
  sunken: "text-control-quiet",
  inverse: "text-ink-on-inverse",
};

/*
 * `outline` sets no ink of its own: text and edge take the surrounding ink
 * (`currentColor`), so on any ground whose text already passes contrast the
 * edge passes the 3:1 non-text floor with it. A grounded `SectionIntro` sets
 * that ink on its actions row. The edge is an inset ring (a box shadow), not
 * a border, so the box is exactly the `primary` box at the same size. It is
 * one pixel at rest and two on hover, the `--ui-border-hairline` and
 * `--ui-border-rule` values (neither is brandable). Tailwind's `ring-1` and
 * `ring-2` carry them, because a `var()` arbitrary class is not picked up by
 * the `compiled.css` scan, and a class-string look cannot set an inline
 * width.
 */

/*
 * Heights come from the control-height scale (`--ui-control-h-sm/md/lg`,
 * 28/32/36) through the `control-h-*` utilities, whose transparent
 * `::before` keeps the 44px hit area. No block padding: the height is the
 * token, not padding plus line height. Ghost and secondary hover take the
 * translucent tonal step (`--color-control-tonal-hover`), so hover lifts
 * toward the ink in both themes (lighter on a dark ground) instead of
 * sinking to the sunken surface.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "control-h-sm px-sm text-body-s",
  md: "control-h-md px-md text-body",
  lg: "control-h-lg px-lg text-body-l",
};

/**
 * The class string `Button` applies for a variant, size and ground, shared
 * so that `Link` can render the identical look on a link element without
 * copying it. `ground` (default `"base"`) only changes `tonal` and `quiet`;
 * every other variant reads the same on every ground.
 */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize, ground: ControlGround = "base"): string {
  if (variant === "primary" && ground === "inverse") return [BASE, SIZE_CLASSES[size], "bg-action-on-inverse text-ink-primary hover:bg-action-on-inverse-hover"].join(" ");
  if (variant === "quiet") return [QUIET_BASE, QUIET_SIZE_CLASSES[size], QUIET_GROUND_CLASSES[ground]].join(" ");
  if (variant === "tonal") return [BASE, SIZE_CLASSES[size], TONAL_GROUND_CLASSES[ground]].join(" ");
  return [BASE, SIZE_CLASSES[size], VARIANT_CLASSES[variant]].join(" ");
}

/** The package-standard keyboard focus outline, for a link that takes the button look. */
const LINK_FOCUS_CLASSES = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The `Button` look for a plain `<a>` (no React Aria, so server-safe): the
 * same variant and size classes, without `outline-none` (which would also
 * suppress the focus outline) and `disabled:cursor-not-allowed` (a link is
 * never disabled), plus the package-standard `focus-visible` outline. For a
 * call to action that navigates, such as a hero or closing band's action.
 * A `quiet` link carries its own trailing icon: put a decorative
 * `ChevronRight` `Icon` last inside the link.
 */
export function buttonLinkClassName(variant: ButtonVariant, size: ButtonSize, ground: ControlGround = "base"): string {
  const look = buttonClassName(variant, size, ground)
    .split(" ")
    .filter((token) => token !== "outline-none" && token !== "disabled:cursor-not-allowed");
  return [...look, LINK_FOCUS_CLASSES].join(" ");
}

/** The grounds a round icon link is drawn for. Kept as a name for `ControlGround`. */
export type IconButtonLinkGround = ControlGround;

/** An icon-only control's box: `md` is the 44px tap target, `sm` a 28px box (`--ui-control-h-sm`) with a 44px hit area. */
export type IconButtonSize = "sm" | "md";

/** An icon-only control's outline: `circle` on the pill radius, `square` on the control radius. */
export type IconButtonShape = "circle" | "square";

export interface IconButtonClassOptions {
  /** @default "md" */
  size?: IconButtonSize;
  /** @default "circle" */
  shape?: IconButtonShape;
  /** @default "base" */
  ground?: ControlGround;
}

/*
 * One centred icon in a box with a hairline edge. The box sizes and the
 * colour transition (the fast motion tier) come from `theme.css` utilities,
 * `icon-control-md` (44px, `--ui-layout-tap-target`) and `icon-control-sm`
 * (28px, `--ui-control-h-sm`, with a transparent `::before` that pads the hit area to 44px), so
 * they compile into `compiled.css` too. Reduced motion changes colours
 * instantly.
 */
const ICON_BASE =
  "inline-flex shrink-0 items-center justify-center border transition-colors ease-default motion-reduce:transition-none";

const ICON_SIZE_CLASSES: Record<IconButtonSize, string> = {
  md: "icon-control-md",
  sm: "icon-control-sm",
};

const ICON_SHAPE_CLASSES: Record<IconButtonShape, string> = {
  circle: "rounded-pill",
  square: "rounded-control",
};

/**
 * Per ground: rest surface, edge and ink; hover lifts the edge and shifts the
 * surface; pressed takes the ground's strongest edge; selected
 * (`aria-pressed` or `aria-expanded`) fills with the ground's opposite. The
 * focus outline is the package-standard accent outline over a halo in the
 * control's own surface, so the ring reads where it overlaps a ground of the
 * other tone. A disabled control takes no hover.
 */
const ICON_GROUND_CLASSES: Record<ControlGround, string> = {
  base: "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-sunken active:border-ink-primary aria-pressed:bg-surface-inverse aria-pressed:text-ink-on-inverse aria-pressed:border-surface-inverse aria-expanded:bg-surface-inverse aria-expanded:text-ink-on-inverse aria-expanded:border-surface-inverse focus-visible:ring-2 focus-visible:ring-surface-raised",
  sunken:
    "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-base active:border-ink-primary aria-pressed:bg-surface-inverse aria-pressed:text-ink-on-inverse aria-pressed:border-surface-inverse aria-expanded:bg-surface-inverse aria-expanded:text-ink-on-inverse aria-expanded:border-surface-inverse focus-visible:ring-2 focus-visible:ring-surface-raised",
  inverse:
    "bg-surface-inverse-raised text-ink-on-inverse border-line-on-inverse hover:bg-surface-inverse hover:border-ink-on-inverse-muted active:bg-surface-inverse active:border-ink-on-inverse aria-pressed:bg-surface-raised aria-pressed:text-ink-primary aria-pressed:border-surface-raised aria-expanded:bg-surface-raised aria-expanded:text-ink-primary aria-expanded:border-surface-raised focus-visible:ring-2 focus-visible:ring-surface-inverse-raised",
};

const ICON_DISABLED_CLASSES = "disabled:pointer-events-none aria-disabled:pointer-events-none";

/**
 * The icon-only control look (server-safe): one decorative `Icon` centred
 * in a circle or square with a hairline edge, drawn for a base, sunken or
 * inverse ground, with the package-standard `focus-visible` outline. For a
 * control whose glyph says what it does (a scroll cue, carousel or step
 * navigation, a dialog close). The element still needs an accessible name;
 * this class string ships no copy. `IconButton` is the React component that
 * applies it to a button and requires the name.
 */
export function iconButtonClassName({ size = "md", shape = "circle", ground = "base" }: IconButtonClassOptions = {}): string {
  return [ICON_BASE, ICON_SIZE_CLASSES[size], ICON_SHAPE_CLASSES[shape], ICON_GROUND_CLASSES[ground], ICON_DISABLED_CLASSES, LINK_FOCUS_CLASSES].join(" ");
}

/**
 * The round icon-only look for a plain `<a>`: `iconButtonClassName` for a
 * 44px circle on `ground`. Kept for existing callers (a scroll cue, a
 * back-to-top link); the link still needs an accessible name.
 */
export function iconButtonLinkClassName(ground: IconButtonLinkGround = "base"): string {
  return iconButtonClassName({ size: "md", shape: "circle", ground });
}
