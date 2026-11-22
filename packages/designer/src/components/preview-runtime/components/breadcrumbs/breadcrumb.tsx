"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn } from "../_parts/utils/index.js"
import {
  Breadcrumb as BreadcrumbPrimitive,
  Breadcrumbs as BreadcrumbsPrimitive,
  composeRenderProps,
  Link as LinkPrimitive,
  type BreadcrumbProps,
  type BreadcrumbsProps,
  type LinkProps,
} from "react-aria-components"

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn("", className)}
      {...props}
    />
  )
}

function BreadcrumbList<T extends object>({
  className,
  ...props
}: BreadcrumbsProps<T>) {
  return (
    <BreadcrumbsPrimitive
      data-slot="breadcrumb-list"
      className={cn(
        "text-(--muted-foreground) gap-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) flex flex-wrap items-center wrap-break-word",
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({
  className,
  children,
  separatorClassName,
  ...props
}: BreadcrumbProps & { separatorClassName?: string }) {
  return (
    <BreadcrumbPrimitive
      data-slot="breadcrumb-item"
      className={cn("gap-[calc(var(--spacing,0.25rem)*1)] inline-flex items-center", className)}
      {...props}
    >
      {composeRenderProps(children, (children, { isCurrent }) => (
        <>
          {children}
          {!isCurrent && (
            <span
              data-slot="breadcrumb-separator"
              role="presentation"
              aria-hidden="true"
              className={cn("[&>svg]:size-[calc(var(--spacing,0.25rem)*3.5)]", separatorClassName)}
            >
              <LibraryIcon asset="assets.icon-chevron-right" decorative className="" />
            </span>
          )}
        </>
      ))}
    </BreadcrumbPrimitive>
  )
}

function BreadcrumbLink({ className, render, ...props }: LinkProps) {
  return (
    <LinkPrimitive
      data-slot="breadcrumb-link"
      className={cn("hover:text-(--foreground) transition-colors", className)}
      render={render}
      {...props}
    />
  )
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("text-(--foreground) font-normal", className)}
      {...props}
    />
  )
}

function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "size-[calc(var(--spacing,0.25rem)*6)] [&>svg]:size-[calc(var(--spacing,0.25rem)*4)] flex items-center justify-center",
        className
      )}
      {...props}
    >
      <LibraryIcon asset="assets.icon-chevron-down" decorative />
      <span className="sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbEllipsis,
}
