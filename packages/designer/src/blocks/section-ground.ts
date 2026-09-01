/** The closed set of section grounds supported by Designer-owned site blocks. */
export type SectionGround = "base" | "sunken" | "inverse";

export type SectionStatusTone = "success" | "warning" | "info";

export interface SectionGroundClasses {
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
  readonly muted: string;
  readonly border: string;
  readonly line: string;
  readonly status: Readonly<Record<SectionStatusTone, string>>;
}

/**
 * Designer's complete class/token policy for grounded site sections.
 * Consumers choose one semantic ground; they do not pair foreground,
 * divider, or status colors themselves. Base inherits the ambient base
 * surface so existing compositions keep their markup and background;
 * sunken and inverse paint their semantic surfaces explicitly.
 *
 * Status dots keep the closed success/warning/info display tokens on every
 * ground. Base needs no extra boundary because all three display tokens clear
 * the checked non-text floor there. Sunken and inverse add a two-pixel ring in
 * the ground's primary ink: the display color remains visible, while the
 * checked ring/surface pair supplies a reliable boundary in both themes.
 */
export const SECTION_GROUND_CLASSES = {
  base: {
    surface: "",
    primary: "text-ink-primary",
    secondary: "text-ink-secondary",
    muted: "text-ink-muted",
    border: "border-line-base",
    line: "bg-line-base",
    status: {
      success: "bg-status-success",
      warning: "bg-status-warning",
      info: "bg-status-info",
    },
  },
  sunken: {
    surface: "bg-surface-sunken",
    primary: "text-ink-primary",
    secondary: "text-ink-secondary",
    muted: "text-ink-muted",
    border: "border-line-base",
    line: "bg-line-base",
    status: {
      success: "bg-status-success ring-2 ring-ink-primary",
      warning: "bg-status-warning ring-2 ring-ink-primary",
      info: "bg-status-info ring-2 ring-ink-primary",
    },
  },
  inverse: {
    surface: "bg-surface-inverse",
    primary: "text-ink-on-inverse",
    secondary: "text-ink-on-inverse-muted",
    muted: "text-ink-on-inverse-muted",
    border: "border-line-on-inverse",
    line: "bg-line-on-inverse",
    status: {
      success: "bg-status-success ring-2 ring-ink-on-inverse",
      warning: "bg-status-warning ring-2 ring-ink-on-inverse",
      info: "bg-status-info ring-2 ring-ink-on-inverse",
    },
  },
} as const satisfies Readonly<Record<SectionGround, SectionGroundClasses>>;
