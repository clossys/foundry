"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { SiteCopyMap } from "./site-copy";
import type { SiteFrameFacts } from "./site-frame";

/**
 * Carries what a client error boundary needs: the copy and the two brand
 * facts its frame shows. The root layout resolves them on the server and
 * provides them here, because a boundary receives no props from the server
 * and cannot resolve copy itself (Writer's root is Node-only).
 */
const SiteCopyContext = createContext<{ copy: SiteCopyMap; facts: SiteFrameFacts } | undefined>(undefined);

export function SiteCopyProvider({ copy, facts, children }: { copy: SiteCopyMap; facts: SiteFrameFacts; children: ReactNode }) {
  return <SiteCopyContext.Provider value={{ copy, facts }}>{children}</SiteCopyContext.Provider>;
}

function useSiteContext() {
  const value = useContext(SiteCopyContext);
  if (value === undefined) throw new Error("SiteCopyProvider is missing above this component.");
  return value;
}

export function useSiteCopy(): SiteCopyMap {
  return useSiteContext().copy;
}

export function useSiteFrameFacts(): SiteFrameFacts {
  return useSiteContext().facts;
}
