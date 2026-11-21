import type { CandidateName, Sha256 } from "../../types.js";

export type Mode = "light" | "dark";
export type ShadcnVar =
  | "--background" | "--foreground" | "--primary" | "--primary-foreground" | "--secondary" | "--secondary-foreground"
  | "--muted" | "--muted-foreground" | "--accent" | "--accent-foreground" | "--destructive" | "--border" | "--input"
  | "--ring" | "--radius" | "--font-sans" | "--font-heading";

/** The pin a projected CSS variable came from. `sample` marks a package default in use. */
export interface ThemeSource { slot: string; candidate: CandidateName; sha256: Sha256; sample: boolean }

export interface ThemeProjection {
  schema: "clossys.theme/1";
  vars: Record<Mode, Partial<Record<ShadcnVar | `--${string}`, string>>>;
  /** CSS variable -> the pin it came from. */
  sources: Record<string, ThemeSource>;
  inputsSha256: Sha256;
}

/**
 * The resolved `themes.*` pins keyed by slot id, each with its candidate's parsed content (a shadcn
 * `registry:theme` or `registry:font` item). Resolution lives in `@clossys/producer`
 * (`src/read/theme-pins.ts`); this package only projects what it is handed.
 */
export type ResolvedThemePins = Record<string, ThemeSource & { content: unknown }>;
