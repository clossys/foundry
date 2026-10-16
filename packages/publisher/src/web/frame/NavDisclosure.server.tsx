import { useId, type ReactNode } from "react";
import { buttonLinkClassName, mergeUiClasses } from "@clossys/designer/atoms/server";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";
import { NavLinks } from "./NavLinks.js";

const TOGGLE_CLASSES = buttonLinkClassName("ghost", "sm")
  .split(" ")
  .filter(token => !token.includes("transition-"))
  .join(" ");
const TAP_TARGET = "var(--ui-layout-tap-target, 44px)";

/** Initial Designer disclosure markup for raw server imports; the client bridge supplies interaction. */
function ServerNavDisclosure({ label, triggerLabel, tone, children }: { readonly label: string; readonly triggerLabel: string; readonly tone?: "auto" | "inverse"; readonly children: ReactNode }) {
  // Match Designer’s complete inverse look without relying on its optional class merger.
  const inverse = tone === "inverse";
  const look = inverse
    ? TOGGLE_CLASSES.split(" ").filter(token => !["text-ink-primary", "hover:bg-surface-sunken", "focus-visible:outline-accent"].includes(token)).join(" ")
    : TOGGLE_CLASSES;
  const panelId = useId();
  return (
    <nav aria-label={label}>
      <button
        type="button"
        aria-expanded={false}
        aria-controls={panelId}
        data-tone={tone}
        className={mergeUiClasses(look, "nav-disclosure-toggle", inverse ? "text-ink-on-inverse hover:text-ink-on-inverse aria-expanded:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse" : undefined)}
        style={{ minHeight: TAP_TARGET, minWidth: TAP_TARGET }}
      >
        {triggerLabel}
      </button>
      <div id={panelId} className="nav-disclosure-panel">
        {children}
      </div>
    </nav>
  );
}

// Match the client wrapper's two component levels so useId agrees during hydration.
export function SiteNavDisclosure({ nav }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]> }) {
  return (
    <ServerNavDisclosure label={nav.label} triggerLabel={nav.triggerLabel} tone={nav.tone}>
      <NavLinks links={nav.links} />
    </ServerNavDisclosure>
  );
}
