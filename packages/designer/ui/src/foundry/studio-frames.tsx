"use client"

import type { ComponentProps, ReactNode } from "react"

import { SidebarInset, SidebarProvider } from "./sidebar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/radix/resizable"

/** The navigation region of the adopted shadcn sidebar-15 block. */
export interface StudioAppFrameProps {
  navigation: ReactNode
  children: ReactNode
  open: boolean
  onOpenChange: ComponentProps<typeof SidebarProvider>["onOpenChange"]
}

/** App chrome owns the left sidebar; the composed page owns all other regions. */
export function StudioAppFrame({ navigation, children, open, onOpenChange }: StudioAppFrameProps) {
  return <SidebarProvider open={open} onOpenChange={onOpenChange} className="h-svh overflow-hidden">
    {navigation}
    {children}
  </SidebarProvider>
}

export interface StudioPageFrameProps {
  header: ReactNode
  chat: ReactNode
  chatOpen: boolean
  chatResizeLabel: string
  chatSheet?: ReactNode
  body?: "plain" | "detail"
  head?: ReactNode
  children?: ReactNode
}

/**
 * The page regions of sidebar-15: its header and body inset plus the right chat.
 * Existing stock resizable geometry and Studio body bindings are preserved.
 */
export function StudioPageFrame({ header, chat, chatOpen, chatResizeLabel, chatSheet, body = "plain", head, children }: StudioPageFrameProps) {
  return <>
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
      <ResizablePanel id="studio-page">
        <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
          <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background">
            {header}
          </header>
          <div id="studio-main" data-body={body} className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-6 *:shrink-0">
            {head}{children}
          </div>
        </SidebarInset>
      </ResizablePanel>
      {chatOpen && <>
        <ResizableHandle aria-label={chatResizeLabel} />
        <ResizablePanel id="studio-chat" defaultSize="16rem" minSize="16rem" maxSize="50%" groupResizeBehavior="preserve-pixel-size">
          {chat}
        </ResizablePanel>
      </>}
    </ResizablePanelGroup>
    {chatSheet}
  </>
}
