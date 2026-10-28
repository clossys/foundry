import { forwardRef, type ComponentPropsWithoutRef, type ComponentPropsWithRef, type ReactElement } from "react";
import { SemanticContent } from "../components/SemanticContent.js";

const tags = ["div", "span", "main", "aside", "header", "nav", "section"] as const;
type FrameRegionTag = typeof tags[number];
export type FrameRegionProps<T extends FrameRegionTag = "div"> = { as?: T } & Omit<ComponentPropsWithRef<T>, "as">;
type RegionWithoutRef = { [T in FrameRegionTag]: { as?: T } & ComponentPropsWithoutRef<T> }[FrameRegionTag];

/** Internal frame layout boundary. SemanticContent owns native landmarks; frame attributes, refs and presentation pass through unchanged. */
export const FrameRegion = forwardRef<HTMLElement, RegionWithoutRef>(function FrameRegion({ as = "div", ...props }, ref) {
  if (!tags.includes(as)) throw new TypeError("FrameRegion requires a supported landmark or layout element");
  return <SemanticContent {...props} as={as} ref={ref as never} />;
}) as <T extends FrameRegionTag = "div">(props: FrameRegionProps<T>) => ReactElement | null;
