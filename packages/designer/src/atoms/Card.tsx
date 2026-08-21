import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_RAISED } from "./internal/ui-vars.js";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * A raised content surface. Not interactive and does not compose another
 * atom — plain markup, no react-aria-components primitive needed, unlike
 * `Button` and `TextField` (see this package's README).
 */
export function Card({ className, style, children, ...rest }: CardProps) {
  const mergedStyle: CSSProperties = { boxShadow: UI_ELEVATION_RAISED, ...style };
  return (
    <div {...rest} className={cx("rounded-control bg-surface-raised p-lg", className)} style={mergedStyle}>
      {children}
    </div>
  );
}
