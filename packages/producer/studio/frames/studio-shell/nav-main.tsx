"use client"

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

/** One sidebar-07 `NavMain` row: a page (menu button) or a group (collapsible with its sub pages). */
export interface NavMainItem {
  id: string
  title: string
  url?: string
  icon?: React.ReactNode
  isActive?: boolean
  items?: { id: string; title: string; url: string; isActive?: boolean }[]
}

/**
 * shadcn sidebar-07 `NavMain`, fed from the Studio map. A map page without children (Home) is the
 * block's menu button without the collapsible; a map group (an agent) is the block's collapsible
 * item. `label` is the block's "Platform" group label, given only for the map's group rows.
 * `chevron` is the block's collapsible indicator glyph, supplied by the page.
 */
export function NavMain({ label, items, chevron }: { label?: string; items: readonly NavMainItem[]; chevron?: React.ReactNode }) {
  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarMenu>
        {items.map((item) =>
          item.items?.length ? (
            <Collapsible
              key={item.id}
              defaultExpanded
              className="group/collapsible"
              render={(props) => <SidebarMenuItem {...props} />}
            >
              <SidebarMenuButton slot="trigger" tooltip={item.title}>
                {item.icon}
                <span>{item.title}</span>
                {chevron}
              </SidebarMenuButton>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.id}>
                      <SidebarMenuSubButton href={subItem.url} isActive={subItem.isActive}>
                        <span>{subItem.title}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.id}>
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
