/** Shell chrome plates use a closed ground vocabulary — not structural modes. */
export type ShellGround = "base" | "inverse";

export interface ShellGroundClasses {
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
  readonly border: string;
}

/**
 * Token plate policy for persistent shell chrome. Matches the inverse
 * surface and ink tokens content blocks already use via `SECTION_GROUND_CLASSES`,
 * without pulling `blocks/` into `shell/`.
 */
export const SHELL_GROUND_CLASSES = {
  base: {
    surface: "bg-surface-raised",
    primary: "text-ink-primary",
    secondary: "text-ink-secondary",
    border: "border-line-base",
  },
  inverse: {
    surface: "bg-surface-inverse",
    primary: "text-ink-on-inverse",
    secondary: "text-ink-on-inverse-muted",
    border: "border-line-on-inverse",
  },
} as const satisfies Readonly<Record<ShellGround, ShellGroundClasses>>;

/**
 * Ground vocabulary for the site chrome (`SiteHeader`, `SiteFooter`) only.
 * `transparent` paints no plate and no border — the page beneath shows
 * through — and keeps the base ink. `Shell.Header` and `Shell.Footer` stay on
 * the closed `ShellGround` set: widening this type does not widen theirs.
 */
export type SiteChromeGround = ShellGround | "transparent";

/**
 * Plate policy for the site chrome. `base` and `inverse` are the same
 * entries `SHELL_GROUND_CLASSES` holds; `transparent` carries no surface and
 * no border class at all (an empty string, so nothing renders) and the base
 * ink. Whether a border WIDTH renders is decided by `siteChromeHasBorder`,
 * because the width lives in an inline style rather than a class.
 */
export const SITE_CHROME_GROUND_CLASSES = {
  base: SHELL_GROUND_CLASSES.base,
  inverse: SHELL_GROUND_CLASSES.inverse,
  transparent: {
    surface: "",
    primary: SHELL_GROUND_CLASSES.base.primary,
    secondary: SHELL_GROUND_CLASSES.base.secondary,
    border: "",
  },
} as const satisfies Readonly<Record<SiteChromeGround, ShellGroundClasses>>;

/** Whether the site chrome paints any border for this ground: no class, no width, no divider. */
export function siteChromeHasBorder(ground: SiteChromeGround): boolean {
  return ground !== "transparent";
}
