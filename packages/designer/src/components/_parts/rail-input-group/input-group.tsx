"use client"

import * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../../_parts/rail-utils/index.js"
import { Group, type GroupProps } from "react-aria-components"

import { Button } from "../../_parts/rail-button/index.js"
import { Input } from "../../_parts/rail-input/index.js"
import { Textarea } from "../../_parts/rail-textarea/index.js"

function InputGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="input-group"
      className={cn(
        "group/input-group border-(--input) dark:bg-(--input)/30 has-[[data-slot=input-group-control]:focus-visible]:border-(--ring) has-[[data-slot=input-group-control]:focus-visible]:outline-solid has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-offset-2 has-[[data-slot=input-group-control]:focus-visible]:outline-(--ring) has-[[data-slot][aria-invalid=true]]:outline-solid has-[[data-slot][aria-invalid=true]]:outline-2 has-[[data-slot][aria-invalid=true]]:outline-offset-2 has-[[data-slot][aria-invalid=true]]:outline-(--destructive) has-[[data-slot][aria-invalid=true]]:border-(--destructive) dark:has-[[data-slot][aria-invalid=true]]:ring-(--destructive)/40 has-disabled:bg-(--input)/50 dark:has-disabled:bg-(--input)/80 h-[calc(var(--spacing,0.25rem)*8)] rounded-(--radius) border motion-safe:transition-colors motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:opacity-50 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-[calc(var(--spacing,0.25rem)*3)] has-[>[data-align=block-start]]:[&>input]:pb-[calc(var(--spacing,0.25rem)*3)] has-[>[data-align=inline-end]]:[&>input]:pe-[calc(var(--spacing,0.25rem)*2)] has-[>[data-align=inline-start]]:[&>input]:ps-[calc(var(--spacing,0.25rem)*2)] relative flex w-full min-w-0 items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) has-[>textarea]:h-auto",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants_DEFINITION = {"base":"text-(--muted-foreground) h-auto gap-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius,0.625rem)-5px)] [&>svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] flex cursor-text items-center justify-center select-none","variants":{"align":{"inline-start":"ps-[calc(var(--spacing,0.25rem)*2)] has-[>button]:-ms-[calc(var(--spacing,0.25rem)*1)] has-[>kbd]:-ms-[calc(var(--spacing,0.25rem)*1)] order-first","inline-end":"pe-[calc(var(--spacing,0.25rem)*2)] has-[>button]:-me-[calc(var(--spacing,0.25rem)*1)] has-[>kbd]:-me-[calc(var(--spacing,0.25rem)*1)] order-last","block-start":"px-[calc(var(--spacing,0.25rem)*3)] pt-[calc(var(--spacing,0.25rem)*2)] group-has-[>input]/input-group:pt-[calc(var(--spacing,0.25rem)*2)] [.border-b]:pb-[calc(var(--spacing,0.25rem)*2)] order-first w-full justify-start","block-end":"px-[calc(var(--spacing,0.25rem)*3)] pb-[calc(var(--spacing,0.25rem)*2)] group-has-[>input]/input-group:pb-[calc(var(--spacing,0.25rem)*2)] [.border-t]:pt-[calc(var(--spacing,0.25rem)*2)] order-last w-full justify-start"}},"defaultVariants":{"align":"inline-start"}}
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

const inputGroupButtonVariants_DEFINITION = {"base":"gap-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) flex items-center shadow-none","variants":{"size":{"xs":"h-[calc(var(--spacing,0.25rem)*6)] gap-[calc(var(--spacing,0.25rem)*1)] rounded-[calc(var(--radius,0.625rem)-3px)] px-[calc(var(--spacing,0.25rem)*2)] [&>svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]","sm":"","icon-xs":"size-[calc(var(--spacing,0.25rem)*6)] rounded-[calc(var(--radius,0.625rem)-3px)] p-0 has-[>svg]:p-0","icon-sm":"size-[calc(var(--spacing,0.25rem)*8)] p-0 has-[>svg]:p-0"}},"defaultVariants":{"size":"xs"}}
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
        "text-(--muted-foreground) gap-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] flex items-center [&_svg]:pointer-events-none",
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
      className={cn("rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1", className)}
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
      className={cn("rounded-none border-0 bg-transparent py-[calc(var(--spacing,0.25rem)*2)] shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1 resize-none", className)}
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
