"use client"

import * as React from "react"
import type { ContentMapNavigation } from "@clossys/publisher/content-map"

import { NavMain } from "./nav-main"
import { NavUser } from "./nav-user"
import { TeamSwitcher } from "./team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@clossys/designer-ui"
import { studioIcon } from "../../lib/studio-icons"
import { useStudioData, useThemeMode } from "../../components/StudioProviders"

/** The consumer's mark served for one ground (`dark` = a light mark for a dark ground). */
function BrandMark({ ground }: { ground: "light" | "dark" }) {
  return <img data-brand-mark={ground} src={`/api/brand/mark.svg?ground=${ground}`} alt="" width={16} height={16} />
}

/**
 * shadcn sidebar-07 `AppSidebar`. Its sample data is replaced by Studio's: the consumer brand as the
 * one team, the Studio map's navigation tree as `navMain`, the local workspace as the user. The
 * block's `NavProjects` group is left out: the Studio map has no projects.
 */
export function AppSidebar({
  navigation,
  ...props
}: React.ComponentProps<typeof Sidebar> & { navigation: ContentMapNavigation }) {
  const { brand } = useStudioData()
  const { resolved } = useThemeMode()
  const name = brand.state === "ready" ? brand.value.name : undefined
  const data = {
    user: {
      name: "Local workspace",
      email: "Producer on this machine",
      initials: "LW",
    },
    teams: [
      {
        name: name ?? "Studio",
        // The logo sits on `--sidebar-primary`, the menu item's logo on the menu ground.
        logo: <BrandMark ground={resolved === "dark" ? "light" : "dark"} />,
        itemLogo: <BrandMark ground={resolved === "dark" ? "dark" : "light"} />,
        plan: name ? "Studio" : "Local workspace",
      },
    ],
    navMain: navigation.tree.flatMap((node) => {
      const Icon = studioIcon(node.icon, node.id)
      const items = (node.children ?? []).flatMap((child) =>
        child.href ? [{ title: child.label, url: child.href, isActive: navigation.activeId === child.id }] : []
      )
      if (!items.length && !node.href) return []
      return [{ title: node.label, url: node.href, icon: <Icon />, isActive: navigation.activeId === node.id, items }]
    }),
  }
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
