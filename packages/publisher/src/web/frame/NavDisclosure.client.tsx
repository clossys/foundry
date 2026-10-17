"use client";

import { NavDisclosure } from "@clossys/designer/shell";
import { NavLinks } from "./NavLinks.js";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]> }) {
  return (
    <NavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} tone={nav.tone}>
      <NavLinks links={nav.links} />
    </NavDisclosure>
  );
}
