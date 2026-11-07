import { GROUND_PAINT } from "../../components/ground-paint.js";

/** Shell chrome plates use a closed ground vocabulary — not structural modes. */
export type ShellGround = "base" | "inverse";

export interface ShellGroundClasses {
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
  readonly border: string;
}

/**
 * Plate policy for persistent shell chrome: the base plate is the Components
 * raised ground and the inverse plate the Components inverse ground, so the
 * shell names no colour of its own.
 */
export const SHELL_GROUND_CLASSES = {
  base: GROUND_PAINT.raised,
  inverse: GROUND_PAINT.inverse,
} as const satisfies Readonly<Record<ShellGround, ShellGroundClasses>>;

/**
 * Ground vocabulary for the site chrome (`SiteHeader`, `SiteFooter`) only.
 * `transparent` paints no plate and no border — the page beneath shows
 * through — and keeps the base ink. `transparent-inverse` paints no plate and
 * no border either, and carries the inverse ink, for chrome over a page that
 * is itself on the inverse ground. `Shell.Header` and `Shell.Footer` stay on
 * the closed `ShellGround` set: widening this type does not widen theirs.
 */
export type SiteChromeGround = ShellGround | "transparent" | "transparent-inverse";

/**
 * Plate policy for the site chrome. `base` and `inverse` are the same
 * entries `SHELL_GROUND_CLASSES` holds; `transparent` and
 * `transparent-inverse` carry no surface and no border class at all (an empty
 * string, so nothing renders) and the base or the inverse ink respectively.
 * Whether a border WIDTH renders is decided by `siteChromeHasBorder`,
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
  "transparent-inverse": {
    surface: "",
    primary: SHELL_GROUND_CLASSES.inverse.primary,
    secondary: SHELL_GROUND_CLASSES.inverse.secondary,
    border: "",
  },
} as const satisfies Readonly<Record<SiteChromeGround, ShellGroundClasses>>;

/** Whether the site chrome paints any border for this ground: no class, no width, no divider. */
export function siteChromeHasBorder(ground: SiteChromeGround): boolean {
  return ground !== "transparent" && ground !== "transparent-inverse";
}
