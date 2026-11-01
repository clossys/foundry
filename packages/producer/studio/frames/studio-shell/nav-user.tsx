"use client"

import { Avatar, AvatarFallback, SidebarMenu, SidebarMenuItem } from "@clossys/designer-ui"
import { StaticSidebarRow } from "./stock-static-nav-rows"

/** sidebar-07 profile row; the existing local workspace has no account menu. */
export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    initials: string
  }
}) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <StaticSidebarRow className="aria-expanded:bg-muted">
          <Avatar>
            <AvatarFallback>{user.initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs">{user.email}</span>
          </div>
        </StaticSidebarRow>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
