"use client"

import * as React from "react"
import { cn } from "../_parts/utils/index.js"
import {
  Cell as CellPrimitive,
  Column as ColumnPrimitive,
  Row as RowPrimitive,
  TableBody as TableBodyPrimitive,
  TableFooter as TableFooterPrimitive,
  TableHeader as TableHeaderPrimitive,
  Table as TablePrimitive,
  type CellProps,
  type ColumnProps,
  type RowProps,
  type TableBodyProps,
  type TableFooterProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components"

function Table({ className, ...props }: TableProps) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <TablePrimitive
        data-slot="table"
        className={cn("w-full caption-bottom text-(length:--text-sm)", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader<T>({ className, ...props }: TableHeaderProps<T>) {
  return (
    <TableHeaderPrimitive
      data-slot="table-header"
      className={cn("[&_tr]:border-b-(length:--ui-border-hairline)", className)}
      {...props}
    />
  )
}

function TableBody<T>({ className, ...props }: TableBodyProps<T>) {
  return (
    <TableBodyPrimitive
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0 data-empty:h-(--spacing-5xl) data-empty:text-center",
        className
      )}
      {...props}
    />
  )
}

function TableFooter<T>({ className, ...props }: TableFooterProps<T>) {
  return (
    <TableFooterPrimitive
      data-slot="table-footer"
      className={cn("bg-(--color-surface-sunken)/50 border-t-(length:--ui-border-hairline) font-(weight:--font-weight-medium) [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow<T>({ className, ...props }: RowProps<T>) {
  return (
    <RowPrimitive
      data-slot="table-row"
      className={cn(
        "hover:bg-(--color-surface-sunken)/50 data-[state=selected]:bg-(--color-surface-sunken) border-b-(length:--ui-border-hairline) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) data-selected:bg-(--color-surface-sunken) has-aria-expanded:bg-(--color-surface-sunken)/50",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ColumnProps) {
  return (
    <ColumnPrimitive
      data-slot="table-head"
      className={cn("text-(--color-ink-primary) h-[var(--spacing-3xl)] px-(--spacing-sm) text-start align-middle font-(weight:--font-weight-medium) whitespace-nowrap [&:has([role=checkbox])]:pe-0 [&:has([data-slot=checkbox])]:pe-0", className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: CellProps) {
  return (
    <CellPrimitive
      data-slot="table-cell"
      className={cn("p-(--spacing-sm) align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0 [&:has([data-slot=checkbox])]:pe-0", className)}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"figcaption">) {
  return (
    <figcaption
      data-slot="table-caption"
      className={cn("text-(--color-ink-muted) mt-(--spacing-lg) text-(length:--text-sm) text-center", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
