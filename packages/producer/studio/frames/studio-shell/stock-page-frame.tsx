"use client"

import type { ComponentProps, ReactNode } from "react"
import { SidebarInset, ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@clossys/designer-ui"

export interface StockPageFrameProps {
  header: ReactNode
  chat: ReactNode
  chatOpen: boolean
  chatResizeLabel: string
  chatSheet?: ReactNode
  body?: "plain" | "detail"
  children?: ReactNode
  groupProps?: ComponentProps<typeof ResizablePanelGroup>
  insetProps?: ComponentProps<typeof SidebarInset>
  bodyProps?: ComponentProps<"div">
  chatPanelProps?: ComponentProps<typeof ResizablePanel>
}

export default function StockPageFrame({
  header, chat, chatOpen, chatResizeLabel, chatSheet, body = "plain", children,
  groupProps, insetProps, bodyProps: { className, ...bodyAttributes } = {}, chatPanelProps,
}: StockPageFrameProps) {
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" {...groupProps}>
        <ResizablePanel id="studio-page">
          <SidebarInset {...insetProps}>
            <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background">
              {header}
            </header>
            <div
              data-body={body}
              className={["flex flex-1 flex-col gap-4 p-4", className].filter(Boolean).join(" ")}
              {...bodyAttributes}
            >
              {children}
            </div>
          </SidebarInset>
        </ResizablePanel>
        {chatOpen && (
          <>
            <ResizableHandle aria-label={chatResizeLabel} />
            <ResizablePanel id="studio-chat" {...chatPanelProps}>
              {chat}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {chatSheet}
    </>
  )
}
