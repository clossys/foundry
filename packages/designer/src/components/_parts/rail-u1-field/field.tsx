import type * as React from "react"
"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../_parts/rail-u1-utils/index.js"

import { Label } from "../../_parts/rail-u1-label/index.js"
import { Separator } from "../../_parts/rail-u1-separator/index.js"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("gap-(--spacing-lg) has-[>[data-slot=checkbox-group]]:gap-(--spacing-md) has-[>[data-slot=radio-group]]:gap-(--spacing-md) flex flex-col", className)}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn("mb-(--spacing-sm) font-(weight:--font-weight-medium) data-[variant=label]:text-(length:--text-sm) data-[variant=legend]:text-(length:--text-base)", className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "gap-(--spacing-xl) data-[slot=checkbox-group]:gap-(--spacing-md) *:data-[slot=field-group]:gap-(--spacing-lg) group/field-group @container/field-group flex w-full flex-col",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva("data-[invalid=true]:text-(--color-status-danger) gap-(--spacing-sm) group/field flex w-full", {
  variants: {
    orientation: {
      vertical:
        "flex-col *:w-full [&>.sr-only]:w-auto",
      horizontal:
        "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-(--spacing-xs)",
      responsive:
        "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-(--spacing-xs)",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
})

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "gap-(--spacing-xs) group/field-content flex flex-1 flex-col leading-(--leading-snug)",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "has-data-checked:bg-(--color-action)/5 has-data-checked:border-(--color-action)/30 dark:has-data-checked:border-(--color-action)/20 dark:has-data-checked:bg-(--color-action)/10 gap-(--spacing-sm) leading-(--leading-snug) group-data-[disabled=true]/field:opacity-(--ui-alpha-disabled) has-[>[data-slot=field]]:rounded-(--radius-control) has-[>[data-slot=field]]:border-(length:--ui-border-hairline) has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-(--color-surface-sunken)/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-(--color-focus-ring) has-[>[data-slot=field]]:has-[:focus-visible]:outline-solid has-[>[data-slot=field]]:has-[:focus-visible]:outline-(length:--ui-border-focus) has-[>[data-slot=field]]:has-[:focus-visible]:outline-offset-(--ui-focus-offset) has-[>[data-slot=field]]:has-[:focus-visible]:outline-(--color-focus-ring) has-[>[data-slot=field]]:has-[:focus-visible]:outline-solid has-[>[data-slot=field]]:has-[:focus-visible]:outline-(length:--ui-border-focus) has-[>[data-slot=field]]:has-[:focus-visible]:outline-offset-(--ui-focus-offset) has-[>[data-slot=field]]:has-[:focus-visible]:outline-(--color-focus-ring) *:data-[slot=field]:p-(--spacing-md) has-data-selected:bg-(--color-action)/5 has-data-selected:border-(--color-action)/30 dark:has-data-selected:border-(--color-action)/20 dark:has-data-selected:bg-(--color-action)/10 group/field-label peer/field-label flex w-fit",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn("gap-(--spacing-sm) leading-(--leading-snug) text-(length:--text-sm) font-(weight:--font-weight-medium) group-data-[disabled=true]/field:opacity-(--ui-alpha-disabled) flex w-fit items-center", className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-(--color-ink-muted) text-start text-(length:--text-sm) [[data-variant=legend]+&]:-mt-(--spacing-sm) leading-(--leading-normal) font-(weight:--font-weight-normal) group-has-data-horizontal/field:text-balance",
        "last:mt-0 nth-last-2:-mt-(--spacing-xs)",
        "[&>a]:underline [&>a]:underline-offset-(--spacing-lg) [&>a:hover]:text-(--color-action)",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn("-my-(--spacing-sm) h-(--spacing-xl) text-(length:--text-sm) group-data-[variant=outline]/field-group:-mb-(--spacing-sm) relative", className)}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="text-(--color-ink-muted) px-(--spacing-sm) relative mx-auto block w-fit bg-(--color-surface-base)"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ms-(--spacing-lg) flex list-disc flex-col gap-(--spacing-xs)">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-(--color-status-danger) text-(length:--text-sm) font-(weight:--font-weight-normal)", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
