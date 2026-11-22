"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import type { ComponentProps as ReactComponentProps, ReactNode as ReactNode } from "react"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  Dialog as DialogPrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  Heading,
  ModalOverlay as ModalOverlayPrimitive,
  Modal as ModalPrimitive,
  type DialogProps as DialogPrimitiveProps,
  type DialogTriggerProps as DialogTriggerPrimitiveProps,
  type ModalOverlayProps as ModalOverlayPrimitiveProps,
} from "react-aria-components"

import { Button } from "../button/index.js"
function DialogTrigger({ ...props }: DialogTriggerPrimitiveProps) {
  return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />
}

function DialogClose({
  className,
  variant = "outline",
  ...props
}: ReactComponentProps<typeof Button> & { className?: string }) {
  return (
    <Button
      slot="close"
      data-slot="dialog-close"
      variant={variant}
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
  children: ReactNode
}) {
  return (
    <ModalOverlayPrimitive
      data-slot="dialog-overlay"
      className={cn(
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50",
        className
      )}
      {...props}
    >
      {children}
    </ModalOverlayPrimitive>
  )
}

function Dialog({
  className,
  children,
  showCloseButton = true,
  isDismissable = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  ref,
  ...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> &
  Pick<ReactComponentProps<typeof ModalPrimitive>, "isDismissable"> & {
    className?: string
    children: DialogPrimitiveProps["children"]
    "aria-label"?: DialogPrimitiveProps["aria-label"]
    "aria-labelledby"?: DialogPrimitiveProps["aria-labelledby"]
    "aria-describedby"?: DialogPrimitiveProps["aria-describedby"]
    ref?: ReactComponentProps<typeof DialogPrimitive>["ref"]
    showCloseButton?: boolean
  }) {
  return (
    <DialogOverlay isDismissable={isDismissable} {...props}>
      <ModalPrimitive
        data-slot="dialog-content"
        className={cn(
          "bg-(--popover) text-(--foreground) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom ring-(--foreground)/10 grid max-w-[calc(100%-calc(var(--spacing,0.25rem)*8))] gap-[calc(var(--spacing,0.25rem)*4)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*4)] text-(length:--text-sm) ring-1 duration-100 sm:max-w-[24rem] fixed top-1/2 start-1/2 z-50 w-full -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
          className
        )}
      >
        <DialogContent
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-describedby={ariaDescribedby}
          ref={ref}
          showCloseButton={showCloseButton}
        >
          {children}
        </DialogContent>
      </ModalPrimitive>
    </DialogOverlay>
  )
}

function DialogContent({
  children,
  showCloseButton = true,
  ...props
}: Omit<ReactComponentProps<typeof DialogPrimitive>, "className" | "style"> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPrimitive
      data-slot="dialog"
      className="[display:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
      {...props}
    >
      {composeRenderProps(children, (children) => (
        <>
      {children}
      {showCloseButton && (
        <DialogClose
          variant="ghost"
          className="absolute top-[calc(var(--spacing,0.25rem)*2)] end-[calc(var(--spacing,0.25rem)*2)]"
          shape="icon-only"
        >
          <LibraryIcon asset="assets.icon-close" decorative />
          <span className="sr-only">Close</span>
        </DialogClose>
      )}
        </>
      ))}
    </DialogPrimitive>
  )
}

function DialogHeader({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("gap-[calc(var(--spacing,0.25rem)*2)] flex flex-col", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ReactComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
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
      {showCloseButton && <DialogClose variant="outline">Close</DialogClose>}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: Omit<ReactComponentProps<typeof Heading>, "slot">) {
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
}: Omit<ReactComponentProps<"div">, "slot">) {
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
}
