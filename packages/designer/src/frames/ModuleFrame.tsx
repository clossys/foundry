"use client";

import type { ReactNode } from "react";
import { Disclosure, SemanticContent } from "../components/index.js";

export interface ModuleFrameProps {
  /** Stable manifest section identifier. */
  id: string;
  label: string;
  children: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

/** A section slot whose selected disclosure owns its keyboard and collapse behavior. */
export function ModuleFrame({ id, label, children, expanded, defaultExpanded = true, onExpandedChange }: ModuleFrameProps) {
  return <SemanticContent as="section" data-module-id={id} aria-label={label} className="min-w-0 rounded-control border border-line-base bg-surface-base p-md">
    <Disclosure title={label} isExpanded={expanded} defaultExpanded={defaultExpanded} onExpandedChange={onExpandedChange}
      className="min-w-0" triggerClassName="text-ink-primary" panelClassName="text-ink-secondary">
      {children}
    </Disclosure>
  </SemanticContent>;
}
