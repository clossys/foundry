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
        "bg-(--color-overlay-scrim) supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-(--ui-z-modal) motion-safe:transition-opacity motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) motion-safe:duration-(--ui-duration-fast) data-entering:opacity-0 data-exiting:opacity-0",
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
          "bg-(--color-overlay-surface) text-(--color-ink-primary) fixed z-(--ui-z-modal) flex flex-col gap-(--spacing-lg) bg-clip-padding text-(length:--text-sm) shadow-(--ui-elevation-floating) motion-safe:transition motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t-(length:--ui-border-hairline) data-[side=left]:inset-y-0 data-[side=left]:start-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-e-(length:--ui-border-hairline) data-[side=right]:inset-y-0 data-[side=right]:end-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-s-(length:--ui-border-hairline) data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b-(length:--ui-border-hairline) data-[side=left]:sm:max-w-(--ui-width-notice-max) data-[side=right]:sm:max-w-(--ui-width-notice-max) data-entering:opacity-0 data-exiting:opacity-0 data-[side=bottom]:data-entering:translate-y-(--spacing-2xl) data-[side=bottom]:data-exiting:translate-y-(--spacing-2xl) data-[side=left]:data-entering:ltr:-translate-x-(--spacing-2xl) data-[side=left]:data-entering:rtl:translate-x-(--spacing-2xl) data-[side=left]:data-exiting:ltr:-translate-x-(--spacing-2xl) data-[side=left]:data-exiting:rtl:translate-x-(--spacing-2xl) data-[side=right]:data-entering:ltr:translate-x-(--spacing-2xl) data-[side=right]:data-entering:rtl:-translate-x-(--spacing-2xl) data-[side=right]:data-exiting:ltr:translate-x-(--spacing-2xl) data-[side=right]:data-exiting:rtl:-translate-x-(--spacing-2xl) data-[side=top]:data-entering:-translate-y-(--spacing-2xl) data-[side=top]:data-exiting:-translate-y-(--spacing-2xl)",
          className
        )}
      >
        <SheetPrimitive
          data-slot="sheet"
          className="[display:inherit] h-full max-h-[inherit] [flex-direction:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)"
        >
          {children}
          {showCloseButton && (
            <SheetClose
              variant="ghost"
              className="absolute top-(--spacing-md) end-(--spacing-md)"
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
      className={cn("gap-(--spacing-xs) p-(--spacing-lg) flex flex-col", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("gap-(--spacing-sm) p-(--spacing-lg) mt-auto flex flex-col", className)}
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
      className={cn("text-(--color-ink-primary) text-(length:--text-base) font-(weight:--font-weight-medium)", className)}
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
      className={cn("text-(--color-ink-muted) text-(length:--text-sm)", className)}
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
