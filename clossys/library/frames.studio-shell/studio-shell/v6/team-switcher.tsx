"use client"

import * as React from "react"
import { ChevronsUpDownIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@clossys/designer-ui"

/**
 * shadcn sidebar-07 `TeamSwitcher`. Studio has one workspace (the consumer brand), so the menu lists
 * that one team. The block's "Teams" label, `⌘N` shortcuts and "Add team" item are left out: Studio
 * has no other workspace to switch to or add (NEED).
 */
export function TeamSwitcher({
  teams,
}: {
  teams: {
    name: string
    logo: React.ReactNode
    itemLogo: React.ReactNode
    plan: string
  }[]
}) {
  const { isMobile } = useSidebar()
  const [activeTeam, setActiveTeam] = React.useState(0)
  const team = teams[activeTeam] ?? teams[0]
  if (!team) {
    return null
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuTrigger>
          <SidebarMenuButton
            size="lg"
            className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              {team.logo}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{team.name}</span>
              <span className="truncate text-xs">{team.plan}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </SidebarMenuButton>
          <DropdownMenu
            className="w-fit"
            placement={isMobile ? "bottom start" : "right top"}
            offset={4}
          >
            <DropdownMenuGroup>
              {teams.map((item, index) => (
                <DropdownMenuItem
                  key={item.name}
                  onAction={() => setActiveTeam(index)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {item.itemLogo}
                  </div>
                  {item.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenu>
        </DropdownMenuTrigger>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
