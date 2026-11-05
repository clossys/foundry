"use client"

import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { MessageSquareIcon, SparklesIcon } from "lucide-react"
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
  Sheet, SheetDescription, SheetHeader, SheetTitle,
  Sidebar, SidebarContent, SidebarGroupLabel, SidebarHeader,
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

/** The same native Sheet width and content slots as Sidebar's mobile branch. */
export function StockSidebarSheet({ panel, children, ...props }: Pick<ComponentProps<typeof Sheet>, "isOpen" | "onOpenChange"> & {
  panel: "left" | "chat";
  children: ReactNode;
}) {
  return <Sheet {...props} side={panel === "left" ? "left" : "right"} data-sidebar="sidebar" data-slot="sidebar" data-mobile="true" data-panel={panel}
    className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
    style={{ "--sidebar-width": "18rem" } as CSSProperties}>
    <SheetHeader className="sr-only"><SheetTitle>{panel === "left" ? "Sidebar" : "Chat"}</SheetTitle><SheetDescription>{panel === "left" ? "Displays the mobile sidebar." : "Ask an agent about the open page."}</SheetDescription></SheetHeader>
    <div className="flex h-full w-full flex-col">{children}</div>
  </Sheet>
}
