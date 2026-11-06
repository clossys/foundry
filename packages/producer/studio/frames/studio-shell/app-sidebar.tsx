"use client"

import { NavMain, type NavMainItem } from "./nav-main"
import { NavUser, type ShellUser } from "./nav-user"
import { TeamSwitcher, type ShellTeam } from "./team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@clossys/designer-ui"

/** The left sidebar's data: the map's root pages, one group per system, the workspace and the user. */
export interface ShellNavigation {
  pages: readonly NavMainItem[]
  systems: readonly { id: string; label: string; items: readonly NavMainItem[] }[]
  team?: ShellTeam
  user: ShellUser
  chevron?: React.ReactNode
}

/**
 * The left sidebar: shadcn sidebar-15's `SidebarLeft` (off-canvas, full height, toggled from the
 * header) holding the N1 navigation, shadcn sidebar-07 `AppSidebar` content. Its sample data is
 * replaced by Studio's: the consumer brand as the one team, the Studio map's navigation tree as
 * one `NavMain` per system (the map's root groups), the local workspace as the user. The block's
 * `NavProjects` group is left out: the Studio map has no projects.
 */
export function AppSidebar({ navigation, ...props }: React.ComponentProps<typeof Sidebar> & { navigation: ShellNavigation }) {
  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <TeamSwitcher team={navigation.team} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navigation.pages} chevron={navigation.chevron} />
        {navigation.systems.map((system) => (
          <NavMain key={system.id} label={system.label} items={system.items} chevron={navigation.chevron} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={navigation.user} />
      </SidebarFooter>
      {props.collapsible !== "none" && <SidebarRail />}
    </Sidebar>
  )
}

/** The sidebar's words (Writer copy): the workspace team, its plan line, and the local user. The page resolves them into `ShellNavigation`. */
export interface SidebarCopy {
  team: string
  /** The plan line when the consumer brand names the workspace, and when it does not. */
  plan: string
  localPlan: string
  user: { name: string; email: string; initials: string }
}
