"use client"

import type { ComponentPropsWithRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  ToggleButton as TogglePrimitive,
} from "react-aria-components"

const toggleVariants = cva(
  "hover:text-(--color-ink-primary) aria-pressed:bg-(--color-action) aria-pressed:text-(--color-ink-on-action) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:ring-(--color-status-danger)/20 dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) data-[state=on]:bg-(--color-action) data-[state=on]:text-(--color-ink-on-action) gap-(--spacing-xs) rounded-(--radius-control) text-(length:--text-sm) font-(weight:--font-weight-medium) transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) data-selected:bg-(--color-action) data-selected:text-(--color-ink-on-action) group/toggle inline-flex items-center justify-center whitespace-nowrap hover:bg-(--color-surface-sunken) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled,50%) [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-(--color-line-strong) hover:bg-(--color-surface-sunken) border-(length:--ui-border-hairline,1px) bg-transparent",
      },
      size: {
        default: "h-(--ui-control-h-md,calc(var(--spacing)*8)) min-w-(--spacing-2xl) px-(--spacing-md) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm)",
        sm: "h-(--ui-control-h-sm,calc(var(--spacing)*7)) min-w-[var(--spacing-2xl)] rounded-(--radius-control) px-(--spacing-md) text-(length:--text-caption) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--ui-control-switch-thumb,calc(var(--spacing)*3.5))",
        lg: "h-(--ui-control-h-lg,calc(var(--spacing)*9)) min-w-[var(--spacing-2xl)] px-(--spacing-md) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm)",
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
