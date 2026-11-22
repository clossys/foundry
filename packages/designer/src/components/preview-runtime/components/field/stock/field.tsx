"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "./utils.js"

import { Label } from "./label.js"
import { Separator } from "../../separator/index.js"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("gap-[calc(var(--spacing,0.25rem)*4)] has-[>[data-slot=checkbox-group]]:gap-[calc(var(--spacing,0.25rem)*3)] has-[>[data-slot=radio-group]]:gap-[calc(var(--spacing,0.25rem)*3)] flex flex-col", className)}
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
      className={cn("mb-[calc(var(--spacing,0.25rem)*2)] font-medium data-[variant=label]:text-(length:--text-sm) data-[variant=legend]:text-(length:--text-base)", className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*6)] data-[slot=checkbox-group]:gap-[calc(var(--spacing,0.25rem)*3)] *:data-[slot=field-group]:gap-[calc(var(--spacing,0.25rem)*4)] group/field-group @container/field-group flex w-full flex-col",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva("data-[invalid=true]:text-(--destructive) gap-[calc(var(--spacing,0.25rem)*2)] group/field flex w-full", {
  variants: {
    orientation: {
      vertical:
        "flex-col *:w-full [&>.sr-only]:w-auto",
      horizontal:
        "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      responsive:
        "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
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
        "gap-[calc(var(--spacing,0.25rem)*1)] group/field-content flex flex-1 flex-col leading-snug",
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
        "has-data-checked:bg-(--primary)/5 has-data-checked:border-(--primary)/30 dark:has-data-checked:border-(--primary)/20 dark:has-data-checked:bg-(--primary)/10 gap-[calc(var(--spacing,0.25rem)*2)] leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-(--radius) has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-(--muted)/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-(--ring) has-[>[data-slot=field]]:has-[:focus-visible]:outline-solid has-[>[data-slot=field]]:has-[:focus-visible]:outline-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-offset-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-(--ring) has-[>[data-slot=field]]:has-[:focus-visible]:outline-solid has-[>[data-slot=field]]:has-[:focus-visible]:outline-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-offset-2 has-[>[data-slot=field]]:has-[:focus-visible]:outline-(--ring) *:data-[slot=field]:p-[calc(var(--spacing,0.25rem)*3)] has-data-selected:bg-(--primary)/5 has-data-selected:border-(--primary)/30 dark:has-data-selected:border-(--primary)/20 dark:has-data-selected:bg-(--primary)/10 group/field-label peer/field-label flex w-fit",
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
      className={cn("gap-[calc(var(--spacing,0.25rem)*2)] leading-snug text-(length:--text-sm) font-medium group-data-[disabled=true]/field:opacity-50 flex w-fit items-center", className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-(--muted-foreground) text-start text-(length:--text-sm) [[data-variant=legend]+&]:-mt-[calc(var(--spacing,0.25rem)*2)] font-normal group-has-data-horizontal/field:text-balance",
        "last:mt-0 nth-last-2:-mt-[calc(var(--spacing,0.25rem)*1)]",
        "[&>a]:underline [&>a]:underline-offset-[calc(var(--spacing,0.25rem)*4)] [&>a:hover]:text-(--primary)",
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
      className={cn("-my-[calc(var(--spacing,0.25rem)*2)] h-[calc(var(--spacing,0.25rem)*6)] text-(length:--text-sm) group-data-[variant=outline]/field-group:-mb-[calc(var(--spacing,0.25rem)*2)] relative", className)}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="text-(--muted-foreground) px-[calc(var(--spacing,0.25rem)*2)] relative mx-auto block w-fit bg-(--background)"
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
      <ul className="ms-[calc(var(--spacing,0.25rem)*4)] flex list-disc flex-col gap-[calc(var(--spacing,0.25rem)*1)]">
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
      className={cn("text-(--destructive) text-(length:--text-sm) font-normal", className)}
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
