"use client"

import type { ComponentProps, ReactNode } from "react"
import {
  RadixButton, RadixPopover, RadixPopoverContent, RadixPopoverTrigger,
  RadixTooltip, RadixTooltipContent, RadixTooltipProvider, RadixTooltipTrigger,
} from "@clossys/designer-ui"

export function HeaderTooltip({ label, children }: { label: string; children: ReactNode }) {
  return <RadixTooltipProvider><RadixTooltip>
    <RadixTooltipTrigger asChild>{children}</RadixTooltipTrigger>
    <RadixTooltipContent>{label}</RadixTooltipContent>
  </RadixTooltip></RadixTooltipProvider>
}

/** One actual stock button anchors both overlays; no wrapper button or separate anchor. */
export function HeaderIconButton({ label, children, ...props }: ComponentProps<typeof RadixButton> & { label: string }) {
  return <HeaderTooltip label={label}>
    <RadixButton variant="ghost" size="icon-sm" aria-label={label} {...props}>{children}</RadixButton>
  </HeaderTooltip>
}

export function HeaderPopover({ label, open, onOpenChange, content, children, ...props }: Omit<ComponentProps<typeof RadixButton>, "content"> & {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  content: ReactNode
  "data-popover-trigger": string
}) {
  return <RadixPopover open={open} onOpenChange={onOpenChange}>
    <RadixTooltipProvider><RadixTooltip>
      <RadixTooltipTrigger asChild><RadixPopoverTrigger asChild>
        <RadixButton variant={open ? "secondary" : "ghost"} size="icon-sm" aria-label={label} {...props}>{children}</RadixButton>
      </RadixPopoverTrigger></RadixTooltipTrigger>
      <RadixTooltipContent>{label}{props["aria-keyshortcuts"] ? ` (${props["aria-keyshortcuts"].toUpperCase()})` : ""}</RadixTooltipContent>
    </RadixTooltip></RadixTooltipProvider>
    <RadixPopoverContent align="end" aria-label={label} data-popover={props['data-popover-trigger']}>{content}</RadixPopoverContent>
  </RadixPopover>
}
