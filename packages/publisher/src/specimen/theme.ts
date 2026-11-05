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
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3); --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar); --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px); --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
}
@layer base {
  *, ::after, ::before, ::backdrop { border-color: var(--border, currentColor); }
  body { background-color: var(--background); color: var(--foreground); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
}`;
