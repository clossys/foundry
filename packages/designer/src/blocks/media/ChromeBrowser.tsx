import type { HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

export interface ChromeBrowserProps extends HTMLAttributes<HTMLDivElement> {
  /** The screenshot node; its image alternative remains the caller's responsibility. */
  children: ReactNode;
  /** Optional browser title or address, already resolved by the caller. */
  label?: ReactNode;
  /** Semantic surface and ink pairing for the surrounding section. */
  ground?: SectionGround;
}

/** Static browser chrome for a product screenshot in any section's media slot. */
export function ChromeBrowser({ children, label, ground = "base", className, ...rest }: ChromeBrowserProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return (
    <SemanticContent
      {...rest}
      as="div"
      data-screenshot-chrome=""
      className={cx("min-w-0 w-full overflow-hidden rounded-control border", colors.border, className)}
    >
      <SemanticContent
        as="div"
        data-screenshot-chrome-bar=""
        className={cx("flex min-w-0 items-center gap-sm border-b px-md py-sm", colors.border,
          ground === "inverse" ? "bg-surface-inverse-raised" : "bg-surface-sunken", colors.muted)}
      >
        <SemanticContent as="div" aria-hidden="true" className="flex shrink-0 items-center gap-xs">
          {[0, 1, 2].map(dot => (
            <SemanticContent as="span" key={dot} className={cx("block h-xs w-xs rounded-full", colors.line)} />
          ))}
        </SemanticContent>
        {label !== undefined && label !== null && label !== false ? (
          <SemanticContent as="div" className="min-w-0 flex-1 truncate text-caption">{label}</SemanticContent>
        ) : null}
      </SemanticContent>
      <SemanticContent as="div" data-screenshot-chrome-content="" className="min-w-0 w-full overflow-hidden">
        {children}
      </SemanticContent>
    </SemanticContent>
  );
}
