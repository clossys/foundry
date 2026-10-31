"use client"

import { ChevronRightIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@clossys/designer-ui"

/**
 * shadcn sidebar-07 `NavMain`, fed from the Studio map. A map page without children (Home) is the
 * block's menu button without the collapsible; a map group (Agents) is the block's collapsible item.
 * The block's "Platform" group label is left out: the map has no label for this group (NEED).
 */
export function NavMain({
  items,
}: {
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
                <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-expanded/collapsible:rotate-90" />
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
