import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/rail-utils/index.js"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "gap-(--spacing-lg) rounded-(--radius-control) border-dashed p-(--spacing-xl) flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "gap-(--spacing-sm) flex max-w-(--ui-width-notice-max) flex-col items-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-(--spacing-sm) flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-(--color-surface-sunken) text-(--color-ink-primary) flex size-(--spacing-2xl) shrink-0 items-center justify-center rounded-(--radius-control) [&_svg:not([class*='size-'])]:size-(--spacing-lg)",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-(length:--text-sm) font-(weight:--font-weight-medium) tracking-(--tracking-meta)", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-(length:--text-sm) leading-(--leading-heading) text-(--color-ink-muted) [&>a]:underline [&>a]:underline-offset-(--spacing-lg) [&>a:hover]:text-(--color-action)",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "gap-(--spacing-md) text-(length:--text-sm) flex w-full max-w-(--ui-width-notice-max) min-w-0 flex-col items-center text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
