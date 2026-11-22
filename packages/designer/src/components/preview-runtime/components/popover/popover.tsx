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
        "bg-(--popover) text-(--foreground) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--foreground)/10 flex flex-col gap-[calc(var(--spacing,0.25rem)*3)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*3)] text-(length:--text-sm) shadow-(--shadow-md) ring-1 duration-100 z-50 w-[calc(calc(var(--spacing,0.25rem)*32)*2)] origin-(--trigger-anchor-point) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
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
      className={cn("flex flex-col gap-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm)", className)}
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
      className={cn("font-medium", className)}
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
      className={cn("text-(--muted-foreground)", className)}
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
