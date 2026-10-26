"use client";
import { forwardRef } from "react";
import { Toolbar as AriaToolbar, type ToolbarProps as AriaToolbarProps } from "react-aria-components";
import { cx } from "./internal/cx.js";
export interface ToolbarProps extends AriaToolbarProps {}
/** Arrow-key navigation stays with the peer, including nested and disabled controls. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar({ className, ...props }, ref) {
  if (!props["aria-label"]?.trim() && !props["aria-labelledby"]?.trim()) throw new TypeError("Toolbar requires an accessible name.");
  return <AriaToolbar {...props} ref={ref} className={state => cx("flex gap-sm border border-line-base p-sm", state.orientation === "vertical" ? "flex-col items-start" : "flex-row items-center", typeof className === "function" ? className(state) : className)} />;
});
