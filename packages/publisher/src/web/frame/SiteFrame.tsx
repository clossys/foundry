import type { ReactElement } from "react";
import { Icon } from "@clossys/designer/atoms/server";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { SiteNavDisclosure } from "./NavDisclosure.boundary.client.js";
import { SiteSkipLink } from "./SkipLink.client.js";
import { resolveShell } from "./internal/resolveShell.js";
import type { ResolvedSiteIconLink, ResolvedSiteLink } from "./internal/resolveShell.js";
import { SITE_MAIN_ID } from "./types.js";
import type { SiteFrameProps } from "./types.js";

const LINK_CLASSES =
  "inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// Designer's tap-target token, the value SiteHeader.ActionLink and SiteFooter.Legal size their links with.
const TAP_TARGET = "var(--ui-layout-tap-target, 44px)";
const LINK_STYLE = { minHeight: TAP_TARGET } as const;
// An icon-only link has no text to widen it, so it takes the tap target in both axes, icon centred.
const ICON_LINK_CLASSES = `${LINK_CLASSES} justify-center`;
const ICON_LINK_STYLE = { minHeight: TAP_TARGET, minWidth: TAP_TARGET } as const;

function TextLink({ link }: { readonly link: ResolvedSiteLink }) {
  return (
    <a href={link.href} className={LINK_CLASSES} style={LINK_STYLE}>
      {link.label}
    </a>
  );
}

function IconLink({ link }: { readonly link: ResolvedSiteIconLink }) {
  return (
    <a href={link.href} aria-label={link.label} className={ICON_LINK_CLASSES} style={ICON_LINK_STYLE}>
      <Icon glyph={link.icon} decorative />
    </a>
  );
}

const ICON_LIST_CLASSES = "m-0 flex list-none flex-wrap items-center gap-sm p-0";

function IconLinkList({ links, className }: { readonly links: readonly ResolvedSiteIconLink[]; readonly className: string }) {
  return (
    <ul role="list" className={className}>
      {links.map((link, index) => (
        <li key={index}>
          <IconLink link={link} />
        </li>
      ))}
    </ul>
  );
}

function LinkList({ links, className }: { readonly links: readonly ResolvedSiteLink[]; readonly className: string }) {
  return (
    <ul role="list" className={className}>
      {links.map((link, index) => (
        // Keyed by position: two links may share an href and label, and the list never reorders.
        <li key={index}>
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
 * Server-safe: no hooks. Skip-link focus and navigation disclosure are client
 * islands; the server passes resolved strings and link data.
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

  const nav = resolved.nav ? <SiteNavDisclosure nav={resolved.nav} /> : undefined;

  const actions =
    resolved.actions.length > 0 || resolved.iconActions.length > 0 || resolved.environments.length > 0 ? (
      <>
        {resolved.actions.map((link, index) => (
          <SiteHeader.ActionLink key={`action-${index}`} href={link.href} label={link.label} />
        ))}
        {resolved.iconActions.map((link, index) => (
          <IconLink key={`icon-action-${index}`} link={link} />
        ))}
        {resolved.environments.map((environment, index) => (
          <SiteHeader.ActionLink
            key={`environment-${index}`}
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
        {...(resolved.header.placement === "overlay"
          ? { placement: "overlay" as const, tone: resolved.header.tone }
          : { ground: resolved.header.ground })}
        brand={brandmark}
        nav={nav}
        navPlacement={resolved.navPlacement}
        secondaryAction={resolved.secondaryAction ? <SiteHeader.ActionLink href={resolved.secondaryAction.href} label={resolved.secondaryAction.label} /> : undefined}
        actions={actions}
        surfaceLabel={resolved.surfaceLabel}
      />
      <main id={SITE_MAIN_ID} tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </main>
      {footer ? (
        <SiteFooter
          ground={footer.ground}
          columns={
            footer.columns.length > 0 || footer.links.length > 0 ? (
              <>
                {footer.columns.map((column, columnIndex) => (
                  <SiteFooter.Column key={columnIndex} heading={column.heading}>
                    {column.links.map((link, linkIndex) => (
                      <TextLink key={linkIndex} link={link} />
                    ))}
                  </SiteFooter.Column>
                ))}
                {footer.links.length > 0 ? (
                  <LinkList links={footer.links} className="m-0 flex list-none flex-wrap items-center gap-sm p-0" />
                ) : null}
              </>
            ) : undefined
          }
          secondary={
            <>
              {/* The social list sits beside SiteFooter.Legal (a `w-full` flex item) in the
                  footer's `secondary` row; it must not shrink, or its icons wrap. */}
              {footer.social && footer.social.links.length > 0 ? (
                footer.social.label === undefined ? (
                  <IconLinkList links={footer.social.links} className={`shrink-0 ${ICON_LIST_CLASSES}`} />
                ) : (
                  <nav aria-label={footer.social.label} className="shrink-0">
                    <IconLinkList links={footer.social.links} className={ICON_LIST_CLASSES} />
                  </nav>
                )
              ) : null}
              <SiteFooter.Legal
                entity={footer.legal.entity}
                links={footer.legal.links}
                {...(footer.legal.linksLabel === undefined ? {} : { linksLabel: footer.legal.linksLabel })}
              />
            </>
          }
        />
      ) : null}
    </div>
  );
}
