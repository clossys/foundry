import { createElement, forwardRef } from "react";
import type { IconNode, IconProps, IconSize } from "./types.js";

/**
 * `size` → `@vespeneventures/tokens` `--spacing-*` step. Every icon in this
 * package renders at one of these three; there is no numeric override (see
 * `IconProps`' comment on `width`/`height`). The literal fallback after the
 * token reference (e.g. `16px`) is what keeps an icon rendering at a
 * sensible size even in a consumer that hasn't imported
 * `@vespeneventures/tokens/tokens.css` — the same defense-in-depth fallback
 * pattern that package's own `styles/tokens.css` uses internally for
 * alias tokens (`--ui-density-pad: var(--spacing-xl, 24px)`), not a
 * substitute for installing the real peer dependency.
 */
const SIZE_TOKENS: Record<IconSize, string> = {
  sm: "var(--spacing-lg, 16px)",
  md: "var(--spacing-xl, 24px)",
  lg: "var(--spacing-2xl, 32px)",
};

/**
 * Build one icon component from a name and its fixed SVG markup. This is
 * the extension seam: `@vespeneventures/icons` itself calls this once per
 * shipped icon (see `src/icons/*.tsx`), and a consumer who needs a glyph
 * this package doesn't ship calls the exact same function with their own
 * `IconNode` to get a component with the identical size/color/accessibility
 * contract — no forking, no reimplementing the wrapper.
 *
 * ```tsx
 * import { createIcon } from "@vespeneventures/icons";
 *
 * export const RocketIcon = createIcon("RocketIcon", [
 *   ["path", { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" }],
 *   ["path", { d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" }],
 * ]);
 *
 * <RocketIcon label="Launch" />
 * ```
 *
 * The result is deliberately NOT registered anywhere inside this package —
 * there is no shared mutable map a call to `createIcon` writes into, the
 * way an `extendIcons({ extensions })`-style name registry would layer a
 * consumer's icons into one shared name → component object; see README.md
 * "Why not a name registry" for the tree-shaking reason this package
 * doesn't use that shape. The returned component is an ordinary named
 * export a consumer puts wherever their own icon components live; nothing
 * here needs to know it exists.
 */
export function createIcon(name: string, node: IconNode) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function IconComponent(
    props,
    ref,
  ) {
    const { size = "md", className, decorative, label, style, ...rest } =
      props;
    const dimension = SIZE_TOKENS[size];

    const a11yProps = decorative
      ? ({ "aria-hidden": "true" } as const)
      : ({ role: "img", "aria-label": label } as const);

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={{
          width: dimension,
          height: dimension,
          flexShrink: 0,
          ...style,
        }}
        {...a11yProps}
        {...rest}
      >
        {node.map(([tag, attrs]) => createElement(tag, attrs))}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon;
}
