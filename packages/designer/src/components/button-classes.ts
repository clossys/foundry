import type { CSSProperties } from "react";
import { UI_ALPHA_DISABLED, UI_FOCUS_OFFSET, UI_OUTLINE_FOCUS, UI_OUTLINE_FOCUS_INVERSE } from "./internal/ui-vars.js";
import type { ButtonSize, ButtonVariant } from "./Button.js";

/**
 * The grounds a control is drawn for: the page ground (`base`), a sunken
 * band (`sunken`) or the dark inverse plate (`inverse`). Only the ground-aware
 * looks (`tonal`, `quiet` and the icon-only control) change with it.
 */
export type ControlGround = "base" | "sunken" | "inverse";

const BASE =
  "inline-flex max-w-full items-center justify-center gap-sm whitespace-nowrap rounded-control text-body font-body transition-colors motion-reduce:transition-none outline-none disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
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
export type ControlAppearanceVariant = ButtonVariant | "tonal" | "quiet";

/** Button accepts only treatments declared by its component contract. */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize, ground: ControlGround = "base"): string {
  if (!Object.hasOwn(VARIANT_CLASSES, variant)) throw new TypeError(`Button: unsupported variant ${variant}`);
  return buttonLookClassName(variant, size, ground);
}

/** Links and toggles keep their separately supported tonal and quiet treatments. */
export function buttonLookClassName(variant: ControlAppearanceVariant, size: ButtonSize, ground: ControlGround = "base"): string {
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
export function buttonLinkClassName(variant: ControlAppearanceVariant, size: ButtonSize, ground: ControlGround = "base"): string {
  const look = buttonLookClassName(variant, size, ground)
    .split(" ")
    .filter((token) => token !== "outline-none" && token !== "disabled:cursor-not-allowed");
  return [...look, LINK_FOCUS_CLASSES].join(" ");
}

/** The grounds a round icon link is drawn for. Kept as a name for `ControlGround`. */
export type IconButtonLinkGround = ControlGround;

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
  base: "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-sunken active:border-ink-primary aria-pressed:bg-surface-inverse aria-pressed:text-ink-on-inverse aria-pressed:border-surface-inverse aria-expanded:bg-surface-inverse aria-expanded:text-ink-on-inverse aria-expanded:border-surface-inverse",
  sunken:
    "bg-surface-raised text-ink-primary border-line-base hover:bg-control-tonal-hover hover:border-line-strong active:bg-surface-base active:border-ink-primary aria-pressed:bg-surface-inverse aria-pressed:text-ink-on-inverse aria-pressed:border-surface-inverse aria-expanded:bg-surface-inverse aria-expanded:text-ink-on-inverse aria-expanded:border-surface-inverse",
  inverse:
    "bg-surface-inverse-raised text-ink-on-inverse border-line-on-inverse hover:bg-surface-inverse hover:border-ink-on-inverse-muted active:bg-surface-inverse active:border-ink-on-inverse aria-pressed:bg-surface-raised aria-pressed:text-ink-primary aria-pressed:border-surface-raised aria-expanded:bg-surface-raised aria-expanded:text-ink-primary aria-expanded:border-surface-raised",
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
export function iconButtonClassName({ size = "md", shape = "square", ground = "base" }: IconButtonClassOptions = {}): string {
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

/** Token-bound geometry; visual height is independent of line height and padding. */
export function controlSizeStyle(size: ButtonSize = "md"): CSSProperties {
  return { boxSizing: "border-box", paddingBlock: 0, blockSize: `var(--ui-control-h-${size})`, minBlockSize: `var(--ui-control-h-${size})` };
}

/**
 * A state layer paints over the existing fill, including a selected fill. The
 * two alpha roles are deliberately independent; neither changes label opacity.
 * Inline state styles also work for consumers of the precompiled stylesheet.
 */
export function controlStateStyle(
  state: { isHovered?: boolean; isPressed?: boolean; isFocusVisible?: boolean; isDisabled?: boolean },
  { ground = "base", dimDisabled = true }: { ground?: ControlGround; dimDisabled?: boolean } = {},
): CSSProperties {
  const alpha = state.isPressed ? "--ui-state-pressed-alpha" : state.isHovered ? "--ui-state-hover-alpha" : undefined;
  // currentColor follows the control's token-bound selected/inverse ink too.
  const layer = `color-mix(in srgb, currentColor calc(var(${alpha}) * 100%), transparent)`;
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
