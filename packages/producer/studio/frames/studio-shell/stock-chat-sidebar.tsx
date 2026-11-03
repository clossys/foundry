"use client"

import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { MessageSquareIcon, SparklesIcon } from "lucide-react"
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
  Sidebar, SidebarSheet, SidebarContent, SidebarGroupLabel, SidebarHeader,
} from "@clossys/designer-ui"

/** sidebar-15 right-side slots, bound to Studio's existing unconnected chat state. */
export function ChatContent() {
  return <>
    <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
      <SidebarGroupLabel><SparklesIcon />Chat</SidebarGroupLabel>
    </SidebarHeader>
    <SidebarContent>
      <Empty data-chat-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
          <EmptyTitle>No conversation yet</EmptyTitle>
          <EmptyDescription>Chat with Director, Designer, Writer and Publisher will open here. Agents work through the CLI for now.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SidebarContent>
  </>
}

export function StockChatSidebar() {
  return <Sidebar collapsible="none" className="sticky top-0 hidden h-svh border-l md:flex"
    style={{ "--sidebar-width": "100%" } as CSSProperties} aria-label="Chat" data-panel="chat">
    <ChatContent />
  </Sidebar>
}

/** The Designer's stock Sidebar mobile Sheet, for the navigation or the chat. */
export function StockSidebarSheet({ panel, children, ...props }: Pick<ComponentProps<typeof SidebarSheet>, "isOpen" | "onOpenChange"> & {
  panel: "left" | "chat";
  children: ReactNode;
}) {
  return <SidebarSheet {...props} side={panel === "left" ? "left" : "right"} data-panel={panel}
    title={panel === "left" ? "Sidebar" : "Chat"} description={panel === "left" ? "Displays the mobile sidebar." : "Ask an agent about the open page."}>
    {children}
  </SidebarSheet>
}
