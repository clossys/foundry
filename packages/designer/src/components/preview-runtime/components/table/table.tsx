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
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody<T>({ className, ...props }: TableBodyProps<T>) {
  return (
    <TableBodyPrimitive
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0 data-empty:h-[calc(var(--spacing,0.25rem)*24)] data-empty:text-center",
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
      className={cn("bg-(--muted)/50 border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow<T>({ className, ...props }: RowProps<T>) {
  return (
    <RowPrimitive
      data-slot="table-row"
      className={cn(
        "hover:bg-(--muted)/50 data-[state=selected]:bg-(--muted) border-b transition-colors data-selected:bg-(--muted) has-aria-expanded:bg-(--muted)/50",
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
      className={cn("text-(--foreground) h-[calc(var(--spacing,0.25rem)*12)] px-[calc(var(--spacing,0.25rem)*2)] text-start align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pe-0 [&:has([data-slot=checkbox])]:pe-0", className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: CellProps) {
  return (
    <CellPrimitive
      data-slot="table-cell"
      className={cn("p-[calc(var(--spacing,0.25rem)*2)] align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0 [&:has([data-slot=checkbox])]:pe-0", className)}
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
      className={cn("text-(--muted-foreground) mt-[calc(var(--spacing,0.25rem)*4)] text-(length:--text-sm) text-center", className)}
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
