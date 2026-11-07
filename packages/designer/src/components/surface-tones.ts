/**
 * Caller data for the stock shadcn@aria Card, Badge and Alert (R2F-29). The
 * stock components stay unmodified: a Foundry tone or surface is the stock
 * variant it maps to plus, where stock has no such variant, one token class.
 */
export type CardSurface = "raised" | "outline" | "plate";

/** `raised` is the stock default card; outline and plate are a className on it. */
export const CARD_SURFACE: Readonly<Record<CardSurface, string | undefined>> = {
  raised: undefined,
  outline: "rounded-panel p-lg ring-0 border border-line-panel",
  plate: "rounded-panel p-lg ring-0 bg-surface-sunken",
};

export type SkeletonShape = "text" | "block" | "circle";

/** The stock Skeleton has no size of its own; a shape is its caller's size class. */
export const SKELETON_SHAPE: Readonly<Record<SkeletonShape, string>> = {
  text: "h-4 w-full",
  block: "h-full w-full",
  circle: "aspect-square rounded-full",
};

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export type BadgeToneProps = {
  readonly variant: "secondary" | "destructive" | "outline";
  readonly className?: string;
};

/** neutral and danger are stock variants; success, warning and info are outline plus a status token class. */
export const BADGE_TONE: Readonly<Record<BadgeTone, BadgeToneProps>> = {
  neutral: { variant: "secondary" },
  danger: { variant: "destructive" },
  success: { variant: "outline", className: "border-transparent bg-status-success-tint text-status-success-text" },
  warning: { variant: "outline", className: "border-transparent bg-status-warning-tint text-status-warning-text" },
  info: { variant: "outline", className: "border-transparent bg-status-info-tint text-status-info-text" },
};

export type AlertTone = "info" | "success" | "warning" | "danger";

export type AlertToneProps = {
  readonly variant: "default" | "destructive";
  /** danger interrupts as an alert; every other tone is a polite status region. */
  readonly role: "alert" | "status";
  readonly "aria-live": "assertive" | "polite";
  readonly className?: string;
};

export const ALERT_TONE: Readonly<Record<AlertTone, AlertToneProps>> = {
  info: { variant: "default", role: "status", "aria-live": "polite" },
  success: { variant: "default", role: "status", "aria-live": "polite", className: "bg-status-success-tint text-status-success-text" },
  warning: { variant: "default", role: "status", "aria-live": "polite", className: "bg-status-warning-tint text-status-warning-text" },
  danger: { variant: "destructive", role: "alert", "aria-live": "assertive" },
};
