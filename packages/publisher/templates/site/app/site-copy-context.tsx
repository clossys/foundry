"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { SiteCopyMap } from "./site-copy";

/**
 * Carries the copy a client error boundary needs. The root layout resolves it
 * on the server and provides it here, because a boundary receives no props
 * from the server and cannot resolve copy itself (Writer's root is Node-only).
 */
const SiteCopyContext = createContext<SiteCopyMap | undefined>(undefined);

export function SiteCopyProvider({ copy, children }: { copy: SiteCopyMap; children: ReactNode }) {
  return <SiteCopyContext.Provider value={copy}>{children}</SiteCopyContext.Provider>;
}

export function useSiteCopy(): SiteCopyMap {
  const copy = useContext(SiteCopyContext);
  if (copy === undefined) throw new Error("SiteCopyProvider is missing above this component.");
  return copy;
}
