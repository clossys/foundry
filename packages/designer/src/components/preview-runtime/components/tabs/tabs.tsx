"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"
import {
  TabList as TabListPrimitive,
  TabPanel as TabPanelPrimitive,
  Tab as TabPrimitive,
  Tabs as TabsPrimitive,
} from "react-aria-components"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive>) {
  return (
    <TabsPrimitive
      data-slot="tabs"
      className={cn(
        "gap-(--spacing-sm) group/tabs flex data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rounded-(--radius-control) p-(--spacing-xs) group-data-horizontal/tabs:h-(--spacing-2xl,calc(var(--spacing)*8)) data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-(--color-ink-muted) group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-(--color-surface-sunken)",
        line: "gap-(--spacing-xs) bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabListPrimitive> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabListPrimitive
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabPrimitive>) {
  return (
    <TabPrimitive
      data-slot="tabs-trigger"
      className={cn(
        "gap-(--spacing-sm) rounded-(--radius-control) border-(length:--ui-border-hairline,1px)  px-(--spacing-sm) py-[var(--spacing-xs)] text-(length:--text-sm) font-(weight:--font-weight-medium) group-data-[variant=default]/tabs-list:data-active:shadow-(--ui-elevation-raised) group-data-[variant=line]/tabs-list:data-active:shadow-(--ui-elevation-none) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) has-data-[icon=inline-end]:pe-(--spacing-xs) has-data-[icon=inline-start]:ps-(--spacing-xs) group-data-[variant=default]/tabs-list:data-selected:shadow-(--ui-elevation-raised) group-data-[variant=line]/tabs-list:data-selected:shadow-(--ui-elevation-none) relative inline-flex h-[calc(100%-var(--ui-border-hairline))] flex-1 cursor-default items-center justify-center whitespace-nowrap text-(--color-ink-primary)/60 transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-(--color-ink-primary) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:outline-(--color-focus-ring) disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled,50%) data-[disabled]:pointer-events-none data-[disabled]:opacity-(--ui-alpha-disabled,50%) dark:text-(--color-ink-muted) dark:hover:text-(--color-ink-primary) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-selected:bg-transparent dark:group-data-[variant=line]/tabs-list:data-selected:border-transparent dark:group-data-[variant=line]/tabs-list:data-selected:bg-transparent",
        "data-selected:bg-(--color-surface-base) data-selected:text-(--color-ink-primary) dark:data-selected:border-(--color-line-strong) dark:data-selected:bg-(--color-line-strong)/30 dark:data-selected:text-(--color-ink-primary)",
        "after:absolute after:bg-(--color-ink-primary) after:opacity-0 after:transition-opacity after:duration-(--ui-duration-default) after:ease-(--default-transition-timing-function) group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[calc(var(--spacing-xs)*-1)] group-data-horizontal/tabs:after:h-[var(--spacing-xs)] group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-end-(--spacing-xs) group-data-vertical/tabs:after:w-[var(--spacing-xs)] group-data-[variant=line]/tabs-list:data-selected:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabPanelPrimitive>) {
  return (
    <TabPanelPrimitive
      data-slot="tabs-content"
      className={cn("text-(length:--text-sm) flex-1 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
