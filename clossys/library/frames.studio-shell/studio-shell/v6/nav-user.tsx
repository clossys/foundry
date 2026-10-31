"use client"

import { ChevronsUpDownIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@clossys/designer-ui"

/**
 * shadcn sidebar-07 `NavUser`. Studio runs on this machine with no account, so the user is the local
 * workspace with initials and no avatar image. The block's menu items (Upgrade, Account, Billing,
 * Notifications, Log out) are left out: Studio has none of those actions yet (NEED).
 */
export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    initials: string
  }
}) {
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuTrigger>
          <SidebarMenuButton size="lg" className="aria-expanded:bg-muted">
            <Avatar>
              <AvatarFallback>{user.initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </SidebarMenuButton>
          <DropdownMenu
            className="w-fit"
            placement={isMobile ? "bottom end" : "right bottom"}
            offset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    <AvatarFallback>{user.initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </DropdownMenu>
        </DropdownMenuTrigger>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
