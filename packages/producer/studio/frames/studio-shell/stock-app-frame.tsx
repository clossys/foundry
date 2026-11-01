"use client"

import type { ComponentProps, ReactNode } from "react"
import { SidebarProvider } from "@clossys/designer-ui"

export type StockAppFrameProps = ComponentProps<typeof SidebarProvider> & {
  navigation: ReactNode
  children: ReactNode
}

export default function StockAppFrame({ navigation, children, ...providerProps }: StockAppFrameProps) {
  return (
    <SidebarProvider {...providerProps}>
      {navigation}
      {children}
    </SidebarProvider>
  )
}
