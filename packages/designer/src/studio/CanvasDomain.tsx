"use client";
import type { ReactNode } from "react";

/** Domain section layouts. Wide: a rail-width vertical label beside a row of boards. Narrow: the label above a stacked list of boards. */
export const CANVAS_DOMAIN_CLASS = {
  wide: "flex items-start gap-2xl",
  narrow: "flex flex-col items-start gap-lg",
} as const;
export const CANVAS_DOMAIN_LABEL_CLASS = {
  wide: "w-[var(--ui-layout-sidebar-rail-w)] shrink-0 text-body text-ink-secondary [writing-mode:vertical-rl]",
  narrow: "text-body text-ink-secondary",
} as const;

/**
 * One canvas domain: its label and its boards. The wide label is a rail as wide
 * as the sidebar rail token, never a page-width gutter, so the first board
 * starts beside it; a narrow stage stacks the label above the boards.
 */
export function CanvasDomain({ id, label, narrow, children }: { id: string; label: string; narrow: boolean; children: ReactNode }) {
  const layout = narrow ? "narrow" : "wide";
  return <section data-studio-domain={id} data-studio-domain-layout={layout} aria-label={label} className={CANVAS_DOMAIN_CLASS[layout]}>
    <h2 data-studio-domain-label="" className={CANVAS_DOMAIN_LABEL_CLASS[layout]}>{label}</h2>
    {children}
  </section>;
}
