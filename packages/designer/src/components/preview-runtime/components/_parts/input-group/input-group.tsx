"use client"

import type { ComponentProps as ReactComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../_parts/utils/index.js"
import { Group, type GroupProps } from "react-aria-components"

import { Button } from "../../button/index.js"
import { Input } from "react-aria-components"
import { TextArea as Textarea } from "react-aria-components"
function InputGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="input-group"
      className={cn(
        "group/input-group border-(--color-line-strong) dark:bg-(--color-line-strong)/30 has-[[data-slot=input-group-control]:focus-visible]:border-(--color-focus-ring) has-[[data-slot=input-group-control]:focus-visible]:outline-solid has-[[data-slot=input-group-control]:focus-visible]:outline-(length:--ui-border-focus,3px) has-[[data-slot=input-group-control]:focus-visible]:outline-offset-(--ui-focus-offset) has-[[data-slot=input-group-control]:focus-visible]:outline-(--color-focus-ring) has-[[data-slot][aria-invalid=true]]:outline-solid has-[[data-slot][aria-invalid=true]]:outline-(length:--ui-border-focus,3px) has-[[data-slot][aria-invalid=true]]:outline-offset-(--ui-focus-offset) has-[[data-slot][aria-invalid=true]]:outline-(--color-status-danger) has-[[data-slot][aria-invalid=true]]:border-(--color-status-danger) dark:has-[[data-slot][aria-invalid=true]]:ring-(--color-status-danger)/40 has-disabled:bg-(--color-line-strong)/50 dark:has-disabled:bg-(--color-line-strong)/80 h-(--ui-control-h-md,calc(var(--spacing)*8)) rounded-(--radius-control) border-(length:--ui-border-hairline,1px) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:opacity-(--ui-alpha-disabled,50%) has-[[data-slot=input-group-control]:focus-visible]:outline-solid has-[[data-slot=input-group-control]:focus-visible]:outline-(length:--ui-border-focus,3px) has-[[data-slot=input-group-control]:focus-visible]:outline-offset-(--ui-focus-offset) has-[[data-slot=input-group-control]:focus-visible]:outline-(--color-focus-ring) has-[[data-slot][aria-invalid=true]]:outline-solid has-[[data-slot][aria-invalid=true]]:outline-(length:--ui-border-focus,3px) has-[[data-slot][aria-invalid=true]]:outline-offset-(--ui-focus-offset) has-[[data-slot][aria-invalid=true]]:outline-(--color-status-danger) has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-(--spacing-md) has-[>[data-align=block-start]]:[&>input]:pb-(--spacing-md) has-[>[data-align=inline-end]]:[&>input]:pe-(--spacing-sm) has-[>[data-align=inline-start]]:[&>input]:ps-(--spacing-sm) text-(length:--text-body) font-(family-name:--font-body) relative flex w-full min-w-0 items-center has-[>textarea]:h-auto",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "text-(--color-ink-muted) h-auto gap-(--spacing-sm) py-(--spacing-sm) text-(length:--text-body) font-(weight:--font-weight-medium) group-data-[disabled=true]/input-group:opacity-(--ui-alpha-disabled,50%) [&>kbd]:rounded-(--radius-subtle) [&>svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) flex cursor-text items-center justify-center select-none",
  {
    variants: {
      align: {
        "inline-start": "ps-(--spacing-sm) has-[>button]:ms-[calc(var(--spacing-xs)*-1)] has-[>kbd]:ms-[calc(var(--spacing-xs)*-1)] order-first",
        "inline-end": "pe-(--spacing-sm) has-[>button]:me-[calc(var(--spacing-xs)*-1)] has-[>kbd]:me-[calc(var(--spacing-xs)*-1)] order-last",
        "block-start":
          "px-(--spacing-md) pt-(--spacing-sm) group-has-[>input]/input-group:pt-(--spacing-sm) [.border-b]:pb-(--spacing-sm) order-first w-full justify-start",
        "block-end":
          "px-(--spacing-md) pb-(--spacing-sm) group-has-[>input]/input-group:pb-(--spacing-sm) [.border-t]:pt-(--spacing-sm) order-last w-full justify-start",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: ReactComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
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

const inputGroupButtonVariants = cva(
  "gap-(--spacing-sm) text-(length:--text-body) flex items-center shadow-(--ui-elevation-none)",
  {
    variants: {
      size: {
        xs: "h-(--spacing-xl) gap-(--spacing-xs) rounded-(--radius-default) px-(--spacing-sm) [&>svg:not([class*='size-'])]:size-(--ui-control-switch-thumb,calc(var(--spacing)*3.5))",
        sm: "",
        "icon-xs": "size-(--spacing-xl) rounded-(--radius-default) p-0 has-[>svg]:p-0",
        "icon-sm": "size-(--spacing-2xl) p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<ReactComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
    className?: string
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

function InputGroupText({ className, ...props }: ReactComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-(--color-ink-muted) gap-(--spacing-sm) text-(length:--text-body) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) flex items-center [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: ReactComponentProps<"input">) {
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
}: ReactComponentProps<"textarea">) {
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
