import type * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../_parts/rail-utils/index.js"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*4)] rounded-(--radius) border-dashed p-[calc(var(--spacing,0.25rem)*6)] flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center text-balance",
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
        "gap-[calc(var(--spacing,0.25rem)*2)] flex max-w-sm flex-col items-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants_DEFINITION = {"base":"mb-[calc(var(--spacing,0.25rem)*2)] flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0","variants":{"variant":{"default":"bg-transparent","icon":"bg-(--muted) text-(--foreground) flex size-[calc(var(--spacing,0.25rem)*8)] shrink-0 items-center justify-center rounded-(--radius) [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]"}},"defaultVariants":{"variant":"default"}}
function emptyMediaVariants(props: { "variant"?: "default" | "icon" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = emptyMediaVariants_DEFINITION
  const key = (value: unknown) => typeof value === "boolean" ? String(value) : value === 0 ? "0" : value
  const supplied = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined))
  const values: { [axis: string]: unknown } = { ...definition.defaultVariants, ...supplied }
  const selected = Object.entries(definition.variants).map(([axis, choices]) => {
    if ((props as { [axis: string]: unknown })[axis] === null) return null
    const value = key((props as { [axis: string]: unknown })[axis]) || key((definition.defaultVariants as { [axis: string]: unknown })[axis])
    return (choices as { [value: string]: ClassValue })[String(value)]
  })
  const compound = (([]) as { [key: string]: unknown }[]).flatMap(({ class: value, className, ...conditions }) =>
    Object.entries(conditions).every(([axis, expected]) => Array.isArray(expected) ? expected.includes(values[axis]) : values[axis] === expected)
      ? [value as ClassValue, className as ClassValue] : [])
  return classNames(definition.base, selected, compound, props.class, props.className)
}

function EmptyMedia({
  className,
  /** @default "default" */
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
      className={cn("text-(length:--text-sm) font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-(length:--text-sm) leading-relaxed text-(--muted-foreground) [&>a]:underline [&>a]:underline-offset-[calc(var(--spacing,0.25rem)*4)] [&>a:hover]:text-(--primary)",
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
        "gap-[calc(var(--spacing,0.25rem)*3)] text-(length:--text-sm) flex w-full max-w-sm min-w-0 flex-col items-center text-balance",
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
