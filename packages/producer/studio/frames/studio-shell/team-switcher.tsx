"use client"

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, SidebarMenu, SidebarMenuItem } from "@clossys/designer-ui"

/** The one workspace row's data: its name, plan line and mark. */
export interface ShellTeam { name: string; plan: string; logo?: React.ReactNode }

/**
 * sidebar-07 workspace row; Studio supplies one workspace, so no switch menu is rendered. The
 * block's logo tile and two-line label are the stock Item image media, title and description, on a static stock Item (no button, ref or press handler).
 */
export function TeamSwitcher({ team }: { team?: ShellTeam }) {
  if (!team) return null
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Item size="sm" data-sidebar-static-row="team">
          <ItemMedia variant="image">{team.logo}</ItemMedia>
          <ItemContent>
            <ItemTitle>{team.name}</ItemTitle>
            <ItemDescription>{team.plan}</ItemDescription>
          </ItemContent>
        </Item>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
