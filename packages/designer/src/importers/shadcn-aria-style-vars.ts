/**
 * shadcn@aria style axis (nova). Each fixed style class reads an existing
 * designer variable; the variable's fallback is the style's own value, so a
 * consumer without the designer theme renders the style unchanged and a theme
 * that sets the variable restyles every use at once.
 *
 * This table is the only place these defaults are written. Rows without a
 * fallback read a variable whose own definition already carries the style's
 * value (a Tailwind theme key) or a theme colour role.
 */
export interface ShadcnAriaStyleVar {
  /** Fixed nova class (the variant prefix is preserved by the rewrite). */
  readonly fixed: string;
  /** Existing designer variable that the rewritten class reads. */
  readonly variable: string;
  /** The style's own value; absent when the variable already carries it. */
  readonly fallback?: string;
}

const step = (n: string): string => `calc(var(--spacing)*${n})`;

export const SHADCN_ARIA_STYLE_VARS: readonly ShadcnAriaStyleVar[] = Object.freeze([
  { fixed: "z-50", variable: "--ui-z-modal", fallback: "50" },
  { fixed: "duration-100", variable: "--ui-duration-fast", fallback: "100ms" },
  { fixed: "duration-200", variable: "--ui-duration-default", fallback: "200ms" },
  // Implicit transition timing reads Tailwind's own key, whose default is the style's.
  { fixed: "transition", variable: "--default-transition-timing-function" },
  { fixed: "opacity-50", variable: "--ui-alpha-disabled", fallback: "50%" },
  { fixed: "ring-3", variable: "--ui-border-focus", fallback: "3px" },
  { fixed: "ring-ring/50", variable: "--color-focus-ring" },
  { fixed: "border", variable: "--ui-border-hairline", fallback: "1px" },
  { fixed: "h-7", variable: "--ui-control-h-sm", fallback: step("7") },
  { fixed: "h-8", variable: "--ui-control-h-md", fallback: step("8") },
  { fixed: "h-9", variable: "--ui-control-h-lg", fallback: step("9") },
  // Icon sizes keep their contract-readable size bindings; only the default is added.
  { fixed: "size-3.5", variable: "--ui-control-switch-thumb", fallback: step("3.5") },
  { fixed: "size-4", variable: "--spacing-lg", fallback: step("4") },
]);

const byFixed = new Map(SHADCN_ARIA_STYLE_VARS.map(row => [row.fixed, row]));

/** The style's own value for a fixed class, if the table gives one. */
export function shadcnAriaStyleDefault(fixed: string): string | undefined {
  return byFixed.get(fixed)?.fallback;
}

/**
 * Tailwind v4 variable shorthand for `property`, carrying the fixed class's
 * style default: `(--x)` becomes `(--x,<default>)`; `length:` hints are kept.
 */
export function shadcnAriaStyleRead(property: string, fixed: string, hint?: "length"): string {
  const fallback = shadcnAriaStyleDefault(fixed);
  return `(${hint ? `${hint}:` : ""}${property}${fallback === undefined ? "" : `,${fallback}`})`;
}

/**
 * The ten fixed nova patterns that must not survive into any shadcn@aria
 * fill. Each matches a whole class atom after its variant prefix.
 */
export const SHADCN_ARIA_FIXED_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  "z-50": /^z-50$/,
  "duration-100": /^duration-100$/,
  "duration-200": /^duration-200$/,
  "transition timing": /^ease-(?:linear|in|out|in-out)$/,
  "opacity-50": /^opacity-50$/,
  "ring-3": /^ring-(?:3|\[3px\])$/,
  "ring-ring/50": /^ring-ring\/50$/,
  "border": /^border$/,
  "h-7/8/9": /^h-[789]$/,
  "size-3.5/4": /^size-(?:3\.5|4)$/,
});
