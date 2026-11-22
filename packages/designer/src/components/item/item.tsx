"use client"

import * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../_parts/rail-utils/index.js"
import { Link as LinkPrimitive, type LinkProps } from "react-aria-components"

import { Separator } from "../_parts/rail-separator/index.js"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*4)] has-data-[size=sm]:gap-[calc(var(--spacing,0.25rem)*3)] has-data-[size=xs]:gap-[calc(var(--spacing,0.25rem)*2)] group/item-group flex w-full flex-col",
        className
      )}
      {...props}
    />
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("my-[calc(var(--spacing,0.25rem)*2)]", className)}
      {...props}
    />
  )
}

const itemVariants_DEFINITION = {"base":"[a]:hover:bg-(--muted) rounded-(--radius) border text-(length:--text-sm) group/item flex w-full flex-wrap items-center motion-safe:transition-colors motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) focus-visible:border-(--ring) [a]:motion-safe:transition-colors","variants":{"variant":{"default":"border-transparent","outline":"border-(--border)","muted":"bg-(--muted)/50 border-transparent"},"size":{"default":"gap-[calc(var(--spacing,0.25rem)*3)] px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*3)]","sm":"gap-[calc(var(--spacing,0.25rem)*3)] px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*3)]","xs":"gap-[calc(var(--spacing,0.25rem)*2)] px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*2)] in-data-[slot=dropdown-menu-content]:p-0"}},"defaultVariants":{"variant":"default","size":"default"}}
function itemVariants(props: { "variant"?: "default" | "outline" | "muted" | null; "size"?: "default" | "sm" | "xs" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = itemVariants_DEFINITION
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

function Item({
  className,
  /** @default "default" */
  variant = "default",
  /** @default "default" */
  size = "default",
  ...props
}: Omit<LinkProps, "children"> &
  React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof itemVariants>) {
  const Element = "href" in props ? LinkPrimitive : "div"
  return (
    <Element
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(itemVariants({ variant, size, className }))}
      {...props}
    />
  )
}

const itemMediaVariants_DEFINITION = {"base":"gap-[calc(var(--spacing,0.25rem)*2)] group-has-data-[slot=item-description]/item:translate-y-[calc(var(--spacing,0.25rem)*1)] group-has-data-[slot=item-description]/item:self-start flex shrink-0 items-center justify-center [&_svg]:pointer-events-none","variants":{"variant":{"default":"bg-transparent","icon":"[&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]","image":"size-[calc(var(--spacing,0.25rem)*8)] overflow-hidden rounded-(--radius) group-data-[size=sm]/item:size-[calc(var(--spacing,0.25rem)*8)] group-data-[size=xs]/item:size-[calc(var(--spacing,0.25rem)*6)] [&_img]:size-full [&_img]:object-cover"}},"defaultVariants":{"variant":"default"}}
function itemMediaVariants(props: { "variant"?: "default" | "icon" | "image" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = itemMediaVariants_DEFINITION
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

function ItemMedia({
  className,
  /** @default "default" */
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*1)] group-data-[size=xs]/item:gap-0 flex flex-1 flex-col [&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) leading-snug font-medium underline-offset-[calc(var(--spacing,0.25rem)*4)] line-clamp-1 flex w-fit items-center",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "text-(--muted-foreground) text-start text-(length:--text-sm) leading-normal group-data-[size=xs]/item:text-(length:--text-xs) line-clamp-2 font-normal [&>a]:underline [&>a]:underline-offset-[calc(var(--spacing,0.25rem)*4)] [&>a:hover]:text-(--primary)",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("gap-[calc(var(--spacing,0.25rem)*2)] flex items-center", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*2)] flex basis-full items-center justify-between",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*2)] flex basis-full items-center justify-between",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}
