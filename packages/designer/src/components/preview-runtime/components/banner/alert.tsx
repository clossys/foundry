import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"

const alertVariants = cva("grid gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) border px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*2)] text-start text-(length:--text-sm) has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-[calc(var(--spacing,0.25rem)*16)] has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-[calc(var(--spacing,0.25rem)*2)] *:[svg]:row-span-2 *:[svg]:translate-y-[calc(var(--spacing,0.25rem)*1)] *:[svg]:text-current *:[svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] group/alert relative w-full", {
  variants: {
    variant: {
      default: "bg-(--card) text-(--foreground)",
      destructive: "text-(--destructive) bg-(--card) *:data-[slot=alert-description]:text-(--destructive)/90 *:[svg]:text-current",
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
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-[calc(var(--spacing,0.25rem)*3)] [&_a]:hover:text-(--foreground)",
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
        "text-(--muted-foreground) text-(length:--text-sm) text-balance md:text-pretty [&_p:not(:last-child)]:mb-[calc(var(--spacing,0.25rem)*4)] [&_a]:underline [&_a]:underline-offset-[calc(var(--spacing,0.25rem)*3)] [&_a]:hover:text-(--foreground)",
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
      className={cn("absolute top-[calc(var(--spacing,0.25rem)*2)] end-[calc(var(--spacing,0.25rem)*2)]", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
