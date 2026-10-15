"use client";

import { NavDisclosure } from "@clossys/designer/shell";
import type { ResolvedSiteShell } from "./internal/resolveShell.js";

/** The frame resolves copy and links on the server; Designer owns disclosure interaction. */
export function SiteNavDisclosure({ nav }: { readonly nav: NonNullable<ResolvedSiteShell["nav"]> }) {
  return (
    <NavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel}>
      <ul role="list" className="m-0 flex list-none flex-wrap items-center gap-sm p-0">
        {nav.links.map((link, index) => (
          <li key={index}>
            <a
              href={link.href}
              className="inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ minHeight: "var(--ui-layout-tap-target, 44px)" }}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </NavDisclosure>
  );
}
