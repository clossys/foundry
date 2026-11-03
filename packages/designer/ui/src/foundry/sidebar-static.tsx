"use client"

import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { cn } from "../lib/utils"
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "./sheet"
import { useSidebar } from "./sidebar"

// Foundry sidebar extensions (not a shadcn slot). Both are lifted unchanged from the stock
// aria-nova ../components/ui/sidebar.tsx: the SidebarMenuButton base/default/lg classes, and the
// Sidebar mobile branch's Sheet and inner column. Neither adds styling of its own.

// Exact SidebarMenuButton base/default/lg presentation from stock aria-nova.
const stockRowBase = "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-expanded:hover:bg-sidebar-accent aria-expanded:hover:text-sidebar-accent-foreground data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate"
const stockRowDefault = "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
const stockRowLarge = "h-12 text-sm group-data-[collapsible=icon]:p-0!"

/** A non-interactive sidebar row with every stock SidebarMenuButton (size lg) class: no button, ref or press handler. */
function SidebarStaticRow({ children, className }: { children: ReactNode; className?: string }) {
  useSidebar()
  return <div data-slot="sidebar-menu-button" data-sidebar="menu-button" data-size="lg" data-active={false}
    className={cn(stockRowBase, stockRowDefault, stockRowLarge, className)}>{children}</div>
}

/** The stock Sidebar mobile Sheet (width, slots, sr-only header and column) for either edge of the page. */
function SidebarSheet({ side, title, description, children, ...props }: Pick<ComponentProps<typeof Sheet>, "isOpen" | "onOpenChange"> & {
  side: "left" | "right"
  title: string
  description: string
  children: ReactNode
  "data-panel"?: string
}) {
  return <Sheet {...props} side={side} data-sidebar="sidebar" data-slot="sidebar" data-mobile="true"
    className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
    style={{ "--sidebar-width": "18rem" } as CSSProperties}>
    <SheetHeader className="sr-only"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>
    <div className="flex h-full w-full flex-col">{children}</div>
  </Sheet>
}

export { SidebarSheet, SidebarStaticRow }
