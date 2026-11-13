"use client"

import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
  SidebarContent, SidebarGroupLabel, SidebarHeader,
} from "@clossys/designer-ui"

/** The chat panel's words (Writer copy): its title and the empty state. */
export interface ChatCopy {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
}

/** sidebar-15 right-side slots, bound to Studio's existing unconnected chat state; the page supplies the glyphs. */
export function ChatContent({ copy, icon, emptyIcon }: { copy: ChatCopy; icon?: React.ReactNode; emptyIcon?: React.ReactNode }) {
  return <>
    <SidebarHeader>
      <SidebarGroupLabel>{icon}{copy.title}</SidebarGroupLabel>
    </SidebarHeader>
    <SidebarContent>
      <Empty data-chat-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia>
          <EmptyTitle>{copy.emptyTitle}</EmptyTitle>
          <EmptyDescription>{copy.emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SidebarContent>
  </>
}
