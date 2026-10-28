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
      className={cn("not-last:border-b-(length:--ui-border-hairline)", className)}
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
          "focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:border-(--color-focus-ring) focus-visible:after:border-(--color-focus-ring) **:data-[slot=accordion-trigger-icon]:text-(--color-ink-muted) rounded-(--radius-control) py-(--spacing-md) text-left text-(length:--text-sm) font-(weight:--font-weight-medium) hover:underline focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-(--spacing-lg,calc(var(--spacing)*4)) group/accordion-trigger relative flex flex-1 items-start justify-between border-(length:--ui-border-hairline,1px) transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled,50%)",
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
      className="data-open:library-enter data-open:library-fade data-closed:library-exit data-closed:library-fade text-(length:--text-sm) h-(--disclosure-panel-height) overflow-clip transition-[height] duration-(--ui-duration-default) ease-(--default-transition-timing-function)"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-(--spacing-md) [&_a]:underline [&_a]:underline-offset-(--spacing-md) [&_a]:hover:text-(--color-ink-primary) [&_p:not(:last-child)]:mb-(--spacing-lg)",
          className
        )}
      >
        {children}
      </div>
    </AccordionContentPrimitive>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
