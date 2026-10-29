"use client"

import { Icon as LibraryIcon } from "../../icon/index.js"
import * as React from "react"
import { cn, resolveRailCopy, RAIL_COPY_REFS, type CopyResolver } from "../../_parts/rail-utils/index.js"
import {
  Dialog as DialogPrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  Heading,
  ModalOverlay as ModalOverlayPrimitive,
  Modal as ModalPrimitive,
  type DialogProps as DialogPrimitiveProps,
  type DialogTriggerProps as DialogTriggerPrimitiveProps,
  type ModalOverlayProps as ModalOverlayPrimitiveProps,
} from "react-aria-components"

import { Button } from "../../_parts/rail-button/index.js"
function DialogTrigger({ ...props }: DialogTriggerPrimitiveProps) {
  return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />
}

function DialogClose({
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
      data-slot="dialog-close"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

function DialogOverlay({
  className,
  children,
  ...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> & {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ModalOverlayPrimitive
      data-slot="dialog-overlay"
      className={cn(
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade bg-(--color-overlay-scrim) motion-safe:duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-(--ui-z-modal)",
        className
      )}
      {...props}
    >
      {children}
    </ModalOverlayPrimitive>
  )
}

function Dialog({
  copyResolver,
  className,
  children,
  /** @default true */
  showCloseButton = true,
  /** @default true */
  isDismissable = true,
  ...props
}: (Omit<ModalOverlayPrimitiveProps, "className" | "children"> &
  Pick<React.ComponentProps<typeof ModalPrimitive>, "isDismissable"> & {
    className?: string
    children: React.ReactNode
    showCloseButton?: boolean
  }) & { copyResolver?: CopyResolver }) {
  return (
    <DialogOverlay isDismissable={isDismissable} {...props}>
      <ModalPrimitive
        data-slot="dialog-content"
        className={cn(
          "bg-(--color-overlay-surface) text-(--color-ink-primary) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom ring-(--color-ink-primary)/10 grid max-w-[calc(100%-var(--spacing-2xl))] gap-(--spacing-lg) rounded-(--radius-control) p-(--spacing-lg) text-(length:--text-sm) ring-(length:--ui-border-hairline) motion-safe:duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 sm:max-w-(--ui-width-notice-max) fixed top-1/2 start-1/2 z-(--ui-z-modal) w-full ltr:-translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
          className
        )}
      >
        <DialogPrimitive
          data-slot="dialog"
          className="[display:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)"
        >
          {children}
          {showCloseButton && (
            <DialogClose
              variant="ghost"
              className="absolute top-(--spacing-sm) end-(--spacing-sm)"
              size="icon-sm"
            >
              <LibraryIcon asset="assets.icon-close" decorative />
              <span className="sr-only">{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sheet.close"])}</span>
            </DialogClose>
          )}
        </DialogPrimitive>
      </ModalPrimitive>
    </DialogOverlay>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("gap-(--spacing-sm) flex flex-col", className)}
      {...props}
    />
  )
}

function DialogFooter({
  copyResolver,
  className,
  /** @default false */
  showCloseButton = false,
  children,
  ...props
}: (React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) & { copyResolver?: CopyResolver }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-(--color-surface-sunken)/50 -mx-(--spacing-lg) -mb-(--spacing-lg) rounded-b-(--radius-control) border-t-(length:--ui-border-hairline) p-(--spacing-lg) flex flex-col-reverse gap-(--spacing-sm) sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogClose variant="outline">{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sheet.close"])}</DialogClose>}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Heading>, "slot">) {
  return (
    <Heading
      slot="title"
      data-slot="dialog-title"
      className={cn("text-(length:--text-base) leading-(--leading-heading) font-(weight:--font-weight-medium)", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "slot">) {
  return (
    <div
      data-slot="dialog-description"
      className={cn("text-(--color-ink-muted) *:[a]:hover:text-(--color-ink-primary) text-(length:--text-sm) *:[a]:underline *:[a]:underline-offset-(--spacing-md)", className)}
      {...props}
    />
  )
}

export {
  type DialogPrimitiveProps,
  type DialogTriggerPrimitiveProps,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
}
