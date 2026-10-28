"use client";

import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";
import { NavLinks } from "./NavLinks.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav, actions }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]>; readonly actions?: ResolvedSiteShell["actions"] }) {
  return (
    <FrameNavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} trigger="icon">
      <NavLinks links={nav.links} actions={actions} />
    </FrameNavDisclosure>
  );
}
