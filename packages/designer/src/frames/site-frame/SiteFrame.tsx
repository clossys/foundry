import { ShellI18nProvider, ShellLocaleRoot } from "#designer-frame-i18n";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "../../components/Link.js";
import { Icon, SemanticContent } from "@clossys/designer/components/server";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { LandingView as RuntimeLandingView } from "@clossys/designer/frames";
import { LandingView as ServerLandingView } from "./landing/web/views/LandingView.server.js";
import type { LandingViewProps } from "./landing/web/views/LandingViewContent.js";
import { RenderError } from "./landing/internal/errors.js";
import { SiteNavDisclosure } from "./NavDisclosure.boundary.client.js";
import { SiteSkipLink } from "./SkipLink.boundary.client.js";
import { resolveShell } from "./internal/resolveShell.js";
import { SITE_MAIN_ID } from "./types.js";
import type { SiteFrameProps } from "./types.js";

/** The frames.site-shell provenance stamp: this export is the foundry fill's package pointer. */
// The frames.site-shell provenance stamp (Designer dsAttrs shape), written literally: SiteFrame keeps its server-only import boundary.
const FRAME_STAMP = { "data-ds-layer": "frames", "data-ds-leaf": "frames.site-shell", "data-ds-fill": "foundry/frames.site-shell" } as const;

// The menu toggle's inverse ink, so the ghost mobile action beside it reads on the same plate.
const MOBILE_ACTION_INVERSE = "text-ink-on-inverse hover:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse";
const ENVIRONMENT_GHOST_CLASS = "site-header-environment-ghost";

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

/**
 * The page frame: skip link, banner, the page's one main landmark, contentinfo.
 *
 * The frame owns the single main landmark (`id` {@link SITE_MAIN_ID},
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
export function SiteFrame({ shell, presentation, resolveCopy, resolveAsset, children, toasts, locale }: SiteFrameProps): ReactElement {
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
      ground={footer.ground}
      rule={footer.rule}
      className={footer.placement === "overlay" ? "publisher-frame-footer-overlay pointer-events-auto w-full [margin-block-start:auto] min-w-0 [overflow-wrap:anywhere]" : undefined}
      columns={footer.columns.length ? <>{footer.columns.map((column, columnIndex) => (
        <SiteFooter.Column key={columnIndex} heading={column.heading}>
          {column.links.map((link, linkIndex) => <Link variant="standalone" key={linkIndex} href={link.href} rel={/^https?:\/\//i.test(link.href) ? "noopener noreferrer" : undefined} className="inline-flex min-h-[var(--ui-layout-tap-target)] items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{link.label}</Link>)}
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
    <ShellI18nProvider locale={locale}><ShellLocaleRoot><SemanticContent as="div" data-frame-root="" className={`flex min-h-dvh flex-col${footer?.placement === "overlay" ? " relative" : ""}`} {...FRAME_STAMP}>
      <SiteSkipLink targetId={SITE_MAIN_ID} label={resolved.skipLink} followHeaderGround={resolved.header.surface === "glass"} />
      <SiteHeader
        surface={resolved.header.surface}
        position={resolved.header.position}
        tone={resolved.header.tone}
        className={resolved.header.surface === "glass" ? "site-header-ground-aware" : undefined}
        brand={brandmark}
        nav={nav}
        navPlacement={resolved.navPlacement}
        actions={actions}
      />
      <SemanticContent as="main" id={SITE_MAIN_ID} tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </SemanticContent>
      {footer?.placement === "overlay" ? (
        // Intrinsic footer height is reserved within the same growing hero scene.
        // No absolute viewport box can cover hero content when copy or links reflow.
        <SemanticContent as="div"
          data-frame-footer-overlay=""
          className="flex flex-col shrink-0 min-w-0 pointer-events-none z-[var(--ui-z-sticky)]"
        >
          {footerContent}
        </SemanticContent>
      ) : footerContent}
      {toasts}
    </SemanticContent></ShellLocaleRoot></ShellI18nProvider>
  );
}
