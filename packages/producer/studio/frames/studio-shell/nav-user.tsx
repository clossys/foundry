"use client"

import { Avatar, AvatarFallback, AvatarImage, Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, SidebarMenu, SidebarMenuItem } from "@clossys/designer-ui"

/** The local user row's data. */
export interface ShellUser { name: string; email: string; avatar?: string; initials: string }

/** sidebar-07's sample avatar image; Producer serves every `/avatars/*` image as the workspace placeholder. */
const SAMPLE_AVATAR = "/avatars/shadcn.jpg"

/** sidebar-07 profile row on a static stock Item; the existing local workspace has no account menu. */
export function NavUser({ user }: { user: ShellUser }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Item size="sm" data-sidebar-static-row="user">
          <ItemMedia>
            <Avatar>
              <AvatarImage src={user.avatar ?? SAMPLE_AVATAR} alt={user.name} />
              <AvatarFallback>{user.initials}</AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{user.name}</ItemTitle>
            <ItemDescription>{user.email}</ItemDescription>
          </ItemContent>
        </Item>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
