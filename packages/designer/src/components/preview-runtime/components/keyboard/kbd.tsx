"use client"

import { cn } from "../_parts/utils/index.js"
import { Keyboard as KbdPrimitive } from "react-aria-components"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <KbdPrimitive
      data-slot="kbd"
      className={cn(
        "bg-(--muted) text-(--muted-foreground) in-data-[slot=tooltip-content]:bg-(--background)/20 in-data-[slot=tooltip-content]:text-(--background) dark:in-data-[slot=tooltip-content]:bg-(--background)/10 h-[calc(var(--spacing,0.25rem)*6)] w-fit min-w-[calc(var(--spacing,0.25rem)*6)] gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*1)] font-(family-name:--font-sans) text-(length:--text-xs) font-medium [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*3)] pointer-events-none inline-flex items-center justify-center select-none",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <KbdPrimitive
      data-slot="kbd-group"
      className={cn("gap-[calc(var(--spacing,0.25rem)*1)] inline-flex items-center", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
