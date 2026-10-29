import type * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../../_parts/rail-utils/index.js"

const badgeVariants_DEFINITION = {"base":"h-(--spacing-xl) gap-(--spacing-xs) rounded-4xl border-(length:--ui-border-hairline) border-transparent px-(--spacing-sm) py-(--spacing-xs) text-(length:--text-xs) font-(weight:--font-weight-medium) motion-safe:transition-all motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) has-data-[icon=inline-end]:pe-(--spacing-sm) has-data-[icon=inline-start]:ps-(--spacing-sm) [&>svg]:size-(--spacing-md)! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:border-(--color-status-danger) aria-invalid:ring-(--color-status-danger)/20 dark:aria-invalid:ring-(--color-status-danger)/40 [&>svg]:pointer-events-none","variants":{"variant":{"default":"bg-(--color-action) text-(--color-ink-on-action) [a]:hover:bg-(--color-action)/80","secondary":"bg-(--color-control-tonal) text-(--color-ink-primary) [a]:hover:bg-(--color-control-tonal)/80","destructive":"bg-(--color-status-danger)/10 [a]:hover:bg-(--color-status-danger)/20 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) dark:focus-visible:outline-solid dark:focus-visible:outline-(length:--ui-border-focus) dark:focus-visible:outline-offset-(--ui-focus-offset) dark:focus-visible:outline-(--color-focus-ring) text-(--color-status-danger) dark:bg-(--color-status-danger)/20","outline":"border-(--color-line-base) text-(--color-ink-primary) [a]:hover:bg-(--color-surface-sunken) [a]:hover:text-(--color-ink-muted)","ghost":"hover:bg-(--color-surface-sunken) hover:text-(--color-ink-muted) dark:hover:bg-(--color-surface-sunken)/50","link":"text-(--color-accent-text) underline-offset-(--spacing-lg) hover:underline"}},"defaultVariants":{"variant":"default"}}
function badgeVariants(props: { "variant"?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = badgeVariants_DEFINITION
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

function Badge({
  className,
  /** @default "default" */
  variant = "default",
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
