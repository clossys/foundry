"use client"

import { ChevronRightIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@clossys/designer-ui"

/**
 * shadcn sidebar-07 `NavMain`, fed from the Studio map. A map page without children (Home) is the
 * block's menu button without the collapsible; a map group (an agent) is the block's collapsible
 * item. `label` is the block's "Platform" group label, given only for the map's group rows.
 */
export function NavMain({
  label,
  items,
}: {
  label?: string
  items: {
    title: string
    url?: string
    icon?: React.ReactNode
    isActive?: boolean
    items?: {
      title: string
      url: string
      isActive?: boolean
    }[]
  }[]
}) {
  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarMenu>
        {items.map((item) =>
          item.items?.length ? (
            <Collapsible
              key={item.title}
              defaultExpanded
              className="group/collapsible"
              render={(props) => <SidebarMenuItem {...props} />}
            >
              <SidebarMenuButton slot="trigger" tooltip={item.title}>
                {item.icon}
                <span>{item.title}</span>
                <ChevronRightIcon />
              </SidebarMenuButton>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton href={subItem.url} isActive={subItem.isActive}>
                        <span>{subItem.title}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton href={item.url} tooltip={item.title} isActive={item.isActive}>
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
