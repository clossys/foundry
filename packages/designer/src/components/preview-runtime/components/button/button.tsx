"use client"

import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"
import {
  Button as ButtonPrimitive,
  Link as LinkPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
  type LinkProps as LinkPrimitiveProps,
} from "react-aria-components"

const buttonVariants = cva(
  "focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 rounded-(--radius) border border-transparent bg-clip-padding text-(length:--text-sm) font-medium focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-(--primary) text-(--primary-foreground) hover:bg-(--primary)/80",
        outline: "border-(--border) bg-(--background) hover:bg-(--muted) hover:text-(--foreground) dark:bg-(--input)/30 dark:border-(--input) dark:hover:bg-(--input)/50 aria-expanded:bg-(--muted) aria-expanded:text-(--foreground)",
        secondary: "bg-(--secondary) text-(--foreground) hover:bg-[color-mix(in_oklch,var(--secondary,oklch(0.97_0_0)),var(--foreground,oklch(0.145_0_0))_5%)] aria-expanded:bg-(--secondary) aria-expanded:text-(--foreground)",
        ghost: "hover:bg-(--muted) hover:text-(--foreground) dark:hover:bg-(--muted)/50 aria-expanded:bg-(--muted) aria-expanded:text-(--foreground)",
        destructive: "bg-(--destructive)/10 hover:bg-(--destructive)/20 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) dark:focus-visible:outline-solid dark:focus-visible:outline-2 dark:focus-visible:outline-offset-2 dark:focus-visible:outline-(--ring) dark:bg-(--destructive)/20 text-(--destructive) focus-visible:border-(--destructive)/40 dark:hover:bg-(--destructive)/30",
        link: "text-(--accent-foreground) underline-offset-[calc(var(--spacing,0.25rem)*4)] hover:underline",
      },
      size: {
        default: "h-[calc(var(--spacing,0.25rem)*8)] gap-[calc(var(--spacing,0.25rem)*2)] px-[calc(var(--spacing,0.25rem)*3)] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)]",
        xs: "h-[calc(var(--spacing,0.25rem)*6)] gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-xs) in-data-[slot=button-group]:rounded-(--radius) has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*3)]",
        sm: "h-[calc(var(--spacing,0.25rem)*7)] gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*3)] text-[0.8rem] in-data-[slot=button-group]:rounded-(--radius) has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*3.5)]",
        lg: "h-[calc(var(--spacing,0.25rem)*9)] gap-[calc(var(--spacing,0.25rem)*2)] px-[calc(var(--spacing,0.25rem)*3)] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)]",
        icon: "size-[calc(var(--spacing,0.25rem)*8)]",
        "icon-xs": "size-[calc(var(--spacing,0.25rem)*6)] rounded-(--radius) in-data-[slot=button-group]:rounded-(--radius) [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*3)]",
        "icon-sm": "size-[calc(var(--spacing,0.25rem)*7)] rounded-(--radius) in-data-[slot=button-group]:rounded-(--radius)",
        "icon-lg": "size-[calc(var(--spacing,0.25rem)*9)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
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
  variant = "default",
  size = "default",
  ...props
}: Omit<LinkPrimitiveProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string
    "aria-current"?: React.AriaAttributes["aria-current"]
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
