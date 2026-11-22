import { classFallback, type DeclaredFallbackReader } from "./declared-fallback-reader.js";

/**
 * shadcn@aria style axis (nova). Each fixed style class reads an existing
 * designer variable, so a theme that sets the variable restyles every use at once.
 *
 * No value is typed here. A row marked `defaulted` gives its read a fallback,
 * and that fallback is the value the declared-fallback reader returns for the
 * variable read (`declared-fallback-reader.ts`): the package's declared value
 * for the preview graph and package output. Rows without it read a variable
 * whose own definition already carries its value (a Tailwind theme key) or a
 * theme colour role.
 */
export interface ShadcnAriaStyleVar {
  /** Fixed nova class (the variant prefix is preserved by the rewrite). */
  readonly fixed: string;
  /** Existing designer variable that the rewritten class reads. */
  readonly variable: string;
  /** The read carries the reader's declared value for its variable as fallback. */
  readonly defaulted?: true;
}

export const SHADCN_ARIA_STYLE_VARS: readonly ShadcnAriaStyleVar[] = Object.freeze([
  { fixed: "z-50", variable: "--ui-z-modal", defaulted: true },
  { fixed: "duration-100", variable: "--ui-duration-fast", defaulted: true },
  { fixed: "duration-200", variable: "--ui-duration-default", defaulted: true },
  // Implicit transition timing reads Tailwind's own key, which carries its value.
  { fixed: "transition", variable: "--default-transition-timing-function" },
  { fixed: "opacity-50", variable: "--ui-alpha-disabled", defaulted: true },
  { fixed: "ring-3", variable: "--ui-border-focus", defaulted: true },
  { fixed: "ring-ring/50", variable: "--color-focus-ring" },
  { fixed: "border", variable: "--ui-border-hairline", defaulted: true },
  { fixed: "h-7", variable: "--ui-control-h-sm", defaulted: true },
  { fixed: "h-8", variable: "--ui-control-h-md", defaulted: true },
  { fixed: "h-9", variable: "--ui-control-h-lg", defaulted: true },
  // Icon sizes keep their contract-readable size bindings; only the default is added.
  { fixed: "size-3.5", variable: "--ui-control-switch-thumb", defaulted: true },
  { fixed: "size-4", variable: "--spacing-lg", defaulted: true },
]);

const byFixed = new Map(SHADCN_ARIA_STYLE_VARS.map(row => [row.fixed, row]));

/**
 * Tailwind v4 variable shorthand for `property`, standing in for the fixed
 * class: `(--x)`, or `(--x,<declared value>)` when the fixed class's row is
 * defaulted, the value read from `reader`; `length:` hints are kept.
 */
export function shadcnAriaStyleRead(property: string, fixed: string, reader: DeclaredFallbackReader, hint?: "length"): string {
  const fallback = byFixed.get(fixed)?.defaulted ? `,${classFallback(reader, property)}` : "";
  return `(${hint ? `${hint}:` : ""}${property}${fallback})`;
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
