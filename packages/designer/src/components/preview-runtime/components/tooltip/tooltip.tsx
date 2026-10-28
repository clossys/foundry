"use client"

import * as React from "react"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  Focusable,
  OverlayArrow,
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "react-aria-components"

export type TooltipBehaviorTiming = Readonly<{
  "tokens.behavior-timing.tooltip-delay": Readonly<{ value: number; unit: "ms" | "s" }>;
  "tokens.behavior-timing.tooltip-close": Readonly<{ value: number; unit: "ms" | "s" }>;
}>;

/** The caller supplies these values from its resolved consumer library. */
export function readTooltipTiming(behaviorTiming: TooltipBehaviorTiming): { delay: number; closeDelay: number } {
  const milliseconds = (value: Readonly<{ value: number; unit: "ms" | "s" }> | undefined): number => {
    if (!value || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0 || (value.unit !== "ms" && value.unit !== "s")) throw new Error("Missing or invalid tooltip timing binding");
    const result = value.unit === "s" ? value.value * 1000 : value.value;
    if (!Number.isFinite(result)) throw new Error("Invalid tooltip timing binding");
    return result;
  };
  return {
    delay: milliseconds(behaviorTiming?.["tokens.behavior-timing.tooltip-delay"]),
    closeDelay: milliseconds(behaviorTiming?.["tokens.behavior-timing.tooltip-close"]),
  };
}

function TooltipTrigger({
  behaviorTiming,
  delay,
  closeDelay,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof TooltipTriggerPrimitive> & { behaviorTiming: TooltipBehaviorTiming }) {
  const timing = readTooltipTiming(behaviorTiming);
  const [trigger, tooltip] = React.Children.toArray(children)

  return (
    <TooltipTriggerPrimitive
      data-slot="tooltip-trigger"
      delay={delay ?? timing.delay}
      closeDelay={closeDelay ?? timing.closeDelay}
      {...props}
    >
      <Focusable>
        {trigger as React.ComponentProps<typeof Focusable>["children"]}
      </Focusable>
      {tooltip}
    </TooltipTriggerPrimitive>
  )
}

function Tooltip({
  className,
  placement = "top",
  offset = 4,
  crossOffset = 0,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof TooltipPrimitive>) {
  return (
    <TooltipPrimitive
      data-slot="tooltip-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={composeRenderProps(className, (className) => cn(
        "data-entering:library-enter data-entering:library-fade data-entering:library-zoom data-exiting:library-exit data-exiting:library-fade data-exiting:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom inline-flex items-center gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-md) py-(--spacing-sm) text-(length:--text-xs) has-data-[slot=kbd]:pe-(--spacing-sm) **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-(--ui-z-modal,50) **:data-[slot=kbd]:rounded-(--radius-control) z-(--ui-z-modal,50) w-fit max-w-[20rem] origin-(--trigger-anchor-point) bg-(--color-ink-primary) text-(--color-surface-base)",
        className
      ))}
      {...props}
    >
      {composeRenderProps(children, (children) => <>
      {children}
      <OverlayArrow
        className="size-(--spacing-md) translate-y-[calc(-50%-var(--ui-border-rule))] rotate-45 rounded-(--radius-subtle) z-(--ui-z-modal,50) bg-(--color-ink-primary) fill-(--color-ink-primary)"
        style={({ placement, defaultStyle }) => ({
          ...defaultStyle,
          rotate: "0deg",
          translate: "0 0",
          transform:
            placement === "bottom"
              ? "translate(-50%, calc(50% + 2px)) rotate(45deg)"
              : placement === "top"
                ? "translate(-50%, calc(-50% - 2px)) rotate(45deg)"
                : placement === "left"
                  ? "translate(calc(-50% - 2px), -50%) rotate(45deg)"
                  : "translate(calc(50% + 2px), -50%) rotate(45deg)",
        })}
      />
      </>)}
    </TooltipPrimitive>
  )
}

export { Tooltip, TooltipTrigger }
