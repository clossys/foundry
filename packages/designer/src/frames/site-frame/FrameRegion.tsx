import { createElement, forwardRef, type HTMLAttributes } from "react";

/** The frame navigation landmark; content and presentation remain caller-owned. */
export const FrameRegion = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function FrameRegion(props, ref) {
  return createElement("nav", { ...props, ref });
});
