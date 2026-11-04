"use client"

import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { MessageSquareIcon, SparklesIcon } from "lucide-react"
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
  Sidebar, SidebarSheet, SidebarContent, SidebarGroupLabel, SidebarHeader,
} from "@clossys/designer-ui"

/** The chat panel's words (Writer copy): its title, the empty state, and each mobile sheet's title and description. */
export interface ChatCopy {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  sheets: Record<"left" | "chat", { title: string; description: string }>;
}

/** sidebar-15 right-side slots, bound to Studio's existing unconnected chat state. */
export function ChatContent({ copy }: { copy: ChatCopy }) {
  return <>
    <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
      <SidebarGroupLabel><SparklesIcon />{copy.title}</SidebarGroupLabel>
    </SidebarHeader>
    <SidebarContent>
      <Empty data-chat-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
          <EmptyTitle>{copy.emptyTitle}</EmptyTitle>
          <EmptyDescription>{copy.emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SidebarContent>
  </>
}

export function StockChatSidebar({ copy }: { copy: ChatCopy }) {
  return <Sidebar collapsible="none" className="sticky top-0 hidden h-svh border-l md:flex"
    style={{ "--sidebar-width": "100%" } as CSSProperties} aria-label={copy.title} data-panel="chat">
    <ChatContent copy={copy} />
  </Sidebar>
}

/** The Designer's stock Sidebar mobile Sheet, for the navigation or the chat. */
export function StockSidebarSheet({ panel, copy, children, ...props }: Pick<ComponentProps<typeof SidebarSheet>, "isOpen" | "onOpenChange"> & {
  panel: "left" | "chat";
  copy: ChatCopy;
  children: ReactNode;
}) {
  return <SidebarSheet {...props} side={panel === "left" ? "left" : "right"} data-panel={panel}
    title={copy.sheets[panel].title} description={copy.sheets[panel].description}>
    {children}
  </SidebarSheet>
}
