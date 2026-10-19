"use client";

import { NavDisclosure } from "@clossys/designer/shell";
import { NavLinks } from "./NavLinks.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav, actions, surfaceLabel }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]>; readonly actions?: ResolvedSiteShell["actions"]; readonly surfaceLabel?: string }) {
  return (
    <NavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} trigger={nav.trigger} tone={nav.tone}>
      <NavLinks links={nav.links} actions={actions} surfaceLabel={surfaceLabel} />
    </NavDisclosure>
  );
}
