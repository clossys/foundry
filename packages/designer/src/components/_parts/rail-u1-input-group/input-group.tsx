"use client"

import * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../../_parts/rail-utils/index.js"
import { Group, type GroupProps } from "react-aria-components"

import { Button } from "../../_parts/rail-u1-button/index.js"
import { Input } from "../../_parts/rail-u1-input/index.js"
import { Textarea } from "../../_parts/rail-u1-textarea/index.js"

function InputGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="input-group"
      className={cn(
        "group/input-group border-(--color-line-strong) dark:bg-(--color-line-strong)/30 has-[[data-slot=input-group-control]:focus-visible]:border-(--color-focus-ring) has-[[data-slot=input-group-control]:focus-visible]:outline-solid has-[[data-slot=input-group-control]:focus-visible]:outline-(length:--ui-border-focus) has-[[data-slot=input-group-control]:focus-visible]:outline-offset-(--ui-focus-offset) has-[[data-slot=input-group-control]:focus-visible]:outline-(--color-focus-ring) has-[[data-slot][aria-invalid=true]]:outline-solid has-[[data-slot][aria-invalid=true]]:outline-(length:--ui-border-focus) has-[[data-slot][aria-invalid=true]]:outline-offset-(--ui-focus-offset) has-[[data-slot][aria-invalid=true]]:outline-(--color-status-danger) has-[[data-slot][aria-invalid=true]]:border-(--color-status-danger) dark:has-[[data-slot][aria-invalid=true]]:ring-(--color-status-danger)/40 has-disabled:bg-(--color-line-strong)/50 dark:has-disabled:bg-(--color-line-strong)/80 h-(--spacing-2xl) rounded-(--radius-control) border-(length:--ui-border-hairline) motion-safe:transition-colors motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:opacity-(--ui-alpha-disabled) has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-(--spacing-md) has-[>[data-align=block-start]]:[&>input]:pb-(--spacing-md) has-[>[data-align=inline-end]]:[&>input]:pe-(--spacing-sm) has-[>[data-align=inline-start]]:[&>input]:ps-(--spacing-sm) relative flex w-full min-w-0 items-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) has-[>textarea]:h-auto",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants_DEFINITION = {"base":"text-(--color-ink-muted) h-auto gap-(--spacing-sm) py-(--spacing-sm) text-(length:--text-sm) font-(weight:--font-weight-medium) group-data-[disabled=true]/input-group:opacity-(--ui-alpha-disabled) [&>kbd]:rounded-(--radius-default) [&>svg:not([class*='size-'])]:size-(--spacing-lg) flex cursor-text items-center justify-center select-none","variants":{"align":{"inline-start":"ps-(--spacing-sm) has-[>button]:-ms-(--spacing-xs) has-[>kbd]:-ms-(--spacing-xs) order-first","inline-end":"pe-(--spacing-sm) has-[>button]:-me-(--spacing-xs) has-[>kbd]:-me-(--spacing-xs) order-last","block-start":"px-(--spacing-md) pt-(--spacing-sm) group-has-[>input]/input-group:pt-(--spacing-sm) [.border-b]:pb-(--spacing-sm) order-first w-full justify-start","block-end":"px-(--spacing-md) pb-(--spacing-sm) group-has-[>input]/input-group:pb-(--spacing-sm) [.border-t]:pt-(--spacing-sm) order-last w-full justify-start"}},"defaultVariants":{"align":"inline-start"}}
function inputGroupAddonVariants(props: { "align"?: "inline-start" | "inline-end" | "block-start" | "block-end" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = inputGroupAddonVariants_DEFINITION
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

function InputGroupAddon({
  className,
  /** @default "inline-start" */
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants_DEFINITION = {"base":"gap-(--spacing-sm) text-(length:--text-sm) flex items-center shadow-(--ui-elevation-none)","variants":{"size":{"xs":"h-(--spacing-xl) gap-(--spacing-xs) rounded-(--radius-default) px-(--spacing-sm) [&>svg:not([class*='size-'])]:size-(--spacing-lg)","sm":"","icon-xs":"size-(--spacing-xl) rounded-(--radius-default) p-0 has-[>svg]:p-0","icon-sm":"size-(--spacing-2xl) p-0 has-[>svg]:p-0"}},"defaultVariants":{"size":"xs"}}
function inputGroupButtonVariants(props: { "size"?: "xs" | "sm" | "icon-xs" | "icon-sm" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = inputGroupButtonVariants_DEFINITION
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

function InputGroupButton({
  className,
  /** @default "button" */
  type = "button",
  /** @default "ghost" */
  variant = "ghost",
  /** @default "xs" */
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-(--color-ink-muted) gap-(--spacing-sm) text-(length:--text-sm) [&_svg:not([class*='size-'])]:size-(--spacing-lg) flex items-center [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn("rounded-none border-0 bg-transparent shadow-(--ui-elevation-none) ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1", className)}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn("rounded-none border-0 bg-transparent py-(--spacing-sm) shadow-(--ui-elevation-none) ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1 resize-none", className)}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
