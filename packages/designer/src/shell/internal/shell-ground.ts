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
