"use client"

import type { DateFieldProps, DateInputProps, DateValue } from "react-aria-components"
import {
  DateField as DateFieldPrimitive,
  DateInput as DateInputPrimitive,
  DateSegment,
} from "react-aria-components"
import { twJoin } from "tailwind-merge"
import { cx } from "./primitive.js"
import { fieldStyles } from "./field.js"

export function DateField<T extends DateValue>({ className, ...props }: DateFieldProps<T>) {
  return (
    <DateFieldPrimitive
      {...props}
      data-slot="control"
      className={cx(fieldStyles({ className: "w-fit" }), className)}
    />
  )
}

export function DateInput({ className, ...props }: Omit<DateInputProps, "children">) {
  return (
    <span data-slot="control" className="relative block">
      <DateInputPrimitive
        className={cx(
          "relative block appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]",
          "text-base/6 text-foreground placeholder:text-muted-foreground sm:text-sm/6",
          "bg-(--control-bg,transparent)",
          "border border-input enabled:hover:border-muted-foreground/30",
          "focus-within:border-ring/70 focus-within:bg-accent/5 focus-within:outline-hidden focus-within:ring-3 focus-within:ring-ring/20 focus-within:hover:border-ring/80",
          "group-open:border-ring/70 group-open:bg-accent/5 group-open:outline-hidden group-open:ring-3 group-open:ring-ring/20 group-open:enabled:hover:border-ring/80",
          "invalid:border-destructive/70 invalid:bg-destructive/5 focus-within:invalid:border-destructive/70 focus-within:invalid:bg-destructive/5 focus-within:invalid:ring-destructive/20 focus-within:invalid:hover:border-destructive/80 invalid:enabled:hover:border-destructive/80",
          "in-disabled:bg-muted disabled:bg-muted forced-colors:in-disabled:text-[GrayText] forced-colors:disabled:text-[GrayText]",
          "dark:scheme-dark",
          className
        )}
        {...props}
      >
        {(segment) => (
          <DateSegment
            segment={segment}
            className={twJoin(
              "inline shrink-0 rounded px-1 type-literal:px-0 py-0.5 text-foreground tracking-wider caret-transparent outline-0 data-placeholder:not-data-focused:text-muted-foreground sm:text-sm",
              "focus:bg-accent focus:text-accent-foreground focus:data-invalid:bg-destructive/10 focus:data-invalid:text-destructive forced-colors:focus:bg-[Highlight] forced-colors:focus:text-[HighlightText]",
              "forced-color-adjust-none forced-colors:text-[ButtonText]",
              "in-disabled:bg-muted disabled:bg-muted forced-colors:disabled:text-[GrayText]"
            )}
          />
        )}
      </DateInputPrimitive>
    </span>
  )
}
