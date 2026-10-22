import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Icon } from "@clossys/designer/atoms/server";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { LandingView as RuntimeLandingView } from "#publisher-web-views";
import { LandingView as ServerLandingView } from "../views/LandingView.server.js";
import type { LandingViewProps } from "../views/LandingViewContent.js";
import { RenderError } from "../../internal/errors.js";
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

// The menu toggle's inverse ink, so the ghost mobile action beside it reads on the same plate.
const MOBILE_ACTION_INVERSE = "text-ink-on-inverse hover:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse";
const ENVIRONMENT_GHOST_CLASS = "site-header-environment-ghost";
const ICON_LIST_CLASSES = "m-0 flex list-none flex-wrap items-center gap-sm p-0";

function assertOverlayScene(children: ReactNode, headerSurface: "solid" | "transparent" | "glass"): void {
  // Read these live bindings only at render time: the views barrel also exports
  // GlobalErrorDocument, which composes SiteFrame.
  const directLanding = isValidElement<LandingViewProps>(children)
    && (children.type === RuntimeLandingView || children.type === ServerLandingView);
  if (directLanding) {
    const props = children.props;
    const sections = props.document?.sections;
    if (headerSurface === "glass" && props.fit === "frame" && props.landmark === "none"
      && (props.header === undefined || props.header === "overlay")
      && Array.isArray(sections) && sections.length === 1 && sections[0]?.kind === "hero" && sections[0].size !== "compact"
      && (props.trailing === undefined || (Array.isArray(props.trailing) && props.trailing.length === 0))
      && props.callToAction === undefined
      && (props.afterSection === undefined || Object.keys(props.afterSection).length === 0)
      && props.style === undefined && props.className === undefined) return;
  }
  throw new RenderError("resolution-failed", "shell.footer.placement overlay requires a direct hero-only LandingView with frame fit, no landmark and an overlay header; trailing content, closing content and layout overrides are unsupported.");
}

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
 * Server-safe: no hooks. Skip-link focus, header-ground observation and
 * navigation disclosure use the existing client islands and resolved data.
 */
export function SiteFrame({ shell, presentation, resolveCopy, resolveAsset, children }: SiteFrameProps): ReactElement {
  const resolved = resolveShell(shell, resolveCopy, resolveAsset, presentation);
  const { brand, footer } = resolved;
  if (footer?.placement === "overlay") assertOverlayScene(children, resolved.header.surface);

  const brandmark =
    brand.wordmark === undefined ? (
      <Brandmark variant="mark" size={brand.size} label={brand.label} markSrc={brand.markSrc} plate={brand.plate} markInk={brand.markInk} tone={brand.tone} origin={shell.origin} />
    ) : (
      <Brandmark variant="lockup" size={brand.size} label={brand.label} wordmark={brand.wordmark} markSrc={brand.markSrc} plate={brand.plate} markInk={brand.markInk} tone={brand.tone} origin={shell.origin} />
    );

  const navigation = resolved.nav;
  const nav = navigation ? <SiteNavDisclosure nav={navigation} actions={resolved.headerActions} /> : undefined;
  const primary = resolved.headerActions.find(action => action.emphasis === "primary");
  const inverseHeader = resolved.header.tone === "inverse";
  // Environment-only headers keep direct ghost icons; menu headers retain their mobile primary affordance.
  const actions = !navigation && resolved.environments.length > 0
    ? resolved.environments.map((environment, index) => <SiteHeader.ActionLink key={index} href={environment.href} label={environment.label} icon={environment.icon} isCurrent={environment.isCurrent} variant="ghost" className={inverseHeader ? `${ENVIRONMENT_GHOST_CLASS} ${MOBILE_ACTION_INVERSE}` : ENVIRONMENT_GHOST_CLASS} />)
    : primary ? <SiteHeader.ActionLink data-header-primary="" href={primary.href} label={primary.label} icon={primary.icon} isCurrent={primary.isCurrent} variant="ghost" className={inverseHeader ? MOBILE_ACTION_INVERSE : undefined} /> : undefined;

  const footerContent = footer ? (
    <SiteFooter
      tone={footer.tone}
      {...(footer.placement === "overlay" ? { className: "publisher-frame-footer-overlay", style: { pointerEvents: "auto" as const, width: "100%", marginBlockStart: "auto", minWidth: 0, overflowWrap: "anywhere" as const } } : {})}
      columns={footer.columns.length ? <>{footer.columns.map((column, columnIndex) => (
        <SiteFooter.Column key={columnIndex} heading={column.heading}>
          {column.links.map((link, linkIndex) => <a key={linkIndex} href={link.href} rel={/^https?:\/\//i.test(link.href) ? "noopener noreferrer" : undefined} className={LINK_CLASSES} style={LINK_STYLE}>{link.label}</a>)}
        </SiteFooter.Column>
      ))}</> : undefined}
      secondary={<SiteFooter.Legal
        entity={footer.legal.entity}
        links={[...footer.links, ...footer.legal.links]}
        linksLabel={footer.legal.linksLabel}
        icons={footer.social?.links.map(link => ({ label: link.label, href: link.href, icon: <Icon glyph={link.icon} decorative /> }))}
        iconsLabel={footer.social?.links.length ? footer.social.label : undefined}
        home={footer.home}
      />}

    />
  ) : null;

  return (
    <div data-frame-root="" className="flex min-h-dvh flex-col" {...(footer?.placement === "overlay" ? { style: { position: "relative" as const } } : {})}>
      <SiteSkipLink targetId={SITE_MAIN_ID} label={resolved.skipLink} followHeaderGround={resolved.header.surface === "glass"} />
      <SiteHeader
        surface={resolved.header.surface}
        tone={resolved.header.tone}
        className={resolved.header.surface === "glass" ? "site-header-ground-aware" : undefined}
        brand={brandmark}
        nav={nav}
        navPlacement={resolved.navPlacement}
        actions={actions}
      />
      <main id={SITE_MAIN_ID} tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </main>
      {footer?.placement === "overlay" ? (
        // Intrinsic footer height is reserved within the same growing hero scene.
        // No absolute viewport box can cover hero content when copy or links reflow.
        <div
          data-frame-footer-overlay=""
          style={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            minWidth: 0,
            pointerEvents: "none",
            zIndex: "var(--ui-z-sticky, 10)",
          }}
        >
          {footerContent}
        </div>
      ) : footerContent}
    </div>
  );
}
