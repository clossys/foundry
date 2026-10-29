import { Link } from "../../components/Link.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { SiteHeader } from "@clossys/designer/shell/server";
import type { ResolvedSiteLink, ResolvedSiteShell } from "./internal/resolveShell.js";
import { SiteMegaNavigation, type SiteMegaGroup } from "../../shell/SiteHeader.mega.client.js";

/**
 * The same full-label links serve the desktop row and the mobile panel. Actions
 * keep the resolver's increasing-importance order, including on a narrow menu.
 * The frame also renders the primary icon in the narrow header bar.
 */
export function NavLinks({ links, actions, mega, mobile }: { readonly links: readonly ResolvedSiteLink[]; readonly actions?: ResolvedSiteShell["actions"]; readonly mega?: readonly SiteMegaGroup[]; readonly mobile?: boolean }) {
  return (
    <>
      {mega?.length ? <SiteMegaNavigation groups={mega} mobile={mobile} /> : null}
      {links.length ? <SemanticContent as="ul" role="list" className="site-header-nav-links m-0 flex list-none flex-wrap items-center gap-sm p-0">
        {links.map((link, index) => (
          <SemanticContent as="li" key={index}>
            <Link variant="standalone" href={link.href} rel={/^https?:\/\//i.test(link.href) ? "noopener noreferrer" : undefined} aria-current={link.isCurrent ? "page" : undefined}
              className="inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ minHeight: "var(--ui-layout-tap-target, 44px)", minWidth: "var(--ui-layout-tap-target, 44px)" }}>{link.label}</Link>
          </SemanticContent>
        ))}
      </SemanticContent> : null}
      {actions?.length ? (
        <SemanticContent as="ul" role="list" className="site-header-desktop-actions m-0 flex list-none gap-sm p-0">
          {actions.map((action, index) => (
            <SemanticContent as="li" key={index}><SiteHeader.ActionLink href={action.href} rel={/^https?:\/\//i.test(action.href) ? "noopener noreferrer" : undefined} label={action.label} icon={action.icon} isCurrent={action.isCurrent} variant={action.emphasis} /></SemanticContent>
          ))}
        </SemanticContent>
      ) : null}
    </>
  );
}
