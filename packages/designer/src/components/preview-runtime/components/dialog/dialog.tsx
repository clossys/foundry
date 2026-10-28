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
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade bg-(--color-overlay-scrim) duration-(--ui-duration-fast,100ms) supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-(--ui-z-modal,50)",
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
          "bg-(--color-overlay-surface) text-(--color-ink-primary) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom ring-(--color-ink-primary)/10 grid max-w-[calc(100%-var(--spacing-2xl))] gap-(--spacing-lg) rounded-(--radius-control) p-(--spacing-lg) text-(length:--text-sm) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) sm:max-w-[24rem] fixed top-1/2 start-1/2 z-(--ui-z-modal,50) w-full -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
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
      className="[display:inherit] [gap:inherit] focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)"
      {...props}
    >
      {composeRenderProps(children, (children) => (
        <>
      {children}
      {showCloseButton && (
        <DialogClose
          variant="ghost"
          className="absolute top-(--spacing-sm) end-(--spacing-sm)"
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
      className={cn("gap-(--spacing-sm) flex flex-col", className)}
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
        "bg-(--color-surface-sunken)/50 -mx-(--spacing-lg) -mb-(--spacing-lg) rounded-b-(--radius-control) border-t-(length:--ui-border-hairline) p-(--spacing-lg) flex flex-col-reverse gap-(--spacing-sm) sm:flex-row sm:justify-end",
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
      className={cn("text-(length:--text-base) leading-(--leading-heading) font-(weight:--font-weight-medium)", className)}
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
}
