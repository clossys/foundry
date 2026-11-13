"use client"

import { cn } from "../_parts/utils/index.js"
import { Keyboard as KbdPrimitive } from "react-aria-components"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <KbdPrimitive
      data-slot="kbd"
      className={cn(
        "bg-(--color-surface-sunken) text-(--color-ink-muted) in-data-[slot=tooltip-content]:bg-(--color-surface-base)/20 in-data-[slot=tooltip-content]:text-(--color-surface-base) dark:in-data-[slot=tooltip-content]:bg-(--color-surface-base)/10 h-[var(--spacing-xl)] w-fit min-w-[var(--spacing-xl)] gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-xs) font-(family-name:--font-body) text-(length:--text-code-block) font-(weight:--font-weight-medium) [&_svg:not([class*='size-'])]:size-(--spacing-md) pointer-events-none inline-flex items-center justify-center select-none",
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
      className={cn("gap-(--spacing-xs) inline-flex items-center", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
