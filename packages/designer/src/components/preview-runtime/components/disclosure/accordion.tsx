"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn } from "../_parts/utils/index.js"
import {
  DisclosurePanel as AccordionContentPrimitive,
  Heading as AccordionHeaderPrimitive,
  Disclosure as AccordionItemPrimitive,
  DisclosureGroup as AccordionPrimitive,
  Button as AccordionTriggerPrimitive,
  type ButtonProps,
  type DisclosureGroupProps,
  type DisclosurePanelProps,
  type DisclosureProps,
} from "react-aria-components"

function Accordion({ className, ...props }: DisclosureGroupProps) {
  return (
    <AccordionPrimitive
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: DisclosureProps) {
  return (
    <AccordionItemPrimitive
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: Omit<ButtonProps, "children"> & { children: React.ReactNode }) {
  return (
    <AccordionHeaderPrimitive className="flex">
      <AccordionTriggerPrimitive
        slot="trigger"
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) focus-visible:border-(--ring) focus-visible:after:border-(--ring) **:data-[slot=accordion-trigger-icon]:text-(--muted-foreground) rounded-(--radius) py-[calc(var(--spacing,0.25rem)*3)] text-start text-(length:--text-sm) font-medium hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) **:data-[slot=accordion-trigger-icon]:ms-auto **:data-[slot=accordion-trigger-icon]:size-[calc(var(--spacing,0.25rem)*4)] group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent transition-all disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <LibraryIcon asset="assets.icon-chevron-down" decorative data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden" />
        <LibraryIcon asset="assets.icon-chevron-up" decorative data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline" />
      </AccordionTriggerPrimitive>
    </AccordionHeaderPrimitive>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: DisclosurePanelProps) {
  return (
    <AccordionContentPrimitive
      data-slot="accordion-content"
      className="data-open:library-enter data-open:library-fade data-closed:library-exit data-closed:library-fade text-(length:--text-sm) h-(--disclosure-panel-height) overflow-clip transition-[height]"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-[calc(var(--spacing,0.25rem)*3)] [&_a]:underline [&_a]:underline-offset-[calc(var(--spacing,0.25rem)*3)] [&_a]:hover:text-(--foreground) [&_p:not(:last-child)]:mb-[calc(var(--spacing,0.25rem)*4)]",
          className
        )}
      >
        {children}
      </div>
    </AccordionContentPrimitive>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
