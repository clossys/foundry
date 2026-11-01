"use client"

import type { ReactNode } from "react"
import { SidebarMenu, SidebarMenuItem } from "@clossys/designer-ui"
import { StaticSidebarRow } from "./stock-static-nav-rows"

/** sidebar-07 workspace row; Studio supplies one workspace, so no switch menu is rendered. */
export function TeamSwitcher({
  teams,
}: {
  teams: {
    name: string
    logo: ReactNode
    itemLogo: ReactNode
    plan: string
  }[]
}) {
  const team = teams[0]
  if (!team) {
    return null
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <StaticSidebarRow
          className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            {team.logo}
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{team.name}</span>
            <span className="truncate text-xs">{team.plan}</span>
          </div>
        </StaticSidebarRow>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
