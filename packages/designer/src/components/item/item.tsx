"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/rail-utils/index.js"
import { Link as LinkPrimitive, type LinkProps } from "react-aria-components"

import { Separator } from "../_parts/rail-separator/index.js"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn(
        "gap-(--spacing-lg) has-data-[size=sm]:gap-(--spacing-md) has-data-[size=xs]:gap-(--spacing-sm) group/item-group flex w-full flex-col",
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
      className={cn("my-(--spacing-sm)", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "[a]:hover:bg-(--color-surface-sunken) rounded-(--radius-control) border-(length:--ui-border-hairline) text-(length:--text-sm) group/item flex w-full flex-wrap items-center transition-colors duration-(--ui-duration-default) ease-(--ease-default) duration-(--ui-duration-fast) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) [a]:transition-colors [a]:duration-(--ui-duration-default) [a]:ease-(--ease-default)",
  {
    variants: {
      variant: {
        default: "border-transparent",
        outline: "border-(--color-line-base)",
        muted: "bg-(--color-surface-sunken)/50 border-transparent",
      },
      size: {
        default: "gap-(--spacing-md) px-(--spacing-md) py-(--spacing-md)",
        sm: "gap-(--spacing-md) px-(--spacing-md) py-(--spacing-md)",
        xs: "gap-(--spacing-sm) px-(--spacing-md) py-(--spacing-sm) in-data-[slot=dropdown-menu-content]:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "default",
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

const itemMediaVariants = cva(
  "gap-(--spacing-sm) group-has-data-[slot=item-description]/item:translate-y-(--spacing-xs) group-has-data-[slot=item-description]/item:self-start flex shrink-0 items-center justify-center [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "[&_svg:not([class*='size-'])]:size-(--spacing-lg)",
        image: "size-(--spacing-2xl) overflow-hidden rounded-(--radius-control) group-data-[size=sm]/item:size-(--spacing-2xl) group-data-[size=xs]/item:size-(--spacing-xl) [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
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
        "gap-(--spacing-xs) group-data-[size=xs]/item:gap-0 flex flex-1 flex-col [&+[data-slot=item-content]]:flex-none",
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
        "gap-(--spacing-sm) text-(length:--text-sm) leading-(--leading-heading) font-(weight:--font-weight-medium) underline-offset-(--spacing-lg) line-clamp-1 flex w-fit items-center",
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
        "text-(--color-ink-muted) text-left text-(length:--text-sm) leading-(--leading-normal) group-data-[size=xs]/item:text-(length:--text-xs) line-clamp-2 font-(weight:--font-weight-normal) [&>a]:underline [&>a]:underline-offset-(--spacing-lg) [&>a:hover]:text-(--color-action)",
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
      className={cn("gap-(--spacing-sm) flex items-center", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "gap-(--spacing-sm) flex basis-full items-center justify-between",
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
        "gap-(--spacing-sm) flex basis-full items-center justify-between",
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
