import type { CSSProperties } from "react";

type CornerMeasurement = { top: number; left: number; right: number; rtl: boolean };
type CloseButtonPosition = Pick<CSSProperties, "position" | "insetBlockStart" | "insetInlineStart" | "insetInlineEnd" | "direction">;

/** Position the existing modal close control in its measured opener's fixed containing block. */
export function getAppNavigationCloseStyle(rect: CornerMeasurement | undefined): CloseButtonPosition | undefined {
  if (!rect) return undefined;
  return {
    position: "fixed",
    direction: rect.rtl ? "rtl" : "ltr",
    insetBlockStart: rect.top,
    insetInlineStart: rect.rtl ? `calc(100% - ${rect.right}px)` : rect.left,
    insetInlineEnd: "auto",
  };
}
