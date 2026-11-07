import { createElement, forwardRef, type ReactNode, type SVGProps } from "react";

/** Lucide glyph data: the `[tag, attrs]` tuples each Lucide icon is drawn from. */
export type IconNode = ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>;
type IconAccessibility = { decorative: true; label?: undefined } | { decorative?: false; label: string };
type IconContent = { glyph: IconNode; children?: undefined } | { glyph?: undefined; children: ReactNode };
export type IconProps = IconAccessibility & IconContent & {
  size?: "sm" | "md" | "lg";
  mirrorInRtl?: boolean;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "children" | "aria-hidden" | "aria-label" | "role" | "className" | "width" | "height">;

const SIZES = { sm: "size-4", md: "size-6", lg: "size-8" } as const;

/** A Lucide icon as stock shadcn renders it: 24px grid, 2px current-colour stroke, size-4 by default. */
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ size = "sm", mirrorInRtl = false, className, decorative, label, glyph, children, ...props }, ref) {
  const classes = ["lucide", "shrink-0", /\bsize-/.test(className ?? "") ? undefined : SIZES[size], mirrorInRtl ? "rtl:-scale-x-100" : undefined, className].filter(Boolean).join(" ");
  const access = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return createElement("svg", {
    ref, xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", ...props, ...access, className: classes,
  }, glyph ? glyph.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs })) : children);
});
