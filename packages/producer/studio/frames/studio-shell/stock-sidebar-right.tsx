import * as React from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@clossys/designer-ui"
import { PlusIcon } from "lucide-react"

export function SidebarRight({ header, children, footer, ...props }: React.ComponentProps<typeof Sidebar> & { header: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Sidebar
      side="right" collapsible="offcanvas"
      className="sticky top-0 h-svh border-l"
      {...props}
    >
      <SidebarHeader className="h-16 border-b border-sidebar-border">{header}</SidebarHeader>
      <SidebarContent>{children}</SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
    </Sidebar>
  )
}
