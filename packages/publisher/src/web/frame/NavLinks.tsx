import { SiteHeader } from "@clossys/designer/shell/server";
import { HEADER_ACTION_VARIANTS } from "./site-frame-contract.js";
import type { ResolvedSiteLink, ResolvedSiteShell } from "./internal/resolveShell.js";

// Primary leads, so it is the first action in the expanded mobile menu; the rest keep their variant order.
const actionRank = (emphasis: (typeof HEADER_ACTION_VARIANTS)[number]) => emphasis === "primary" ? -1 : HEADER_ACTION_VARIANTS.indexOf(emphasis);

/**
 * The same full-label links serve the desktop row and the mobile panel. Actions
 * here are text only: the frame renders the mobile header-bar primary, the one
 * action that shows its icon, separately.
 */
export function NavLinks({ links, actions, surfaceLabel }: { readonly links: readonly ResolvedSiteLink[]; readonly actions?: ResolvedSiteShell["actions"]; readonly surfaceLabel?: string }) {
  return (
    <>
      {links.length ? <ul role="list" className="site-header-nav-links m-0 flex list-none flex-wrap items-center gap-sm p-0">
        {links.map((link, index) => (
          <li key={index}>
            <a href={link.href} aria-current={link.isCurrent ? "page" : undefined}
              className="inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ minHeight: "var(--ui-layout-tap-target, 44px)", minWidth: "var(--ui-layout-tap-target, 44px)" }}>{link.label}</a>
          </li>
        ))}
      </ul> : null}
      {actions?.length || surfaceLabel ? (
        <ul role="list" className="site-header-desktop-actions m-0 flex list-none gap-sm p-0">
          {[...(actions ?? [])].sort((a, b) => actionRank(a.emphasis) - actionRank(b.emphasis)).map((action, index) => (
            <li key={index}><SiteHeader.ActionLink href={action.href} label={action.label} isCurrent={action.isCurrent} variant={action.emphasis} /></li>
          ))}
          {surfaceLabel ? <li><span>{surfaceLabel}</span></li> : null}
        </ul>
      ) : null}
    </>
  );
}
