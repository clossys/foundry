"use client"

import {
  FieldError as FieldErrorPrimitive,
  type FieldErrorProps,
  LabelContext,
  Label as LabelPrimitive,
  type LabelProps,
  Text,
  type TextProps,
} from "react-aria-components"
import { tv } from "tailwind-variants"
import { cn } from "../preview-runtime/components/_parts/utils/index.js"
import { cx } from "./primitive.js"

export const labelStyles = tv({
  base: [
    "text-foreground text-base/6 select-none in-data-required:not-data-[slot='control-label']:after:ml-1.5 sm:text-sm/6",
    "in-data-required:not-data-[slot='control-label']:after:text-destructive in-data-required:not-data-[slot='control-label']:after:content-['*']",
    "group-disabled:opacity-50 in-disabled:pointer-events-none in-disabled:opacity-50",
  ],
})

export const descriptionStyles = tv({
  base: "text-muted-foreground block text-sm/6 group-disabled:opacity-50 in-disabled:opacity-50",
})

export const fieldErrorStyles = tv({
  base: "text-destructive block text-sm/6 group-disabled:opacity-50 in-disabled:opacity-50 forced-colors:text-[Mark]",
})

export const fieldStyles = tv({
  base: [
    "w-full",
    "[&>[data-slot=control]+[data-slot=control]]:mt-2",
    "[&>[data-slot=label]+[data-slot=control]]:mt-2",
    "[&>[data-slot=label]+[slot='description']]:mt-1",
    "[&>[slot=description]+[data-slot=control]]:mt-2",
    "[&>[data-slot=control]+[slot=description]]:mt-2",
    "[&>[data-slot=control]+[slot=errorMessage]]:mt-2",
    "*:data-[slot=label]:font-medium",
    "disabled:opacity-50 in-disabled:opacity-50",
  ],
})

export function Label({ className, htmlFor, slot, ...props }: LabelProps) {
  const label = (
    <LabelPrimitive data-slot="label" {...props} className={labelStyles({ className })} />
  )

  if (htmlFor && slot === undefined) {
    return <LabelContext.Provider value={null}>{label}</LabelContext.Provider>
  }

  return label
}

export function Description({ className, ...props }: TextProps) {
  return <Text {...props} slot="description" className={descriptionStyles({ className })} />
}

export function Fieldset({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn("*:data-[slot=text]:mt-1 [&>*+[data-slot=control]]:mt-6", className)}
      {...props}
    />
  )
}

export function FieldGroup({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div data-slot="control" className={cn("gap-6", className)} {...props} />
}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return <FieldErrorPrimitive {...props} className={cx(fieldErrorStyles(), className)} />
}

export function Legend({ className, ...props }: React.ComponentProps<"legend">) {
  return (
    <legend
      data-slot="legend"
      {...props}
      className={cn("font-semibold text-base/6 data-disabled:opacity-50", className)}
    />
  )
}
