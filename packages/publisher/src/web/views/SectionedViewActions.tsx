import type { ReactNode } from "react";
import { buttonLinkClassName, Icon } from "@clossys/designer/atoms/server";
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

/** One ladder step, with a decorative trailing chevron only for quiet actions. */
export function renderAction(action: { id: string; label: ReactNode; href: string }, emphasis: SectionedViewContentActionEmphasis, ground: SectionedViewGround, responsivePair = false): ReactNode {
  const variant = emphasis === "secondary" ? "outline" : emphasis === "tertiary" ? "tonal" : emphasis;
  const large = emphasis === "primary" || emphasis === "secondary";
  return (
    <a key={action.id} href={action.href} className={[buttonLinkClassName(variant, large ? "lg" : "md", ground), responsivePair && large ? "w-full tablet:w-auto" : undefined].filter(Boolean).join(" ")} data-action-emphasis={emphasis}>
      {action.label}
      {emphasis === "quiet" ? <Icon glyph={ChevronRight} decorative size="md" /> : null}
    </a>
  );
}

/** Resolve original positions first, then put the primary first in DOM and focus order. */
export function renderRoleActions(actions: readonly LandingViewAction[] | undefined, ground: SectionedViewGround, centered = true): ReactNode {
  if (actions === undefined) return undefined;
  const resolved = actions.map((action, index) => ({ action, emphasis: resolveRoleActionEmphasis(action.emphasis, index) }));
  resolved.sort((a, b) => Number(b.emphasis === "primary") - Number(a.emphasis === "primary"));
  return (
    <div data-landing-actions="" className={actions.length === 2 ? `flex w-full flex-col gap-sm tablet:flex-row tablet:flex-wrap ${centered ? "items-center tablet:justify-center" : "items-start tablet:justify-start"}` : "flex flex-wrap items-center gap-sm"}>
      {resolved.map(({ action, emphasis }) => renderAction(action, emphasis, ground, actions.length === 2))}
    </div>
  );
}
