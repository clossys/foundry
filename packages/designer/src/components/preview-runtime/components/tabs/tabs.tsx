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
        "gap-[calc(var(--spacing,0.25rem)*2)] group/tabs flex data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rounded-(--radius) p-[calc(var(--spacing,0.25rem)*1)] group-data-horizontal/tabs:h-[calc(var(--spacing,0.25rem)*8)] data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-(--muted-foreground) group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-(--muted)",
        line: "gap-[calc(var(--spacing,0.25rem)*1)] bg-transparent",
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
        "gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) border border-transparent px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) font-medium group-data-[variant=default]/tabs-list:data-active:shadow-(--shadow-sm) group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*1)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*1)] group-data-[variant=default]/tabs-list:data-selected:shadow-(--shadow-sm) group-data-[variant=line]/tabs-list:data-selected:shadow-none relative inline-flex h-[calc(100%-1px)] flex-1 cursor-default items-center justify-center whitespace-nowrap text-(--foreground)/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-(--foreground) focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) focus-visible:outline-(--ring) disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-(--muted-foreground) dark:hover:text-(--foreground) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-selected:bg-transparent dark:group-data-[variant=line]/tabs-list:data-selected:border-transparent dark:group-data-[variant=line]/tabs-list:data-selected:bg-transparent",
        "data-selected:bg-(--background) data-selected:text-(--foreground) dark:data-selected:border-(--input) dark:data-selected:bg-(--input)/30 dark:data-selected:text-(--foreground)",
        "after:absolute after:bg-(--foreground) after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[calc(calc(var(--spacing,0.25rem)*1)*-1)] group-data-horizontal/tabs:after:h-[calc(var(--spacing,0.25rem)*1)] group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-end-[calc(var(--spacing,0.25rem)*1)] group-data-vertical/tabs:after:w-[calc(var(--spacing,0.25rem)*1)] group-data-[variant=line]/tabs-list:data-selected:after:opacity-100",
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
      className={cn("text-(length:--text-sm) flex-1 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
