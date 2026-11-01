"use client"

import type { ReactNode } from "react"
import { cn } from "cn"
import { useSidebar } from "@clossys/designer-ui"

// Exact SidebarMenuButton base/default/lg presentation from stock aria-nova.
// Static rows have no button ref or press handlers; the native context guard is retained.
const stockRowBase = "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-expanded:hover:bg-sidebar-accent aria-expanded:hover:text-sidebar-accent-foreground data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate"
const stockRowDefault = "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
const stockRowLarge = "h-12 text-sm group-data-[collapsible=icon]:p-0!"

/** sidebar-07's approved single-option transformation retains all stock row classes. */
export function StaticSidebarRow({ children, className }: { children: ReactNode; className?: string }) {
  useSidebar()
  return <div data-slot="sidebar-menu-button" data-sidebar="menu-button" data-size="lg" data-active={false}
    className={cn(stockRowBase, stockRowDefault, stockRowLarge, className)}>{children}</div>
}
