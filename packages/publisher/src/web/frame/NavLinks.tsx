import { SiteHeader } from "@clossys/designer/shell/server";
import { HEADER_ACTION_VARIANTS } from "./site-frame-contract.js";
import type { ResolvedSiteLink, ResolvedSiteShell } from "./internal/resolveShell.js";

/** The same full-label links serve the desktop row and the mobile panel. */
export function NavLinks({ links, actions, surfaceLabel }: { readonly links: readonly ResolvedSiteLink[]; readonly actions?: ResolvedSiteShell["actions"]; readonly surfaceLabel?: string }) {
  return (
    <>
      {links.length ? <ul role="list" className="site-header-nav-links m-0 flex list-none flex-wrap items-center gap-sm p-0">
        {links.map((link, index) => (
          <li key={index}>
            <a href={link.href} aria-current={link.isCurrent ? "page" : undefined}
              className="inline-flex items-center px-xs text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ minHeight: "var(--ui-layout-tap-target, 44px)", minWidth: "var(--ui-layout-tap-target, 44px)" }}>{link.label}</a>
          </li>
        ))}
      </ul> : null}
      {actions?.length || surfaceLabel ? (
        <ul role="list" className="site-header-desktop-actions m-0 flex list-none gap-sm p-0">
          {[...(actions ?? [])].sort((a, b) => (a.emphasis === "primary" ? -1 : HEADER_ACTION_VARIANTS.indexOf(a.emphasis)) - (b.emphasis === "primary" ? -1 : HEADER_ACTION_VARIANTS.indexOf(b.emphasis))).map((action, index) => (
            <li key={index}><SiteHeader.ActionLink href={action.href} label={action.label} isCurrent={action.isCurrent} variant={action.emphasis} /></li>
          ))}
          {surfaceLabel ? <li><span>{surfaceLabel}</span></li> : null}
        </ul>
      ) : null}
    </>
  );
}
