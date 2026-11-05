"use client"

import * as React from "react"
import type { ContentMapNavigation, ContentMapNavigationNode as NavNode } from "@clossys/publisher/content-map"

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

/** sidebar-07's sample avatar image; Producer serves every `/avatars/*` image as the workspace placeholder. */
const placeholderAvatar = { src: "/avatars/shadcn.jpg" }

/** The consumer's mark served for one ground (`dark` = a light mark for a dark ground). */
function BrandMark({ ground }: { ground: "light" | "dark" }) {
  return <img data-brand-mark={ground} src={`/api/brand/mark.svg?ground=${ground}`} alt="" width={16} height={16} />
}

/** The sidebar's words (Writer copy): the workspace team, its plan line, and the local user. */
export interface SidebarCopy {
  team: string;
  /** The plan line when the consumer brand names the workspace, and when it does not. */
  plan: string;
  localPlan: string;
  user: { name: string; email: string; initials: string };
}

/**
 * The left sidebar: shadcn sidebar-15's `SidebarLeft` (off-canvas, full height, toggled from the
 * header) holding the N1 navigation, shadcn sidebar-07 `AppSidebar` content. Its sample data is
 * replaced by Studio's: the consumer brand as the one team, the Studio map's navigation tree as
 * one `NavMain` per system (the map's root groups), the local workspace as the user. The block's
 * `NavProjects` group is left out: the Studio map has no projects.
 */
export function AppSidebar({
  navigation,
  copy,
  ...props
}: React.ComponentProps<typeof Sidebar> & { navigation: ContentMapNavigation; copy: SidebarCopy }) {
  const { brand } = useStudioData()
  const { resolved } = useThemeMode()
  const name = brand.state === "ready" ? brand.value.name : undefined
  const item = (node: NavNode) => {
    const Icon = studioIcon(node.icon)
    return { title: node.label, url: node.href, icon: <Icon />, isActive: navigation.activeId === node.id }
  }
  const group = (node: NavNode) => {
    const items = (node.children ?? []).flatMap((child) => (child.href ? [{ title: child.label, url: child.href, isActive: navigation.activeId === child.id }] : []))
    return items.length ? [{ ...item(node), items }] : []
  }
  const data = {
    user: {
      name: copy.user.name,
      email: copy.user.email,
      avatar: placeholderAvatar.src,
      initials: copy.user.initials,
    },
    teams: [
      {
        name: copy.team,
        // The logo sits on `--sidebar-primary`, the menu item's logo on the menu ground.
        logo: <BrandMark ground={resolved === "dark" ? "light" : "dark"} />,
        itemLogo: <BrandMark ground={resolved === "dark" ? "dark" : "light"} />,
        plan: name ? copy.plan : copy.localPlan,
      },
    ],
    // The map's root pages (Home: a projected href) sit in one unlabeled NavMain; each root group (a
    // system: no href) is one NavMain labeled with its name, its pages as menu buttons and its child
    // groups (the agents: projected children) as the block's collapsible items.
    pages: navigation.tree.flatMap((node) => (node.href ? [item(node)] : [])),
    systems: navigation.tree.flatMap((node) =>
      node.href ? [] : [{ id: node.id, label: node.label, items: (node.children ?? []).flatMap((child) => (child.children?.length ? group(child) : child.href ? [item(child)] : [])) }]
    ),
  }
  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.pages} />
        {data.systems.map((system) => (
          <NavMain key={system.id} label={system.label} items={system.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      {props.collapsible !== "none" && <SidebarRail />}
    </Sidebar>
  )
}
