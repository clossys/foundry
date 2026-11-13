"use client"

import type { ComponentProps as ReactComponentProps } from "react"
import { cn } from "../_parts/utils/index.js"
import {
  DialogTrigger,
  Heading,
  Popover as PopoverPrimitive,
  type DialogTriggerProps,
  type PopoverProps as PopoverPrimitiveProps,
} from "react-aria-components"

function PopoverTrigger({ children, ...props }: DialogTriggerProps) {
  return (
    <DialogTrigger data-slot="popover-trigger" {...props}>
      {children}
    </DialogTrigger>
  )
}

function Popover({
  className,
  placement = "bottom",
  offset = 4,
  crossOffset = 0,
  ...props
}: Omit<PopoverPrimitiveProps, "className"> & {
  className?: string
}) {
  return (
    <PopoverPrimitive
      data-slot="popover-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "bg-(--color-overlay-surface) text-(--color-ink-primary) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--color-ink-primary)/10 flex flex-col gap-(--spacing-md) rounded-(--radius-control) p-(--spacing-md) text-(length:--text-sm) shadow-(--ui-elevation-floating) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) z-(--ui-z-modal,50) w-[calc(var(--spacing-6xl)*2)] origin-(--trigger-anchor-point) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
        className
      )}
      {...props}
    />
  )
}

function PopoverHeader({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-[var(--spacing-xs)] text-(length:--text-sm)", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: ReactComponentProps<typeof Heading>) {
  return (
    <Heading
      data-slot="popover-title"
      className={cn("font-(weight:--font-weight-medium)", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="popover-description"
      className={cn("text-(--color-ink-muted)", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
