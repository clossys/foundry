import { useId, type ReactNode } from "react";
import { Icon, SemanticContent } from "@clossys/designer/components/server";
import { cn } from "../../components/preview-runtime/components/_parts/utils/index.js";
import { componentLeaf, type ButtonLeaf } from "../../runtime/component-leaf.js";
import { List } from "../../icons/index.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";
import { FrameRegion } from "./FrameRegion.js";
import { NavLinks } from "./NavLinks.js";

// The client island's selected stock Button, collapsed, with its base-tone classes.
const Button = componentLeaf<ButtonLeaf>("components.button");
const TOGGLE_CLASSES = cn("min-size-tap", "nav-disclosure-toggle");

/** Initial Designer disclosure markup for raw server imports; the client bridge supplies interaction. */
function ServerNavDisclosure({ label, triggerLabel, children }: { readonly label: string; readonly triggerLabel: string; readonly children: ReactNode }) {
  const panelId = useId();
  return (
    <FrameRegion aria-label={label}>
      <Button variant="ghost" size="sm" aria-label={triggerLabel} aria-expanded={false} aria-controls={`${panelId}-sheet`} aria-haspopup="dialog" className={TOGGLE_CLASSES}>
        <Icon glyph={List} decorative />
      </Button>
      <SemanticContent as="div" id={panelId} className="nav-disclosure-panel site-header-nav-inline">
        {children}
      </SemanticContent>
    </FrameRegion>
  );
}

// Match the client wrapper's two component levels so useId agrees during hydration.
export function SiteNavDisclosure({ nav, actions }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]>; readonly actions?: ResolvedSiteShell["actions"] }) {
  return (
    <ServerNavDisclosure label={nav.label} triggerLabel={nav.triggerLabel}>
      <NavLinks links={nav.links} actions={actions} />
    </ServerNavDisclosure>
  );
}
