"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-utils/index.js"
import {
  Focusable,
  OverlayArrow,
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "react-aria-components"

function TooltipTrigger({
  delay = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipTriggerPrimitive>) {
  const [trigger, tooltip] = React.Children.toArray(children)

  return (
    <TooltipTriggerPrimitive
      data-slot="tooltip-trigger"
      delay={delay}
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
}: Omit<
  React.ComponentProps<typeof TooltipPrimitive>,
  "children" | "className"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <TooltipPrimitive
      data-slot="tooltip-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "data-entering:library-enter data-entering:library-fade data-entering:library-zoom data-exiting:library-exit data-exiting:library-fade data-exiting:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom inline-flex items-center gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-md) py-(--spacing-sm) text-(length:--text-xs) has-data-[slot=kbd]:pr-(--spacing-sm) **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-(--ui-z-modal) **:data-[slot=kbd]:rounded-(--radius-control) z-(--ui-z-modal) w-fit max-w-xs origin-(--trigger-anchor-point) bg-(--color-ink-primary) text-(--color-surface-base)",
        className
      )}
      {...props}
    >
      {children}
      <OverlayArrow
        className="size-(--spacing-md) translate-y-[calc(-50%-var(--ui-border-rule))] rotate-45 rounded-(--radius-subtle) z-(--ui-z-modal) bg-(--color-ink-primary) fill-(--color-ink-primary)"
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
    </TooltipPrimitive>
  )
}

export { Tooltip, TooltipTrigger }
