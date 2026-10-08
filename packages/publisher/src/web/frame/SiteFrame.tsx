import type { ReactElement } from "react";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { SiteSkipLink } from "./SkipLink.client.js";
import { resolveShell } from "./internal/resolveShell.js";
import type { ResolvedSiteLink } from "./internal/resolveShell.js";
import { SITE_MAIN_ID } from "./types.js";
import type { SiteFrameProps } from "./types.js";

const LINK_CLASSES =
  "inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LINK_STYLE = { minHeight: "var(--ui-layout-tap-target, 44px)" } as const;

function TextLink({ link }: { readonly link: ResolvedSiteLink }) {
  return (
    <a href={link.href} className={LINK_CLASSES} style={LINK_STYLE}>
      {link.label}
    </a>
  );
}

function LinkList({ links, className }: { readonly links: readonly ResolvedSiteLink[]; readonly className: string }) {
  return (
    <ul role="list" className={className}>
      {links.map((link) => (
        <li key={`${link.href} ${link.label}`}>
          <TextLink link={link} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The page frame: skip link, banner, the page's one `<main>`, contentinfo.
 *
 * The frame owns the single `<main>` (`id` {@link SITE_MAIN_ID},
 * `tabIndex={-1}`) and the skip link that targets it; the view passed as
 * `children` renders chrome-free and landmark-free inside it. The chrome is
 * Designer's `SiteHeader`, `Brandmark` and `SiteFooter`, mounted from
 * `shell`, which is data only: copy references resolved through
 * `resolveCopy`, the brand asset resolved through `resolveAsset`, and links
 * checked against an allowed set. Anything unknown or unresolved throws.
 *
 * Server-safe: no hooks. The skip link's focus handler is a client island,
 * so a server-rendered frame passes it strings only.
 */
export function SiteFrame({ shell, resolveCopy, resolveAsset, children }: SiteFrameProps): ReactElement {
  const resolved = resolveShell(shell, resolveCopy, resolveAsset);
  const { brand, footer } = resolved;

  const brandmark =
    brand.wordmark === undefined ? (
      <Brandmark variant="mark" size={brand.size} label={brand.label} markSrc={brand.markSrc} plate={brand.plate} />
    ) : (
      <Brandmark variant="lockup" size={brand.size} label={brand.label} wordmark={brand.wordmark} markSrc={brand.markSrc} plate={brand.plate} />
    );

  const nav = resolved.nav ? (
    <nav aria-label={resolved.nav.label}>
      <LinkList links={resolved.nav.links} className="m-0 flex list-none flex-wrap items-center gap-sm p-0" />
    </nav>
  ) : undefined;

  const actions =
    resolved.actions.length > 0 || resolved.environments.length > 0 ? (
      <>
        {resolved.actions.map((link) => (
          <TextLink key={`${link.href} ${link.label}`} link={link} />
        ))}
        {resolved.environments.map((environment) => (
          <SiteHeader.ActionLink
            key={`${environment.href} ${environment.label}`}
            href={environment.href}
            label={environment.label}
            icon={environment.icon}
            isCurrent={environment.isCurrent}
          />
        ))}
      </>
    ) : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteSkipLink targetId={SITE_MAIN_ID} label={resolved.skipLink} />
      <SiteHeader
        ground={resolved.ground}
        brand={brandmark}
        nav={nav}
        navPlacement={resolved.navPlacement}
        secondaryAction={resolved.secondaryAction ? <TextLink link={resolved.secondaryAction} /> : undefined}
        actions={actions}
        surfaceLabel={resolved.surfaceLabel}
      />
      <main id={SITE_MAIN_ID} tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </main>
      {footer ? (
        <SiteFooter
          ground={resolved.ground}
          columns={
            footer.columns.length > 0
              ? footer.columns.map((column) => (
                  <SiteFooter.Column key={column.heading} heading={column.heading}>
                    {column.links.map((link) => (
                      <TextLink key={`${link.href} ${link.label}`} link={link} />
                    ))}
                  </SiteFooter.Column>
                ))
              : undefined
          }
          secondary={
            <SiteFooter.Legal
              entity={footer.legal.entity}
              links={footer.legal.links}
              {...(footer.legal.linksLabel === undefined ? {} : { linksLabel: footer.legal.linksLabel })}
            />
          }
        />
      ) : null}
    </div>
  );
}
