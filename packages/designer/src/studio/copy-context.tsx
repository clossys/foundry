"use client";
import { createContext, useContext, type ReactNode } from "react";
import { studioCopyNeed, type StudioCopyBinding } from "./copy-binding.js";

const StudioCopyContext = createContext<StudioCopyBinding | undefined>(undefined);
export function StudioCopyProvider({ binding, children }: { readonly binding: StudioCopyBinding; readonly children: ReactNode }) {
  return <StudioCopyContext.Provider value={binding}>{children}</StudioCopyContext.Provider>;
}
export function useStudioCopy(): StudioCopyBinding { return useContext(StudioCopyContext) ?? studioCopyNeed("studio.copy.provider"); }
