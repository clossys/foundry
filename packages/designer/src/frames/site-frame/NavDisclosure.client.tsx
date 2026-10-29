"use client";

import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";
import { NavLinks } from "./NavLinks.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav, actions }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]>; readonly actions?: ResolvedSiteShell["actions"] }) {
  return (
    <FrameNavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} closeLabel={nav.closeLabel} trigger="icon"
      minimumBreakpoint={nav.mega?.length ? "tablet-lg" : "tablet"}
      mobileChildren={<NavLinks links={nav.links} actions={actions} mega={nav.mega} mobile />}>
      <NavLinks links={nav.links} actions={actions} mega={nav.mega} />
    </FrameNavDisclosure>
  );
}
