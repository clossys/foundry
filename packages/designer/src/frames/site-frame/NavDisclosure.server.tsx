import { useId, type ReactNode } from "react";
import { buttonLinkClassName, mergeUiClasses } from "@clossys/designer/components/server";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";
import { NavLinks } from "./NavLinks.js";

const TOGGLE_CLASSES = buttonLinkClassName("ghost", "sm")
  .split(" ")
  .filter(token => !token.includes("transition-"))
  .join(" ");
const TAP_TARGET = "var(--ui-layout-tap-target, 44px)";

/** Initial Designer disclosure markup for raw server imports; the client bridge supplies interaction. */
function ServerNavDisclosure({ label, triggerLabel, children }: { readonly label: string; readonly triggerLabel: string; readonly children: ReactNode }) {
  const panelId = useId();
  return (
    <nav aria-label={label}>
      <button
        type="button"
        aria-label={triggerLabel}
        aria-expanded={false}
        aria-controls={panelId}
        className={mergeUiClasses(TOGGLE_CLASSES, "nav-disclosure-toggle")}
        style={{ minHeight: TAP_TARGET, minWidth: TAP_TARGET }}
      >
        <><span className="nav-disclosure-icon" aria-hidden="true"><span /><span /></span></>
      </button>
      <div id={panelId} className="nav-disclosure-panel">
        {children}
      </div>
    </nav>
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
