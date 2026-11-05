"use client"

import { MessageSquareIcon, SparklesIcon } from "lucide-react"
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
  SidebarContent, SidebarGroupLabel, SidebarHeader,
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
    <SidebarHeader>
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
