import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"

const alertVariants = cva("grid gap-[var(--spacing-xs)] rounded-(--radius-control) border-(length:--ui-border-hairline,1px) px-(--spacing-md) py-(--spacing-sm) text-start text-(length:--text-sm) has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-[var(--spacing-4xl)] has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-(--spacing-sm) *:[svg]:row-span-2 *:[svg]:translate-y-[var(--spacing-xs)] *:[svg]:text-current *:[svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) group/alert relative w-full", {
  variants: {
    variant: {
      default: "bg-(--color-surface-raised) text-(--color-ink-primary)",
      destructive: "text-(--color-status-danger) bg-(--color-surface-raised) *:data-[slot=alert-description]:text-(--color-status-danger)/90 *:[svg]:text-current",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-(weight:--font-weight-medium) group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-(--spacing-md) [&_a]:hover:text-(--color-ink-primary)",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-(--color-ink-muted) text-(length:--text-sm) text-balance md:text-pretty [&_p:not(:last-child)]:mb-(--spacing-lg) [&_a]:underline [&_a]:underline-offset-(--spacing-md) [&_a]:hover:text-(--color-ink-primary)",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-(--spacing-sm) end-(--spacing-sm)", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
