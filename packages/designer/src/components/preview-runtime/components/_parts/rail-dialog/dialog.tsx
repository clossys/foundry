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
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade bg-black/10 motion-safe:duration-100 motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50",
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
          "bg-(--popover) text-(--foreground) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom ring-(--foreground)/10 grid max-w-[calc(100%-calc(var(--spacing,0.25rem)*8))] gap-[calc(var(--spacing,0.25rem)*4)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*4)] text-(length:--text-sm) ring-1 motion-safe:duration-100 motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 sm:max-w-[24rem] fixed top-1/2 start-1/2 z-50 w-full ltr:-translate-x-1/2 rtl:translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
          className
        )}
      >
        <DialogPrimitive
          data-slot="dialog"
          className="[display:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
        >
          {children}
          {showCloseButton && (
            <DialogClose
              variant="ghost"
              className="absolute top-[calc(var(--spacing,0.25rem)*2)] end-[calc(var(--spacing,0.25rem)*2)]"
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
      className={cn("gap-[calc(var(--spacing,0.25rem)*2)] flex flex-col", className)}
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
        "bg-(--muted)/50 -mx-[calc(var(--spacing,0.25rem)*4)] -mb-[calc(var(--spacing,0.25rem)*4)] rounded-b-(--radius) border-t p-[calc(var(--spacing,0.25rem)*4)] flex flex-col-reverse gap-[calc(var(--spacing,0.25rem)*2)] sm:flex-row sm:justify-end",
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
      className={cn("text-(length:--text-base) leading-none font-medium", className)}
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
      className={cn("text-(--muted-foreground) *:[a]:hover:text-(--foreground) text-(length:--text-sm) *:[a]:underline *:[a]:underline-offset-[calc(var(--spacing,0.25rem)*3)]", className)}
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
