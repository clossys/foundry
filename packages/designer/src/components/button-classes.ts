import type { CSSProperties } from "react";
import { UI_ALPHA_DISABLED, UI_FOCUS_OFFSET, UI_OUTLINE_FOCUS, UI_OUTLINE_FOCUS_INVERSE } from "./internal/ui-vars.js";
/**
 * Internal looks still drawn by native controls that have not moved to the stock
 * shadcn@aria `buttonVariants` (NativeAction, SearchField). Public callers use
 * `buttonVariants` from the stock button; the mapping from these looks is
 * primary -> default, secondary -> secondary, ghost -> ghost, danger -> destructive,
 * outline -> outline, tonal -> secondary, quiet -> link; sizes sm/md/lg -> sm/default/lg
 * and icon sizes sm/md/lg -> icon-sm/icon/icon-lg. The ground axis (base/sunken/inverse)
 * and the icon shape have no stock axis and are dropped.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "tonal" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

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
  inverse: "bg-background/12 text-background hover:bg-background/16",
};

/*
 * `quiet` (T4) is a chevron text button: no fill, no edge and no inline
 * padding, so it aligns to the text edge. `quiet-action` (a `theme.css`
 * utility) retains the 44px hit area around its token-height box and nudges the trailing
 * icon toward the inline end on hover, never under reduced motion; hover
 * also underlines the label. Its ink is `--color-control-quiet` on a light
 * ground and the on-inverse ink on the inverse plate.
 */
const QUIET_BASE =
  "inline-flex items-center gap-xs rounded-control font-body quiet-action underline-offset-4 hover:underline transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed";

const QUIET_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "control-h-sm text-body-s",
  md: "control-h-md text-body",
  lg: "control-h-lg text-body-l",
};

const QUIET_GROUND_CLASSES: Record<ControlGround, string> = {
  base: "text-control-quiet",
  sunken: "text-control-quiet",
  inverse: "text-background",
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
 * The class string a native control applies for a variant, size and ground.
 * `ground` (default `"base"`) only changes `tonal` and `quiet`; every other
 * variant reads the same on every ground.
 */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize, ground: ControlGround = "base"): string {
  if (variant === "primary" && ground === "inverse") return [BASE, SIZE_CLASSES[size], "bg-primary-foreground text-ink-primary hover:bg-primary-foreground/90"].join(" ");
  if (variant === "quiet") return [QUIET_BASE, QUIET_SIZE_CLASSES[size], QUIET_GROUND_CLASSES[ground]].join(" ");
  if (variant === "tonal") return [BASE, SIZE_CLASSES[size], TONAL_GROUND_CLASSES[ground]].join(" ");
  return [BASE, SIZE_CLASSES[size], VARIANT_CLASSES[variant]].join(" ");
}

/** The package-standard keyboard focus outline, for a native control drawn with an icon look. */
const LINK_FOCUS_CLASSES = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The inverse-plate ink for a native control drawn with a base look: the
 * on-inverse ink at rest, on hover and on focus, the inverse tonal hover and
 * an on-inverse focus outline.
 */
export const INVERSE_CONTROL_INK = "text-background hover:text-background focus-visible:text-background hover:bg-background/16 focus-visible:outline-background";

/** The visual size of an icon control on the shared sm/md/lg control-height scale. */
export type IconButtonSize = "sm" | "md" | "lg";

/** An icon-only control's outline: `circle` on the pill radius, `square` on the control radius. */
export type IconButtonShape = "circle" | "square";

export interface IconButtonClassOptions {
  /** @default "md" */
  size?: IconButtonSize;
  /** @default "square" */
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
  lg: "control-h-lg",
};

const ICON_SHAPE_CLASSES: Record<IconButtonShape, string> = {
  circle: "rounded-pill",
  square: "rounded-control",
};

/**
 * Per ground: rest surface, edge and ink; hover lifts the edge and shifts the
 * surface; pressed takes the ground's strongest edge; selected
 * (`aria-pressed` or `aria-expanded`) fills with the ground's opposite. The
 * focus indicator is one package-standard offset accent outline. Native
 * components add the shared state layer and disabled tokens through
 * `controlStateStyle`; there is no second focus halo.
 */
const ICON_GROUND_CLASSES: Record<ControlGround, string> = {
  base: "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-sunken active:border-ink-primary aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:border-foreground aria-expanded:bg-foreground aria-expanded:text-background aria-expanded:border-foreground",
  sunken:
    "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-base active:border-ink-primary aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:border-foreground aria-expanded:bg-foreground aria-expanded:text-background aria-expanded:border-foreground",
  inverse:
    "bg-card-foreground text-background border-background/14 hover:bg-foreground hover:border-background/75 active:bg-foreground active:border-background aria-pressed:bg-surface-raised aria-pressed:text-ink-primary aria-pressed:border-surface-raised aria-expanded:bg-surface-raised aria-expanded:text-ink-primary aria-expanded:border-surface-raised",
};

const ICON_DISABLED_CLASSES = "disabled:pointer-events-none aria-disabled:pointer-events-none";

/**
 * The icon-only control look (server-safe): one decorative `Icon` centred
 * in a circle or square with a hairline edge, drawn for a base, sunken or
 * inverse ground, with the package-standard `focus-visible` outline. For a
 * control whose glyph says what it does (a scroll cue, carousel or step
 * navigation, a dialog close). The element still needs an accessible name;
 * this class string ships no copy. Icon-only buttons are the stock
 * `Button size="icon"` with an `aria-label`.
 */
export function iconButtonClassName({ size = "md", shape = "square", ground = "base" }: IconButtonClassOptions = {}): string {
  return [ICON_BASE, ICON_SIZE_CLASSES[size], ICON_SHAPE_CLASSES[shape], ICON_GROUND_CLASSES[ground], ICON_DISABLED_CLASSES, LINK_FOCUS_CLASSES].join(" ");
}

/** The control-height token of each size, as literal reads so every var() names its property. */
const CONTROL_HEIGHT = { sm: "var(--ui-control-h-sm)", md: "var(--ui-control-h-md)", lg: "var(--ui-control-h-lg)" } as const satisfies Record<ButtonSize, string>;

/** The control-height token read for one size. */
export function controlHeight(size: ButtonSize = "md"): string {
  return CONTROL_HEIGHT[size];
}

/** Token-bound geometry; visual height is independent of line height and padding. */
export function controlSizeStyle(size: ButtonSize = "md"): CSSProperties {
  return { boxSizing: "border-box", paddingBlock: 0, blockSize: controlHeight(size), minBlockSize: controlHeight(size) };
}

/** The two state-layer alpha tokens, as literal reads. */
const STATE_ALPHA = { pressed: "var(--ui-state-pressed-alpha)", hover: "var(--ui-state-hover-alpha)" } as const;

/**
 * A state layer paints over the existing fill, including a selected fill. The
 * two alpha roles are deliberately independent; neither changes label opacity.
 * Inline state styles also work for consumers of the precompiled stylesheet.
 */
export function controlStateStyle(
  state: { isHovered?: boolean; isPressed?: boolean; isFocusVisible?: boolean; isDisabled?: boolean },
  { ground = "base", dimDisabled = true }: { ground?: ControlGround; dimDisabled?: boolean } = {},
): CSSProperties {
  const alpha = state.isPressed ? STATE_ALPHA.pressed : state.isHovered ? STATE_ALPHA.hover : undefined;
  // currentColor follows the control's token-bound selected/inverse ink too.
  const layer = `color-mix(in srgb, currentColor calc(${alpha} * 100%), transparent)`;
  return {
    backgroundImage: !state.isDisabled && alpha ? `linear-gradient(${layer}, ${layer})` : undefined,
    color: state.isDisabled ? "var(--color-ink-muted)" : undefined,
    backgroundColor: state.isDisabled ? "var(--color-control-tonal)" : undefined,
    borderColor: state.isDisabled ? "var(--color-line-base)" : undefined,
    opacity: state.isDisabled && dimDisabled ? UI_ALPHA_DISABLED : undefined,
    outline: state.isFocusVisible ? (ground === "inverse" ? UI_OUTLINE_FOCUS_INVERSE : UI_OUTLINE_FOCUS) : undefined,
    outlineOffset: state.isFocusVisible ? UI_FOCUS_OFFSET : undefined,
  };
}
