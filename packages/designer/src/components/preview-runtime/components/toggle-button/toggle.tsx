"use client"

import type { ComponentPropsWithRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  ToggleButton as TogglePrimitive,
} from "react-aria-components"

const toggleVariants = cva(
  "hover:text-(--foreground) aria-pressed:bg-(--primary) aria-pressed:text-(--primary-foreground) focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:ring-(--destructive)/20 dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) data-[state=on]:bg-(--primary) data-[state=on]:text-(--primary-foreground) gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) text-(length:--text-sm) font-medium transition-all [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] data-selected:bg-(--primary) data-selected:text-(--primary-foreground) group/toggle inline-flex items-center justify-center whitespace-nowrap hover:bg-(--muted) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-(--input) hover:bg-(--muted) border bg-transparent",
      },
      size: {
        default: "h-[calc(var(--spacing,0.25rem)*8)] min-w-[calc(var(--spacing,0.25rem)*8)] px-[calc(var(--spacing,0.25rem)*3)] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)]",
        sm: "h-[calc(var(--spacing,0.25rem)*7)] min-w-[calc(var(--spacing,0.25rem)*8)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*3)] text-[0.8rem] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*3.5)]",
        lg: "h-[calc(var(--spacing,0.25rem)*9)] min-w-[calc(var(--spacing,0.25rem)*8)] px-[calc(var(--spacing,0.25rem)*3)] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentPropsWithRef<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={composeRenderProps(className, (className) => cn(toggleVariants({ variant, size, className })))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
