"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn, resolveRailCopy, RAIL_COPY_REFS, type CopyResolver } from "../_parts/rail-utils/index.js"
import {
  Heading,
  ModalOverlay as ModalOverlayPrimitive,
  Modal as ModalPrimitive,
  Dialog as SheetPrimitive,
  DialogTrigger as SheetTriggerPrimitive,
  type ModalOverlayProps as ModalOverlayPrimitiveProps,
  type DialogProps as SheetPrimitiveProps,
  type DialogTriggerProps as SheetTriggerPrimitiveProps,
} from "react-aria-components"

import { Button } from "../_parts/rail-button/index.js"
function SheetTrigger({ ...props }: SheetTriggerPrimitiveProps) {
  return <SheetTriggerPrimitive data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  className,
  /** @default "outline" */
  variant = "outline",
  /** @default "default" */
  size = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      slot="close"
      data-slot="sheet-close"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

function SheetOverlay({
  className,
  children,
  ...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> & {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ModalOverlayPrimitive
      data-slot="sheet-overlay"
      isDismissable
      className={cn(
        "bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50 motion-safe:transition-opacity motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-150 data-entering:opacity-0 data-exiting:opacity-0",
        className
      )}
      {...props}
    >
      {children}
    </ModalOverlayPrimitive>
  )
}

function Sheet({
  copyResolver,
  className,
  children,
  /** @default "right" */
  side = "right",
  /** @default true */
  showCloseButton = true,
  ...props
}: (Omit<ModalOverlayPrimitiveProps, "className" | "children"> &
  Pick<React.ComponentProps<typeof ModalPrimitive>, "isDismissable"> & {
    className?: string
    children: React.ReactNode
    side?: "top" | "right" | "bottom" | "left"
    showCloseButton?: boolean
  }) & { copyResolver?: CopyResolver }) {
  return (
    <SheetOverlay {...props}>
      <ModalPrimitive
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "bg-(--popover) text-(--foreground) fixed z-50 flex flex-col gap-[calc(var(--spacing,0.25rem)*4)] bg-clip-padding text-(length:--text-sm) shadow-(--shadow-lg) motion-safe:transition motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:start-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-e data-[side=right]:inset-y-0 data-[side=right]:end-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-s data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-entering:opacity-0 data-exiting:opacity-0 data-[side=bottom]:data-entering:translate-y-[calc(var(--spacing,0.25rem)*8)] data-[side=bottom]:data-exiting:translate-y-[calc(var(--spacing,0.25rem)*8)] data-[side=left]:data-entering:ltr:-translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=left]:data-entering:rtl:translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=left]:data-exiting:ltr:-translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=left]:data-exiting:rtl:translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=right]:data-entering:ltr:translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=right]:data-entering:rtl:-translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=right]:data-exiting:ltr:translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=right]:data-exiting:rtl:-translate-x-[calc(var(--spacing,0.25rem)*8)] data-[side=top]:data-entering:-translate-y-[calc(var(--spacing,0.25rem)*8)] data-[side=top]:data-exiting:-translate-y-[calc(var(--spacing,0.25rem)*8)]",
          className
        )}
      >
        <SheetPrimitive
          data-slot="sheet"
          className="[display:inherit] h-full max-h-[inherit] [flex-direction:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
        >
          {children}
          {showCloseButton && (
            <SheetClose
              variant="ghost"
              className="absolute top-[calc(var(--spacing,0.25rem)*3)] end-[calc(var(--spacing,0.25rem)*3)]"
              size="icon-sm"
            >
              <LibraryIcon asset="assets.icon-close" decorative />
              <span className="sr-only">{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sheet.close"])}</span>
            </SheetClose>
          )}
        </SheetPrimitive>
      </ModalPrimitive>
    </SheetOverlay>
  )
}

function SheetContent({
  className,
  children,
  /** @default "right" */
  side = "right",
  /** @default true */
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Sheet> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <Sheet
      className={className}
      side={side}
      showCloseButton={showCloseButton}
      {...props}
    >
      {children}
    </Sheet>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("gap-[calc(var(--spacing,0.25rem)*1)] p-[calc(var(--spacing,0.25rem)*4)] flex flex-col", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("gap-[calc(var(--spacing,0.25rem)*2)] p-[calc(var(--spacing,0.25rem)*4)] mt-auto flex flex-col", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Heading>, "slot">) {
  return (
    <Heading
      slot="title"
      data-slot="sheet-title"
      className={cn("text-(--foreground) text-(length:--text-base) font-medium", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "slot">) {
  return (
    <div
      data-slot="sheet-description"
      className={cn("text-(--muted-foreground) text-(length:--text-sm)", className)}
      {...props}
    />
  )
}

export {
  type SheetPrimitiveProps,
  type SheetTriggerPrimitiveProps,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
