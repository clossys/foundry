import type { ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

/** A static device bezel; the child retains its own intrinsic dimensions. */
export function ChromeDevice({ children, ground = "base" }: { children: ReactNode; ground?: SectionGround }) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return (
    <SemanticContent as="div" data-screenshot-chrome="device"
      className={cx("flex min-w-0 w-full flex-col gap-sm overflow-hidden rounded-control border p-sm", colors.border,
        ground === "inverse" ? "bg-surface-inverse-raised" : "bg-surface-sunken")}>
      <SemanticContent as="span" data-device-detail="" aria-hidden="true" className={cx("block h-xs w-lg shrink-0 self-center rounded-full", colors.line)} />
      {children}
    </SemanticContent>
  );
}
