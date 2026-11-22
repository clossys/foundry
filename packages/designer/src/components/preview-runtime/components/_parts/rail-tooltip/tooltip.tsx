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
  /** @default 0 */
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
  /** @default "top" */
  placement = "top",
  /** @default 4 */
  offset = 4,
  /** @default 0 */
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
        "data-entering:library-enter data-entering:library-fade data-entering:library-zoom data-exiting:library-exit data-exiting:library-fade data-exiting:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom inline-flex items-center gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-xs) has-data-[slot=kbd]:pe-[calc(var(--spacing,0.25rem)*2)] **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-(--radius) z-50 w-fit max-w-[20rem] origin-(--trigger-anchor-point) bg-(--foreground) text-(--background)",
        className
      )}
      {...props}
    >
      {children}
      <OverlayArrow
        className="size-[calc(var(--spacing,0.25rem)*3)] translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] z-50 bg-(--foreground) fill-(--foreground)"
        style={({ placement, defaultStyle }) => ({
          ...defaultStyle,
          rotate: "0deg",
          translate: "0",
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
