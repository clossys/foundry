import type { ReactNode } from "react";
import { buttonLinkClassName, Icon } from "@clossys/designer/components/server";
import { ChevronRight } from "@clossys/designer/icons";
import { resolveRoleActionEmphasis } from "../../core/sectioned-view.js";
import type { SectionedViewActionEmphasis, SectionedViewContentActionEmphasis, SectionedViewGround } from "../../core/sectioned-view.js";

/** View-owned actions contain resolved copy, never copy references. */
export interface LandingViewAction {
  id: string;
  label: ReactNode;
  href: string;
  emphasis?: SectionedViewActionEmphasis;
}

/** One ladder step at the group-owned size, with a trailing chevron for quiet actions. */
export function renderAction(action: { id: string; label: ReactNode; href: string }, emphasis: SectionedViewContentActionEmphasis, ground: SectionedViewGround, size: "md" | "lg", responsivePair = false): ReactNode {
  const variant = emphasis === "secondary" ? "outline" : emphasis === "tertiary" ? "tonal" : emphasis;
  return (
    <a key={action.id} href={action.href} className={[buttonLinkClassName(variant, size, ground), responsivePair && emphasis !== "quiet" ? "w-full tablet:w-auto" : undefined].filter(Boolean).join(" ")} data-action-emphasis={emphasis}>
      {action.label}
      {emphasis === "quiet" ? <Icon glyph={ChevronRight} decorative size="md" /> : null}
    </a>
  );
}

/** Resolve original positions first, then put the primary first in DOM and focus order. */
export function renderRoleActions(actions: readonly LandingViewAction[] | undefined, ground: SectionedViewGround, centered = true, size: "md" | "lg"): ReactNode {
  if (actions === undefined) return undefined;
  const resolved = actions.map((action, index) => ({ action, emphasis: resolveRoleActionEmphasis(action.emphasis, index) }));
  resolved.sort((a, b) => Number(b.emphasis === "primary") - Number(a.emphasis === "primary"));
  return (
    <div data-landing-actions="" data-landing-action-pair={actions.length === 2 ? "" : undefined} className={actions.length === 2 ? `flex w-full flex-col gap-sm tablet:flex-row tablet:flex-wrap ${centered ? "items-center tablet:justify-center" : "items-start tablet:justify-start"}` : "flex flex-wrap items-center gap-sm"}>
      {resolved.map(({ action, emphasis }) => renderAction(action, emphasis, ground, size, actions.length === 2))}
    </div>
  );
}
