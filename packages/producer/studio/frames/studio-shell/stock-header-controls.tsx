"use client"

import { Button, Popover, PopoverTrigger, Tooltip, TooltipTrigger } from "@clossys/designer-ui"

/** A stock tooltip naming the header control it wraps. */
export function HeaderTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return <TooltipTrigger>
    {children}
    <Tooltip>{label}</Tooltip>
  </TooltipTrigger>
}

/** One stock ghost icon button with its tooltip. */
export function HeaderIconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return <HeaderTooltip label={label}>
    <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>{children}</Button>
  </HeaderTooltip>
}

/** One actual stock icon button anchors both overlays: its tooltip and its popover. */
export function HeaderPopover({ id, label, shortcut, open, onOpenChange, content, children }: {
  id: string
  label: string
  shortcut?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  content: React.ReactNode
  children: React.ReactNode
}) {
  return <PopoverTrigger isOpen={open} onOpenChange={onOpenChange}>
    <HeaderTooltip label={shortcut ? `${label} (${shortcut.toUpperCase()})` : label}>
      <Button variant={open ? "secondary" : "ghost"} size="icon-sm" aria-label={label} aria-haspopup="dialog" aria-keyshortcuts={shortcut} data-popover-trigger={id}>{children}</Button>
    </HeaderTooltip>
    <Popover placement="bottom end" aria-label={label} data-popover={id}>{content}</Popover>
  </PopoverTrigger>
}
