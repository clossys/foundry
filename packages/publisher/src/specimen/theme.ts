/**
 * Theme selection and theme CSS for a specimen. Variables are read and written by their
 * shadcn names only (`--primary`, `--background`, ...), never by any token id.
 */
import type { SpecimenTheme } from "./types.js";

export type SpecimenMode = "light" | "dark";
export interface ThemeRequest { readonly id?: string; readonly mode: SpecimenMode }

const THEME_ID = /^[A-Za-z0-9@][A-Za-z0-9@._/-]{0,199}$/;

/** `light` | `dark` | `<id>` | `<id>:light` | `<id>:dark`; undefined for a malformed value. */
export function parseThemeParam(value: string | null | undefined): ThemeRequest | undefined {
  if (value === null || value === undefined || value === "") return { mode: "light" };
  if (value === "light" || value === "dark") return { mode: value };
  const [id, mode, extra] = value.split(":");
  if (extra !== undefined || !id || !THEME_ID.test(id) || id.split("/").includes("..")) return undefined;
  if (mode !== undefined && mode !== "light" && mode !== "dark") return undefined;
  return { id, mode: (mode as SpecimenMode | undefined) ?? "light" };
}

const declarations = (vars: Readonly<Record<string, string>> | undefined) =>
  Object.entries(vars ?? {}).map(([name, value]) => `--${name}:${value};`).join("");

/** `:root` carries the shared and light variables, `.dark` the dark overrides. */
export function themeCss(theme: SpecimenTheme | undefined): string {
  if (!theme) return "";
  return `:root{${declarations(theme.theme)}${declarations(theme.light)}}.dark{${declarations(theme.dark)}}`;
}

/** The shadcn theme mapping: Tailwind color and radius utilities read the shadcn variables. */
export const SHADCN_THEME_INLINE = `@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background, oklch(1 0 0)); --color-foreground: var(--foreground, oklch(0.145 0 0));
  --color-card: var(--card, oklch(1 0 0)); --color-card-foreground: var(--card-foreground, oklch(0.145 0 0));
  --color-popover: var(--popover, oklch(1 0 0)); --color-popover-foreground: var(--popover-foreground, oklch(0.145 0 0));
  --color-primary: var(--primary, oklch(0.205 0 0)); --color-primary-foreground: var(--primary-foreground, oklch(0.985 0 0));
  --color-secondary: var(--secondary, oklch(0.97 0 0)); --color-secondary-foreground: var(--secondary-foreground, oklch(0.205 0 0));
  --color-muted: var(--muted, oklch(0.97 0 0)); --color-muted-foreground: var(--muted-foreground, oklch(0.556 0 0));
  --color-accent: var(--accent, oklch(0.97 0 0)); --color-accent-foreground: var(--accent-foreground, oklch(0.205 0 0));
  --color-destructive: var(--destructive, oklch(0.577 0.245 27.325)); --color-border: var(--border, oklch(0.922 0 0)); --color-input: var(--input, oklch(0.922 0 0)); --color-ring: var(--ring, oklch(0.708 0 0));
  --color-chart-1: var(--chart-1, oklch(0.87 0 0)); --color-chart-2: var(--chart-2, oklch(0.556 0 0)); --color-chart-3: var(--chart-3, oklch(0.439 0 0)); --color-chart-4: var(--chart-4, oklch(0.371 0 0)); --color-chart-5: var(--chart-5, oklch(0.269 0 0));
  --color-sidebar: var(--sidebar, oklch(0.985 0 0)); --color-sidebar-foreground: var(--sidebar-foreground, oklch(0.145 0 0));
  --color-sidebar-primary: var(--sidebar-primary, oklch(0.205 0 0)); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground, oklch(0.985 0 0));
  --color-sidebar-accent: var(--sidebar-accent, oklch(0.97 0 0)); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground, oklch(0.205 0 0));
  --color-sidebar-border: var(--sidebar-border, oklch(0.922 0 0)); --color-sidebar-ring: var(--sidebar-ring, oklch(0.708 0 0));
  --radius-sm: calc(var(--radius, 0.625rem) - 4px); --radius-md: calc(var(--radius, 0.625rem) - 2px); --radius-lg: var(--radius, 0.625rem); --radius-xl: calc(var(--radius, 0.625rem) + 4px);
}
@layer base {
  *, ::after, ::before, ::backdrop { border-color: var(--border, oklch(0.922 0 0)); }
  body { background-color: var(--background, oklch(1 0 0)); color: var(--foreground, oklch(0.145 0 0)); font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'); }
}`;
