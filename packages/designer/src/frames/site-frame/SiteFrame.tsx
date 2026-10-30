import { ShellI18nProvider, ShellLocaleRoot } from "#designer-frame-i18n";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "../../components/Link.js";
import { Icon, Logomark, SemanticContent } from "@clossys/designer/components/server";
import { Brandmark, SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { ArticleReadingProgress } from "../../blocks/ArticleReading.js";
import { Hero, type HeroProps } from "../../blocks/Hero.js";
import { RenderError } from "./landing/internal/errors.js";
import { SiteNavDisclosure } from "./NavDisclosure.boundary.client.js";
import { SiteSkipLink } from "./SkipLink.boundary.client.js";
import { resolveShell } from "./internal/resolveShell.js";
import { SITE_MAIN_ID } from "./types.js";
import type { SiteFrameProps } from "./types.js";
import { SiteAnnouncement, SiteLocaleLinks } from "../../shell/SiteHeader.extras.js";
import { NewsletterBand } from "../../blocks/NewsletterBand.js";

/** The frames.site-shell provenance stamp: this export is the foundry fill's package pointer. */
// The frames.site-shell provenance stamp (Designer dsAttrs shape), written literally: SiteFrame keeps its server-only import boundary.
const FRAME_STAMP = { "data-ds-layer": "frames", "data-ds-leaf": "frames.site-shell", "data-ds-fill": "foundry/frames.site-shell" } as const;

// The menu toggle's inverse ink, so the ghost mobile action beside it reads on the same plate.
const MOBILE_ACTION_INVERSE = "text-ink-on-inverse hover:text-ink-on-inverse focus-visible:text-ink-on-inverse hover:bg-control-tonal-inverse-hover focus-visible:outline-ink-on-inverse";
const ENVIRONMENT_GHOST_CLASS = "site-header-environment-ghost";

/** Overlay is a frame composition of the registered sections.hero block, never a markup stamp. */
function overlayHero(children: ReactNode, headerSurface: "solid" | "transparent" | "glass"): ReactElement<HeroProps> {
  if (headerSurface === "glass" && isValidElement<HeroProps>(children) && children.type === Hero) {
    const props = children.props;
    const allowed = ["id", "eyebrow", "eyebrowTone", "measure", "headingScale", "heading", "description", "actions", "media", "composition", "headingLevel", "size", "ground", "align"];
    if (Object.keys(props).every(key => allowed.includes(key)) && (props.size === undefined || props.size === "default" || props.size === "display")
      && (props.headingLevel === undefined || props.headingLevel === 1) && typeof props.heading === "string" && props.heading.trim()) {
      // The frame owns scene geometry. The block keeps its registered anatomy and ground.
      return cloneElement(children, { className: "flex-1 justify-center px-md py-3xl tablet:px-xl" });
    }
  }
  throw new RenderError("resolution-failed", "shell.footer.placement overlay requires one direct registered Hero with a display h1 and a glass header; children, wrappers and layout overrides are unsupported.");
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
export function SiteFrame({ shell, presentation, resolveCopy, resolveAsset, children, toasts, locale, onAnnouncementDismiss, mainLayout = "default", toc, progress }: SiteFrameProps): ReactElement {
  const resolved = resolveShell(shell, resolveCopy, resolveAsset, presentation);
  if (onAnnouncementDismiss && resolved.announcement && !resolved.announcement.dismissLabel) throw new TypeError("SiteFrame announcement dismissal requires resolved dismiss copy.");
  const { brand, footer } = resolved;
  if (mainLayout !== "default" && mainLayout !== "article") throw new TypeError("SiteFrame: unsupported main layout");
  if (mainLayout === "article" && footer?.placement === "overlay") throw new TypeError("SiteFrame: article layout requires a flow footer");
  const supplied = (node: ReactNode) => node !== undefined && node !== null && node !== false;
  if (mainLayout !== "article" && (supplied(toc) || supplied(progress))) throw new TypeError("SiteFrame: reading slots require article layout");
  const articleRail = mainLayout === "article" && toc !== undefined && toc !== null && toc !== false;
  const main = footer?.placement === "overlay" ? overlayHero(children, resolved.header.surface) : children;

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
    ? resolved.environments.map((environment, index) => <SiteHeader.ActionLink key={index} href={environment.href} rel={/^https?:\/\//i.test(environment.href) ? "noopener noreferrer" : undefined} label={environment.label} icon={environment.icon} isCurrent={environment.isCurrent} variant="ghost" className={inverseHeader ? `${ENVIRONMENT_GHOST_CLASS} ${MOBILE_ACTION_INVERSE}` : ENVIRONMENT_GHOST_CLASS} />)
    : primary ? <SiteHeader.ActionLink data-header-primary="" href={primary.href} rel={/^https?:\/\//i.test(primary.href) ? "noopener noreferrer" : undefined} label={primary.label} icon={primary.icon} isCurrent={primary.isCurrent} variant="ghost" className={inverseHeader ? MOBILE_ACTION_INVERSE : undefined} /> : undefined;

  const footerContent = footer ? (
    <SiteFooter
      brand={footer.brandBand ? cloneElement(brandmark, { tone: "inverse" }) : undefined}
      ground={footer.ground}
      rule={footer.rule}
      locale={footer.locale ? <SiteLocaleLinks {...footer.locale} /> : undefined}
      newsletter={footer.newsletter ? <NewsletterBand {...footer.newsletter} layout="inline" ground="inverse" /> : undefined}
      className={footer.placement === "overlay" ? "publisher-frame-footer-overlay pointer-events-auto w-full [margin-block-start:auto] min-w-0 [overflow-wrap:anywhere]" : undefined}
      columns={footer.columns.length || (footer.brandBand && footer.social?.links.length) ? <>
        {footer.columns.map((column, columnIndex) => (
          <SiteFooter.Column key={columnIndex} heading={column.heading}>
            {column.links.map((link, linkIndex) => <Link variant="standalone" key={linkIndex} href={link.href} rel={/^https?:\/\//i.test(link.href) ? "noopener noreferrer" : undefined} className="inline-flex min-h-[var(--ui-layout-tap-target)] items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{link.label}</Link>)}
          </SiteFooter.Column>
        ))}
        {footer.brandBand && footer.social?.links.length ? <SiteFooter.Column heading={footer.social.label!}>
          {footer.social.links.map((link, index) => <SiteFooter.SocialLink key={index} href={link.href} label={link.label} {...(link.image ? { image: link.image } : { icon: link.icon })} />)}
        </SiteFooter.Column> : null}
      </> : undefined}
      secondary={<SiteFooter.Legal
        entity={footer.legal.entity}
        links={[...footer.links, ...footer.legal.links]}
        linksLabel={footer.legal.linksLabel}
        icons={footer.brandBand ? undefined : footer.social?.links.map(link => ({ label: link.label, href: link.href, icon: link.image ? <Logomark src={link.image.src} size="sm" /> : <Icon glyph={link.icon} decorative /> }))}
        iconsLabel={!footer.brandBand && footer.social?.links.length ? footer.social.label : undefined}
        home={footer.brandBand ? undefined : footer.home}
      />}

    />
  ) : null;

  return (
    <ShellI18nProvider locale={locale}><ShellLocaleRoot><SemanticContent as="div" data-frame-root="" className={`flex min-h-dvh flex-col${footer?.placement === "overlay" ? " relative" : ""}`} {...FRAME_STAMP}>
      <SiteSkipLink targetId={SITE_MAIN_ID} label={resolved.skipLink} followHeaderGround={resolved.header.surface === "glass"} />
      {resolved.announcement ? <SiteAnnouncement dismissed={resolved.announcement.dismissed} dismissLabel={resolved.announcement.dismissLabel}
        onDismiss={onAnnouncementDismiss}>{resolved.announcement.message}</SiteAnnouncement> : null}
      <SiteHeader
        surface={resolved.header.surface}
        position={resolved.header.position}
        tone={resolved.header.tone}
        className={resolved.header.surface === "glass" ? "site-header-ground-aware" : undefined}
        brand={brandmark}
        nav={nav}
        navPlacement={resolved.navPlacement}
        actions={actions}
        locale={resolved.header.locale ? <SiteLocaleLinks {...resolved.header.locale} /> : undefined}
      />
      {mainLayout === "article" && progress !== undefined && progress !== null && progress !== false ? <ArticleReadingProgress>{progress}</ArticleReadingProgress> : null}
      <SemanticContent as="main" id={SITE_MAIN_ID} tabIndex={-1} data-site-main-layout={mainLayout === "article" ? "article" : undefined} data-article-reading={mainLayout === "article" ? "" : undefined} className={articleRail ? "grid w-full flex-1 grid-cols-1 gap-xl desktop:grid-cols-4" : "flex w-full flex-1 flex-col"}>
        {articleRail ? <><SemanticContent as="aside" data-site-article-toc="" className="min-w-0 desktop:sticky desktop:top-lg desktop:self-start">{toc}</SemanticContent><SemanticContent as="div" data-site-article-body="" className="min-w-0 desktop:col-span-3">{main}</SemanticContent></> : main}
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
