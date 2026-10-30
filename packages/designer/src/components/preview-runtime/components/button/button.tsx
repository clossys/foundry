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
  "focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 rounded-(--radius-control) border-(length:--ui-border-hairline,1px)  bg-clip-padding text-(length:--text-sm) font-(weight:--font-weight-medium) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) active:not-aria-[haspopup]:translate-y-(--ui-border-hairline) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) select-none disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled,50%) [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-(--color-action) text-(--color-ink-on-action) hover:bg-(--color-action)/80",
        outline: "border-(--color-line-base) bg-(--color-surface-base) hover:bg-(--color-surface-sunken) hover:text-(--color-ink-primary) dark:bg-(--color-line-strong)/30 dark:border-(--color-line-strong) dark:hover:bg-(--color-line-strong)/50 aria-expanded:bg-(--color-surface-sunken) aria-expanded:text-(--color-ink-primary)",
        secondary: "bg-(--color-control-tonal) text-(--color-ink-primary) hover:bg-[color-mix(in_oklch,var(--color-control-tonal),var(--color-ink-primary)_5%)] aria-expanded:bg-(--color-control-tonal) aria-expanded:text-(--color-ink-primary)",
        ghost: "hover:bg-(--color-surface-sunken) hover:text-(--color-ink-primary) dark:hover:bg-(--color-surface-sunken)/50 aria-expanded:bg-(--color-surface-sunken) aria-expanded:text-(--color-ink-primary)",
        destructive: "bg-(--color-status-danger)/10 hover:bg-(--color-status-danger)/20 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) dark:focus-visible:outline-solid dark:focus-visible:outline-(length:--ui-border-focus,3px) dark:focus-visible:outline-offset-(--ui-focus-offset) dark:focus-visible:outline-(--color-focus-ring) dark:bg-(--color-status-danger)/20 text-(--color-status-danger) focus-visible:border-(--color-status-danger)/40 dark:hover:bg-(--color-status-danger)/30",
        link: "text-(--color-accent-text) underline-offset-(--spacing-lg) hover:underline",
      },
      size: {
        default: "h-(--ui-control-h-md,calc(var(--spacing)*8)) gap-(--spacing-sm) px-(--spacing-md) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm)",
        xs: "h-(--spacing-xl) gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-sm) text-(length:--text-xs) in-data-[slot=button-group]:rounded-(--radius-control) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--spacing-md)",
        sm: "h-(--ui-control-h-sm,calc(var(--spacing)*7)) gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-md) text-(length:--text-caption) in-data-[slot=button-group]:rounded-(--radius-control) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--ui-control-switch-thumb,calc(var(--spacing)*3.5))",
        lg: "h-(--ui-control-h-lg,calc(var(--spacing)*9)) gap-(--spacing-sm) px-(--spacing-md) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm)",
        icon: "size-(--ui-control-h-md,calc(var(--spacing)*8))",
        "icon-xs": "size-(--spacing-xl) rounded-(--radius-control) in-data-[slot=button-group]:rounded-(--radius-control) [&_svg:not([class*='size-'])]:size-(--spacing-md)",
        "icon-sm": "size-(--ui-control-h-sm,calc(var(--spacing)*7)) rounded-(--radius-control) in-data-[slot=button-group]:rounded-(--radius-control)",
        "icon-lg": "size-(--ui-control-h-lg,calc(var(--spacing)*9))",
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
