"use client"

import type * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../../_parts/rail-utils/index.js"
import {
  Button as ButtonPrimitive,
  Link as LinkPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
  type LinkProps as LinkPrimitiveProps,
} from "react-aria-components"

const buttonVariants_DEFINITION = {"base":"focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 rounded-(--radius-control) border-(length:--ui-border-hairline) border-transparent bg-clip-padding text-(length:--text-sm) font-(weight:--font-weight-medium) active:not-aria-[haspopup]:translate-y-(--ui-border-hairline) [&_svg:not([class*='size-'])]:size-(--spacing-lg) group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap motion-safe:transition-all motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) select-none disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled) [&_svg]:pointer-events-none [&_svg]:shrink-0","variants":{"variant":{"default":"bg-(--color-action) text-(--color-ink-on-action) hover:bg-(--color-action)/80","outline":"border-(--color-line-base) bg-(--color-surface-base) hover:bg-(--color-surface-sunken) hover:text-(--color-ink-primary) dark:bg-(--color-line-strong)/30 dark:border-(--color-line-strong) dark:hover:bg-(--color-line-strong)/50 aria-expanded:bg-(--color-surface-sunken) aria-expanded:text-(--color-ink-primary)","secondary":"bg-(--color-control-tonal) text-(--color-ink-primary) hover:bg-[color-mix(in_oklch,var(--color-control-tonal),var(--color-ink-primary)_5%)] aria-expanded:bg-(--color-control-tonal) aria-expanded:text-(--color-ink-primary)","ghost":"hover:bg-(--color-surface-sunken) hover:text-(--color-ink-primary) dark:hover:bg-(--color-surface-sunken)/50 aria-expanded:bg-(--color-surface-sunken) aria-expanded:text-(--color-ink-primary)","destructive":"bg-(--color-status-danger)/10 hover:bg-(--color-status-danger)/20 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) dark:focus-visible:outline-solid dark:focus-visible:outline-(length:--ui-border-focus) dark:focus-visible:outline-offset-(--ui-focus-offset) dark:focus-visible:outline-(--color-focus-ring) dark:bg-(--color-status-danger)/20 text-(--color-status-danger) focus-visible:border-(--color-status-danger)/40 dark:hover:bg-(--color-status-danger)/30","link":"text-(--color-accent-text) underline-offset-(--spacing-lg) hover:underline"},"size":{"default":"h-(--ui-control-h-md) gap-(--spacing-sm) px-(--spacing-md) has-data-[icon=inline-end]:pe-(--spacing-sm) has-data-[icon=inline-start]:ps-(--spacing-sm)","xs":"h-(--spacing-xl) gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-sm) text-(length:--text-xs) in-data-[slot=button-group]:rounded-(--radius-control) has-data-[icon=inline-end]:pe-(--spacing-sm) has-data-[icon=inline-start]:ps-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--spacing-md)","sm":"h-(--ui-control-h-sm) gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-md) text-(length:--text-caption) in-data-[slot=button-group]:rounded-(--radius-control) has-data-[icon=inline-end]:pe-(--spacing-sm) has-data-[icon=inline-start]:ps-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--spacing-lg)","lg":"h-(--ui-control-h-lg) gap-(--spacing-sm) px-(--spacing-md) has-data-[icon=inline-end]:pe-(--spacing-sm) has-data-[icon=inline-start]:ps-(--spacing-sm)","icon":"size-(--ui-control-h-md)","icon-xs":"size-(--spacing-xl) rounded-(--radius-control) in-data-[slot=button-group]:rounded-(--radius-control) [&_svg:not([class*='size-'])]:size-(--spacing-md)","icon-sm":"size-(--ui-control-h-sm) rounded-(--radius-control) in-data-[slot=button-group]:rounded-(--radius-control)","icon-lg":"size-(--ui-control-h-lg)"}},"defaultVariants":{"variant":"default","size":"default"}}
function buttonVariants(props: { "variant"?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link" | null; "size"?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = buttonVariants_DEFINITION
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

function Button({
  className,
  /** @default "default" */
  variant = "default",
  /** @default "default" */
  size = "default",
  ...props
}: Omit<ButtonPrimitiveProps, "className"> &
  React.RefAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    className?: string
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

function LinkButton({
  className,
  /** @default "default" */
  variant = "default",
  /** @default "default" */
  size = "default",
  ...props
}: Omit<LinkPrimitiveProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string
  }) {
  return (
    <LinkPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, LinkButton, buttonVariants }
