/**
 * The token catalog: every custom property this package declares in
 * `styles/tokens.css`, as data. This file is the JS/TS half of the package;
 * `styles/tokens.css` is the CSS half. Both are hand-authored and both are
 * meant to describe the exact same 128 tokens — a test in this package
 * (`parity.test.ts`) parses `styles/tokens.css` and asserts its custom
 * property names and values match this file entry-for-entry, in both
 * directions. That test is what keeps this file honest; nothing generates
 * one from the other.
 *
 * NAMING RULE (see the README for the full explanation):
 *
 *   1. If Tailwind v4 has a `@theme` namespace for this kind of value —
 *      color, font size, font family, letter-spacing, spacing, radius,
 *      easing, breakpoint — the property uses that namespace's exact
 *      prefix, unmodified: `--color-*`, `--text-*`, `--font-*`,
 *      `--tracking-*`, `--spacing-*`, `--radius-*`, `--ease-*`,
 *      `--breakpoint-*`. `styles/theme.css` wires these into Tailwind's
 *      `@theme inline` block so utilities like `bg-surface-raised` exist.
 *   2. If Tailwind has no namespace for it — z-index, elevation, motion
 *      duration, layout widths, density, ring, border width, disabled
 *      alpha — the property is prefixed `--ui-`. Nothing in this family
 *      generates a Tailwind utility; a consumer reads it with a plain
 *      `var(--ui-z-modal)`. The `--ui-` prefix exists only so these can't
 *      collide with a consumer's own unrelated custom properties, since
 *      there's no Tailwind namespace convention to keep them safe.
 *
 * Every token in this file was admitted by the same two-part test:
 *   (a) it names a distinct semantic ROLE, not a raw value
 *       (`surface-raised`, never `grey-100`), and
 *   (b) it cannot be produced in one step from another token here via
 *       `rgba()`/`color-mix()`/`clamp()`/`calc()`.
 * A value that fails either test is a composition the README's derivation
 * guidance covers, not a new token.
 */

/**
 * The 24 semantic groups the 128 tokens fall into. Each maps to exactly one
 * CSS custom property prefix — see `FAMILY_PREFIX` in `parity.test.ts` (and
 * the README's naming table) for the concrete mapping.
 */
export type TokenFamily =
  | "surface"
  | "ink"
  | "line"
  | "accent"
  | "status"
  | "neutral"
  | "overlay"
  | "skeleton"
  | "text"
  | "font"
  | "tracking"
  | "spacing"
  | "width"
  | "layout"
  | "density"
  | "radius"
  | "border"
  | "elevation"
  | "ring"
  | "duration"
  | "easing"
  | "z"
  | "breakpoint"
  | "alpha";

/** One token: a CSS custom property, its default (unbranded) value, and where it belongs. */
export interface TokenDefinition {
  /** The full CSS custom property name, including the leading `--`. */
  readonly property: string;
  /** Which of the 24 semantic groups this token belongs to. */
  readonly family: TokenFamily;
  /** The value declared for this property in `styles/tokens.css`'s `:root` block. */
  readonly value: string;
  /**
   * `true` if a brand is expected to override this token — its property name
   * appears (live or as a fill-in-the-blank comment) in `styles/brand-template.css`.
   * `false` means the value is structural (a fixed scale, an internal alias,
   * a composite that already reads other brandable tokens) and stays as
   * shipped regardless of brand.
   */
  readonly brandable: boolean;
}

/**
 * All 128 tokens, keyed by their CSS custom property name. A `Record` rather
 * than an array because the natural question from JS — "what is
 * `--color-surface-raised` set to?" — is a lookup, not a scan.
 */
export const TOKENS: Readonly<Record<string, TokenDefinition>> = {
  // ── COLOR · SURFACE ─────────────────────────────────────────────────
  "--color-surface-base": { property: "--color-surface-base", family: "surface", value: "oklch(0.9702 0 0)", brandable: true },
  "--color-surface-sunken": { property: "--color-surface-sunken", family: "surface", value: "oklch(0.9401 0 0)", brandable: true },
  "--color-surface-raised": { property: "--color-surface-raised", family: "surface", value: "oklch(1 0 0)", brandable: true },
  "--color-surface-inverse": { property: "--color-surface-inverse", family: "surface", value: "oklch(0.2178 0 0)", brandable: true },
  "--color-surface-inverse-raised": { property: "--color-surface-inverse-raised", family: "surface", value: "oklch(0.285 0 0)", brandable: true },
  "--color-surface-aside": { property: "--color-surface-aside", family: "surface", value: "oklch(0.9612 0 0)", brandable: true },
  "--color-surface-selected": { property: "--color-surface-selected", family: "surface", value: "oklch(0.4748 0 0 / 0.1)", brandable: true },

  // ── COLOR · INK ──────────────────────────────────────────────────────
  "--color-ink-primary": { property: "--color-ink-primary", family: "ink", value: "oklch(0.2178 0 0)", brandable: true },
  "--color-ink-secondary": { property: "--color-ink-secondary", family: "ink", value: "oklch(0.36 0 0)", brandable: true },
  "--color-ink-muted": { property: "--color-ink-muted", family: "ink", value: "oklch(0.5658 0 0)", brandable: true },
  "--color-ink-link": { property: "--color-ink-link", family: "ink", value: "oklch(0.36 0 0)", brandable: true },
  "--color-ink-on-inverse": { property: "--color-ink-on-inverse", family: "ink", value: "oklch(0.9702 0 0)", brandable: true },
  "--color-ink-on-inverse-muted": { property: "--color-ink-on-inverse-muted", family: "ink", value: "oklch(0.7763 0 0)", brandable: true },
  "--color-ink-on-accent": { property: "--color-ink-on-accent", family: "ink", value: "var(--color-ink-on-inverse, oklch(0.9702 0 0))", brandable: false },

  // ── COLOR · LINE ─────────────────────────────────────────────────────
  "--color-line-base": { property: "--color-line-base", family: "line", value: "oklch(0.8761 0 0)", brandable: true },
  "--color-line-strong": { property: "--color-line-strong", family: "line", value: "oklch(0.7763 0 0)", brandable: true },
  "--color-line-on-inverse": { property: "--color-line-on-inverse", family: "line", value: "oklch(0.9702 0 0 / 0.14)", brandable: true },

  // ── COLOR · ACCENT ───────────────────────────────────────────────────
  "--color-accent": { property: "--color-accent", family: "accent", value: "oklch(0.4748 0 0)", brandable: true },
  "--color-accent-text": { property: "--color-accent-text", family: "accent", value: "oklch(0.36 0 0)", brandable: true },
  "--color-accent-hover": { property: "--color-accent-hover", family: "accent", value: "oklch(0.36 0 0)", brandable: true },
  "--color-accent-tint": { property: "--color-accent-tint", family: "accent", value: "oklch(0.4748 0 0 / 0.1)", brandable: true },
  "--color-accent-on-inverse": { property: "--color-accent-on-inverse", family: "accent", value: "oklch(0.7763 0 0)", brandable: true },

  // ── COLOR · STATUS ───────────────────────────────────────────────────
  "--color-status-success": { property: "--color-status-success", family: "status", value: "oklch(0.6268 0 0)", brandable: true },
  "--color-status-success-text": { property: "--color-status-success-text", family: "status", value: "oklch(0.4748 0 0)", brandable: true },
  "--color-status-success-tint": { property: "--color-status-success-tint", family: "status", value: "oklch(0.6268 0 0 / 0.1)", brandable: true },
  "--color-status-warning": { property: "--color-status-warning", family: "status", value: "oklch(0.4495 0 0)", brandable: true },
  "--color-status-warning-text": { property: "--color-status-warning-text", family: "status", value: "oklch(0.36 0 0)", brandable: true },
  "--color-status-warning-tint": { property: "--color-status-warning-tint", family: "status", value: "oklch(0.4495 0 0 / 0.12)", brandable: true },
  "--color-status-danger": { property: "--color-status-danger", family: "status", value: "oklch(0.285 0 0)", brandable: true },
  "--color-status-danger-text": { property: "--color-status-danger-text", family: "status", value: "oklch(0.2178 0 0)", brandable: true },
  "--color-status-danger-tint": { property: "--color-status-danger-tint", family: "status", value: "oklch(0.285 0 0 / 0.12)", brandable: true },
  "--color-status-info": { property: "--color-status-info", family: "status", value: "oklch(0.5658 0 0)", brandable: true },
  "--color-status-info-text": { property: "--color-status-info-text", family: "status", value: "oklch(0.4748 0 0)", brandable: true },
  "--color-status-info-tint": { property: "--color-status-info-tint", family: "status", value: "oklch(0.5658 0 0 / 0.08)", brandable: true },

  // ── COLOR · NEUTRAL (fixed greyscale ramp — not brand-bound) ─────────
  "--color-neutral-50": { property: "--color-neutral-50", family: "neutral", value: "oklch(0.9702 0 0)", brandable: false },
  "--color-neutral-100": { property: "--color-neutral-100", family: "neutral", value: "oklch(0.9401 0 0)", brandable: false },
  "--color-neutral-200": { property: "--color-neutral-200", family: "neutral", value: "oklch(0.8761 0 0)", brandable: false },
  "--color-neutral-300": { property: "--color-neutral-300", family: "neutral", value: "oklch(0.7763 0 0)", brandable: false },
  "--color-neutral-400": { property: "--color-neutral-400", family: "neutral", value: "oklch(0.6334 0 0)", brandable: false },
  "--color-neutral-500": { property: "--color-neutral-500", family: "neutral", value: "oklch(0.5658 0 0)", brandable: false },
  "--color-neutral-600": { property: "--color-neutral-600", family: "neutral", value: "oklch(0.4748 0 0)", brandable: false },
  "--color-neutral-700": { property: "--color-neutral-700", family: "neutral", value: "oklch(0.36 0 0)", brandable: false },
  "--color-neutral-800": { property: "--color-neutral-800", family: "neutral", value: "oklch(0.285 0 0)", brandable: false },
  "--color-neutral-900": { property: "--color-neutral-900", family: "neutral", value: "oklch(0.2178 0 0)", brandable: false },
  "--color-neutral-950": { property: "--color-neutral-950", family: "neutral", value: "oklch(0.1684 0 0)", brandable: false },

  // ── COLOR · OVERLAY (Modal/Popover/Menu/Tooltip/Toast surface bundle) ─
  "--color-overlay-surface": { property: "--color-overlay-surface", family: "overlay", value: "var(--color-surface-raised, oklch(1 0 0))", brandable: false },
  "--color-overlay-border": { property: "--color-overlay-border", family: "overlay", value: "var(--color-line-base, oklch(0.8761 0 0))", brandable: false },
  "--color-overlay-scrim": { property: "--color-overlay-scrim", family: "overlay", value: "oklch(0 0 0 / 0.4)", brandable: false },

  // ── COLOR · SKELETON ─────────────────────────────────────────────────
  "--color-skeleton-fill": { property: "--color-skeleton-fill", family: "skeleton", value: "var(--color-surface-sunken, oklch(0.9401 0 0))", brandable: false },

  // ── TEXT (font-size ramp — fixed scale, not brand-bound) ──────────────
  "--text-display-xl": { property: "--text-display-xl", family: "text", value: "72px", brandable: false },
  "--text-display-l": { property: "--text-display-l", family: "text", value: "56px", brandable: false },
  "--text-display-m": { property: "--text-display-m", family: "text", value: "40px", brandable: false },
  "--text-h0": { property: "--text-h0", family: "text", value: "32px", brandable: false },
  "--text-h1": { property: "--text-h1", family: "text", value: "28px", brandable: false },
  "--text-h2": { property: "--text-h2", family: "text", value: "18px", brandable: false },
  "--text-h3": { property: "--text-h3", family: "text", value: "14px", brandable: false },
  "--text-body-l": { property: "--text-body-l", family: "text", value: "17px", brandable: false },
  "--text-body": { property: "--text-body", family: "text", value: "15px", brandable: false },
  "--text-body-s": { property: "--text-body-s", family: "text", value: "13px", brandable: false },
  "--text-blockquote": { property: "--text-blockquote", family: "text", value: "22px", brandable: false },
  "--text-caption": { property: "--text-caption", family: "text", value: "12px", brandable: false },
  "--text-code-block": { property: "--text-code-block", family: "text", value: "13px", brandable: false },

  // ── FONT ────────────────────────────────────────────────────────────
  "--font-display": { property: "--font-display", family: "font", value: "system-ui, ui-sans-serif, -apple-system, \"Segoe UI\", sans-serif", brandable: true },
  "--font-body": { property: "--font-body", family: "font", value: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif", brandable: true },
  "--font-mono": { property: "--font-mono", family: "font", value: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace", brandable: true },

  // ── TRACKING (fixed role scale) ────────────────────────────────────
  "--tracking-tight": { property: "--tracking-tight", family: "tracking", value: "-0.01em", brandable: false },
  "--tracking-meta": { property: "--tracking-meta", family: "tracking", value: "0.06em", brandable: false },
  "--tracking-nav": { property: "--tracking-nav", family: "tracking", value: "0.12em", brandable: false },
  "--tracking-label": { property: "--tracking-label", family: "tracking", value: "0.18em", brandable: false },

  // ── SPACING (fixed 4px-rooted scale) ───────────────────────────────
  "--spacing-xs": { property: "--spacing-xs", family: "spacing", value: "4px", brandable: false },
  "--spacing-sm": { property: "--spacing-sm", family: "spacing", value: "8px", brandable: false },
  "--spacing-md": { property: "--spacing-md", family: "spacing", value: "12px", brandable: false },
  "--spacing-lg": { property: "--spacing-lg", family: "spacing", value: "16px", brandable: false },
  "--spacing-xl": { property: "--spacing-xl", family: "spacing", value: "24px", brandable: false },
  "--spacing-2xl": { property: "--spacing-2xl", family: "spacing", value: "32px", brandable: false },
  "--spacing-3xl": { property: "--spacing-3xl", family: "spacing", value: "48px", brandable: false },
  "--spacing-4xl": { property: "--spacing-4xl", family: "spacing", value: "64px", brandable: false },
  "--spacing-5xl": { property: "--spacing-5xl", family: "spacing", value: "96px", brandable: false },
  "--spacing-6xl": { property: "--spacing-6xl", family: "spacing", value: "128px", brandable: false },

  // ── UI · WIDTH (no Tailwind namespace — raw var() only) ───────────
  "--ui-width-content-max": { property: "--ui-width-content-max", family: "width", value: "64rem", brandable: true },
  "--ui-width-prose-max": { property: "--ui-width-prose-max", family: "width", value: "48rem", brandable: true },
  "--ui-width-wide-max": { property: "--ui-width-wide-max", family: "width", value: "72rem", brandable: true },
  "--ui-width-page-padding-x": { property: "--ui-width-page-padding-x", family: "width", value: "clamp(16px, 4vw, 48px)", brandable: false },

  // ── UI · LAYOUT ─────────────────────────────────────────────────────
  "--ui-layout-sidebar-w": { property: "--ui-layout-sidebar-w", family: "layout", value: "256px", brandable: true },
  "--ui-layout-sidebar-rail-w": { property: "--ui-layout-sidebar-rail-w", family: "layout", value: "64px", brandable: false },
  "--ui-layout-aside-w": { property: "--ui-layout-aside-w", family: "layout", value: "320px", brandable: false },

  // ── UI · DENSITY ────────────────────────────────────────────────────
  "--ui-density-pad": { property: "--ui-density-pad", family: "density", value: "var(--spacing-xl, 24px)", brandable: false },
  "--ui-density-gap": { property: "--ui-density-gap", family: "density", value: "var(--spacing-lg, 16px)", brandable: false },
  "--ui-density-row": { property: "--ui-density-row", family: "density", value: "var(--spacing-3xl, 48px)", brandable: false },

  // ── RADIUS (Tailwind `--radius-*` namespace) ───────────────────────
  "--radius-sharp": { property: "--radius-sharp", family: "radius", value: "0px", brandable: false },
  "--radius-subtle": { property: "--radius-subtle", family: "radius", value: "2px", brandable: false },
  "--radius-default": { property: "--radius-default", family: "radius", value: "3px", brandable: true },
  "--radius-control": { property: "--radius-control", family: "radius", value: "6px", brandable: false },
  "--radius-pill": { property: "--radius-pill", family: "radius", value: "999px", brandable: false },

  // ── UI · BORDER ─────────────────────────────────────────────────────
  "--ui-border-hairline": { property: "--ui-border-hairline", family: "border", value: "1px", brandable: false },

  // ── UI · ELEVATION ──────────────────────────────────────────────────
  "--ui-elevation-none": { property: "--ui-elevation-none", family: "elevation", value: "none", brandable: false },
  "--ui-elevation-raised": { property: "--ui-elevation-raised", family: "elevation", value: "0 1px 0 var(--color-line-base, oklch(0.8761 0 0))", brandable: false },
  "--ui-elevation-floating": { property: "--ui-elevation-floating", family: "elevation", value: "0 8px 24px rgba(0, 0, 0, 0.10)", brandable: false },

  // ── UI · RING ───────────────────────────────────────────────────────
  "--ui-ring-focus": { property: "--ui-ring-focus", family: "ring", value: "0 0 0 2px var(--color-accent, oklch(0.4748 0 0))", brandable: false },
  "--ui-ring-on-inverse": { property: "--ui-ring-on-inverse", family: "ring", value: "0 0 0 1px rgba(245, 245, 245, 0.12)", brandable: false },

  // ── UI · DURATION ───────────────────────────────────────────────────
  "--ui-duration-instant": { property: "--ui-duration-instant", family: "duration", value: "80ms", brandable: false },
  "--ui-duration-fast": { property: "--ui-duration-fast", family: "duration", value: "160ms", brandable: false },
  "--ui-duration-default": { property: "--ui-duration-default", family: "duration", value: "240ms", brandable: false },
  "--ui-duration-deliberate": { property: "--ui-duration-deliberate", family: "duration", value: "500ms", brandable: false },
  "--ui-duration-flash": { property: "--ui-duration-flash", family: "duration", value: "1200ms", brandable: false },
  "--ui-duration-overlay": { property: "--ui-duration-overlay", family: "duration", value: "var(--ui-duration-fast, 160ms)", brandable: false },

  // ── EASING (Tailwind `--ease-*` namespace) ─────────────────────────
  "--ease-default": { property: "--ease-default", family: "easing", value: "cubic-bezier(.2, 0, 0, 1)", brandable: false },
  "--ease-decelerate": { property: "--ease-decelerate", family: "easing", value: "cubic-bezier(0, 0, .2, 1)", brandable: false },
  "--ease-accelerate": { property: "--ease-accelerate", family: "easing", value: "cubic-bezier(.4, 0, 1, 1)", brandable: false },
  "--ease-bounce": { property: "--ease-bounce", family: "easing", value: "cubic-bezier(.2, .8, .2, 1)", brandable: false },
  "--ease-enter": { property: "--ease-enter", family: "easing", value: "var(--ease-decelerate, cubic-bezier(0, 0, .2, 1))", brandable: false },
  "--ease-exit": { property: "--ease-exit", family: "easing", value: "var(--ease-accelerate, cubic-bezier(.4, 0, 1, 1))", brandable: false },

  // ── UI · Z-INDEX ────────────────────────────────────────────────────
  "--ui-z-base": { property: "--ui-z-base", family: "z", value: "0", brandable: false },
  "--ui-z-sticky": { property: "--ui-z-sticky", family: "z", value: "10", brandable: false },
  "--ui-z-shell": { property: "--ui-z-shell", family: "z", value: "20", brandable: false },
  "--ui-z-aside": { property: "--ui-z-aside", family: "z", value: "30", brandable: false },
  "--ui-z-notice": { property: "--ui-z-notice", family: "z", value: "40", brandable: false },
  "--ui-z-modal": { property: "--ui-z-modal", family: "z", value: "50", brandable: false },
  "--ui-z-toast": { property: "--ui-z-toast", family: "z", value: "60", brandable: false },
  "--ui-z-palette": { property: "--ui-z-palette", family: "z", value: "70", brandable: false },
  "--ui-z-tooltip": { property: "--ui-z-tooltip", family: "z", value: "80", brandable: false },

  // ── BREAKPOINT (Tailwind `--breakpoint-*` namespace) ────────────────
  "--breakpoint-mobile": { property: "--breakpoint-mobile", family: "breakpoint", value: "375px", brandable: false },
  "--breakpoint-mobile-lg": { property: "--breakpoint-mobile-lg", family: "breakpoint", value: "480px", brandable: false },
  "--breakpoint-tablet": { property: "--breakpoint-tablet", family: "breakpoint", value: "768px", brandable: false },
  "--breakpoint-tablet-lg": { property: "--breakpoint-tablet-lg", family: "breakpoint", value: "1024px", brandable: false },
  "--breakpoint-desktop": { property: "--breakpoint-desktop", family: "breakpoint", value: "1280px", brandable: false },
  "--breakpoint-wide": { property: "--breakpoint-wide", family: "breakpoint", value: "1440px", brandable: false },

  // ── UI · ALPHA ──────────────────────────────────────────────────────
  "--ui-alpha-disabled": { property: "--ui-alpha-disabled", family: "alpha", value: "0.5", brandable: false },
};

/** The 24 semantic families, in the order they appear in the README's reference table. */
export const TOKEN_FAMILIES: readonly TokenFamily[] = [
  "surface",
  "ink",
  "line",
  "accent",
  "status",
  "neutral",
  "overlay",
  "skeleton",
  "text",
  "font",
  "tracking",
  "spacing",
  "width",
  "layout",
  "density",
  "radius",
  "border",
  "elevation",
  "ring",
  "duration",
  "easing",
  "z",
  "breakpoint",
  "alpha",
];
