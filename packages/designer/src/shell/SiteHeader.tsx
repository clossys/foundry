import { cloneElement, isValidElement, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Brandmark, type BrandmarkProps } from "./Brandmark.js";
import { Badge } from "../atoms/Badge.js";
import { buttonLinkClassName } from "../atoms/button-classes.js";
import { Icon, type IconNode } from "../atoms/Icon.js";
import { cx } from "../atoms/internal/cx.js";
import { SITE_CHROME_GROUND_CLASSES, siteChromeHasBorder, type SiteChromeGround } from "./internal/shell-ground.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET, UI_WIDTH_PAGE_PADDING_X, UI_Z_SHELL } from "./internal/shell-vars.js";

/**
 * Where a `SiteHeader` sits: `flow` in normal document flow (the shipped
 * behaviour), or `overlay` fixed over the top of the page, transparent over
 * the first block and glass once the page scrolls beneath it.
 */
export type SiteHeaderPlacement = "flow" | "overlay";

/**
 * The ink polarity of an overlay `SiteHeader`: `base` sets primary ink over
 * `--color-surface-glass`, `inverse` sets on-inverse ink over
 * `--color-surface-glass-inverse`. Tones are theme-relative, like the
 * tokens they name: `base` matches the base ground and `inverse` the
 * inverse ground in the current theme. `base` means dark ink on a light
 * ground only in the light theme; in the dark theme it is light ink on a
 * dark ground, and `inverse` flips with it. The glass the header turns into after scrolling
 * matches the same ink, so the ink never changes on scroll.
 *
 * The tone governs inherited ink only. A child that sets its own ink (a
 * `Link` in any variant, an explicitly toned `Brandmark`, the `ghost` look of
 * `SiteHeader.ActionLink`) keeps it. The contrast gate checks only the
 * tone's own ink on the glass (`ink-primary` or `ink-on-inverse`); no other
 * ink is checked there, and `ink-link`, `ink-secondary` and `ink-muted` fall
 * short of AA on it. Give header text the inherited ink or a child that
 * carries its own fill. Focus indicators inside the header take the tone's
 * ink instead of `--color-accent`, which falls below 3:1 on the glass.
 *
 * At the top of the page the header is transparent, with no scrim and no
 * contrast gate: the gate covers the glass, not the hero under it. Over
 * photographic or arbitrary hero art, the page supplies its own top scrim
 * and a tone that reads over it in both themes.
 */
export type SiteHeaderTone = "base" | "inverse";

export interface SiteHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /**
   * The site's identity — a wordmark, a logo image/link, or both. Required:
   * a header's entire job is announcing what site this is, the same reason
   * `PageHeader`'s `title` is required. This package ships no `BrandLockup`
   * of its own (a brand mark is per-product — the same reasoning `AuthView`
   * ships no `BrandLockup` either; see that view's own section in this
   * package's README).
   */
  brand: ReactNode;
  /**
   * The primary navigation — typically a `NavDisclosure` or `NavShell`, but any `ReactNode`
   * works (a short, static site with no disclosure needs might pass a plain
   * `<nav>` of `Link`s directly).
   */
  nav?: ReactNode;
  /**
   * Trailing controls — a `ThemeToggle` (from `@clossys/designer/theme`,
   * composed here rather than imported: `shell` may not depend on
   * `theme` — see `src/ladder.test.ts`), auth controls, a CTA `Button`.
   */
  actions?: ReactNode;
  /**
   * A secondary call to action — a sign-in link beside a primary CTA. Renders
   * directly before `actions`, in the same trailing region, so the two stay
   * adjacent in DOM, visual, and tab order.
   */
  secondaryAction?: ReactNode;
  /**
   * A short text label naming the surface, such as "admin" or "demo", shown
   * as a neutral `Badge` at the trailing end of the header, after
   * `secondaryAction` and `actions`, in both layouts. Text only by type: no
   * link, button or icon can be passed, so it is never interactive. A member
   * host omits it.
   *
   * Superseded by `SiteHeader.ActionLink`: a site with more than one
   * environment (an app, an admin, a demo) passes one `ActionLink` per
   * environment in `actions`, with `isCurrent` on the environment the page
   * belongs to, instead of a text badge. `surfaceLabel` keeps rendering for
   * existing callers.
   */
  surfaceLabel?: string;
  /**
   * Where the `nav` slot sits in the row. `"leading"` keeps it beside the
   * brand; `"centered"` gives brand, nav, and trailing controls their own
   * regions, with the brand and trailing regions growing equally so the nav
   * centers on the header. Logical properties only, so RTL mirrors.
   * @default "centered"
   */
  navPlacement?: "leading" | "centered";
  /**
   * Below tablet, place navigation at inline-start, the brand in a shrinkable
   * center column and actions at inline-end. From tablet up, `navPlacement`
   * still controls the row. DOM and tab order remain brand, nav, actions.
   * @default "menu-brand-action"
   */
  mobileLayout?: "inline" | "menu-brand-action";
  /**
   * Semantic plate for the header bar — `inverse` for a dark hero band,
   * `transparent` for no plate and no border at all (the page beneath shows
   * through), `transparent-inverse` for the same over a page on the inverse
   * ground. Like `base`, the header sets no ink class, so its content
   * inherits ink from the page; the consumer's backdrop owns contrast.
   * @default "base"
   */
  ground?: SiteChromeGround;
  /**
   * `"flow"` renders the header in normal flow (`position: relative`), as it
   * always has. `"overlay"` fixes it to the top of the viewport over the
   * first block, without taking any height in the document: transparent at
   * the top of the page, a glass plate (`--color-surface-glass` or its
   * inverse, behind a `--blur-glass` backdrop blur) once the page scrolls.
   *
   * Fixed to the viewport rather than absolutely positioned or stuck to its
   * scroll edge: the header must stay on screen to become glass after
   * scrolling, which an absolute header cannot do (it scrolls away with the
   * first block), and a stuck header reserves its height in flow, which is
   * what an overlay must not do. What `fixed` asks of the page:
   * - The first block reserves the header's height itself (padding, not a
   *   spacer), or its content starts under the header.
   * - The page scrolls on the root. The glass state follows root scrolling
   *   (`scroll(root block)`); a header inside its own scroll container does
   *   not turn glass.
   * - No ancestor is transformed, filtered or contained, which would make
   *   that ancestor the fixed header's containing block.
   * - In-page anchors need `scroll-padding-top` on the root for the header
   *   height, so a jump target does not land under it.
   * - The glass backdrop blur makes the header the containing block for
   *   `position: fixed` descendants: a full-screen menu panel rendered
   *   inside the header must portal out of it.
   *
   * The glass state needs no JavaScript: it is a scroll-driven CSS
   * animation, and an engine without scroll-driven animations shows glass
   * at every scroll position. Only paint changes between states, so the
   * header never shifts layout. Reduced motion swaps the fade for one step;
   * reduced transparency, or no backdrop blur support, swaps the glass for the
   * opaque raised (or inverse) plate.
   *
   * In `overlay`, `ground` is not read: the overlay surface is transparent
   * or glass, and `tone` picks the ink.
   * @default "flow"
   */
  placement?: SiteHeaderPlacement;
  /**
   * Overlay only: the ink polarity for the ground under the header at the
   * top of the page. Sets the header's inherited ink (`text-ink-primary` or
   * `text-ink-on-inverse`) and the matching glass, and renders as
   * `data-tone`. Children that set their own ink are not changed; see
   * `SiteHeaderTone`. Not read in `flow`, where the header sets no ink.
   * @default "base"
   */
  tone?: SiteHeaderTone;
  /**
   * Overlay only: signals that a menu belonging to the header is open, so the
   * header shows glass at any scroll position instead of sitting transparent
   * over the page. Renders as `data-menu-open`. A descendant with
   * `aria-expanded="true"` (an open menu toggle) has the same effect in CSS
   * with no prop, so a client menu inside a server-rendered header needs no
   * wiring. Not read in `flow`.
   * @default false
   */
  menuOpen?: boolean;
}

/** The ink an overlay header sets for each tone; it matches the glass the contrast gate pairs it with. */
const OVERLAY_INK_CLASSES: Record<SiteHeaderTone, string> = {
  base: "text-ink-primary",
  inverse: "text-ink-on-inverse",
};

/**
 * The persistent top chrome a public site needs: a brand slot, the primary
 * navigation, and a trailing actions area — three regions that differ in
 * kind, run through this package's own placement test #1 first ("does it
 * survive a route change?"): a site header's whole job is to still be
 * there after the route beneath it changes, which is what puts it in
 * `shell` rather than `blocks` despite otherwise reading like a
 * `PageHeader`-shaped block (see this package's README, "Placement
 * rules"). Renders a real `<header>` — registering as the page's `banner`
 * landmark automatically, PROVIDED it is rendered at the top level (not
 * nested inside `<main>`/`<article>`/`<aside>`/`<nav>`/`<section>`, which
 * strips the implicit landmark role per the HTML/ARIA spec — the same
 * placement rule `Shell.Header` and `Shell.Footer` already carry).
 *
 * Deliberately no `mode`/`variant` prop, the same reasoning `Shell` itself
 * documents for why it ships no `SiteHeader`/`AppHeader` of its own at the
 * app-shell layer ("Shell" → "How differing chrome is handled" in this
 * package's README): a marketing header, a signed-in member header, and a
 * staff header with genuinely different actions are three different
 * `brand`/`nav`/`actions` fillings of THIS component, not three values of
 * a prop on it. `navPlacement` is not a mode in that sense: it moves the
 * same `nav` slot within the row (layout), where a mode would swap what
 * fills it. The secondary call to action is a filling, so it is the
 * `secondaryAction` slot. A single `nav` slot keeps the header at one
 * navigation landmark by construction. `placement` and `tone` are not modes
 * either: they position and paint the same fillings, the way `ground` does.
 */
function SiteHeaderRoot({
  brand,
  nav,
  actions,
  secondaryAction,
  surfaceLabel,
  navPlacement = "centered",
  mobileLayout = "menu-brand-action",
  ground = "base",
  placement = "flow",
  tone = "base",
  menuOpen = false,
  className,
  style,
  ...rest
}: SiteHeaderProps) {
  const contract = navPlacement === "centered" && mobileLayout === "menu-brand-action";
  const overlay = placement === "overlay";
  const mobileMenu = mobileLayout === "menu-brand-action";
  const colors = SITE_CHROME_GROUND_CLASSES[ground];
  const bordered = siteChromeHasBorder(ground);
  const tonedBrand = isValidElement<BrandmarkProps>(brand) && brand.type === Brandmark && brand.props.tone === undefined
    ? cloneElement(brand, { tone: overlay && tone === "inverse" ? "inverse" : "auto" })
    : brand;

  return (
    <header
      {...rest}
      {...(contract ? { "data-header-root": "" } : {})}
      {...(overlay ? { "data-placement": "overlay", "data-tone": tone, "data-menu-open": menuOpen ? "" : undefined } : {})}
      className={
        overlay
          ? cx("site-header-overlay", OVERLAY_INK_CLASSES[tone], "py-sm", contract && "site-header-contract", className)
          : cx(colors.surface, "py-sm", bordered ? cx("border-b", colors.border) : "", contract && "site-header-contract", className)
      }
      style={
        overlay
          ? { position: "fixed", insetBlockStart: 0, insetInline: 0, zIndex: UI_Z_SHELL, ...style }
          : {
              position: "relative",
              zIndex: UI_Z_SHELL,
              ...(bordered ? { borderBottomWidth: UI_BORDER_HAIRLINE } : {}),
              ...style,
            }
      }
    >
      {contract ? (
        <div className="site-header-row">
          <div className="site-header-brand">{tonedBrand}</div>
          {nav}
          <div className="site-header-actions">{secondaryAction}{actions}{surfaceLabel ? <Badge variant="neutral">{surfaceLabel}</Badge> : null}</div>
        </div>
      ) : navPlacement === "centered" ? (
        <div
          className={mobileMenu ? "mx-auto grid w-full items-center gap-md tablet:flex tablet:flex-wrap" : "mx-auto flex w-full flex-wrap items-center gap-md"}
          style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X, ...(mobileMenu ? { gridTemplateColumns: "auto minmax(0, 1fr) auto" } : {}) }}
        >
          <div className={mobileMenu ? "col-start-2 row-start-1 min-w-0 justify-self-center tablet:flex tablet:flex-1 tablet:items-center" : "flex flex-1 items-center"}>{tonedBrand}</div>
          {nav ? <div className={mobileMenu ? "col-start-1 row-start-1 tablet:flex tablet:items-center" : "flex items-center"}>{nav}</div> : null}
          <div className={mobileMenu ? "col-start-3 row-start-1 flex items-center justify-self-end gap-sm tablet:flex-1 tablet:justify-end" : "flex flex-1 items-center justify-end gap-sm"}>
            {secondaryAction}
            {actions}
            {surfaceLabel ? <Badge variant="neutral">{surfaceLabel}</Badge> : null}
          </div>
        </div>
      ) : (
        <div
          className={mobileMenu ? "mx-auto grid w-full items-center gap-md tablet:flex tablet:flex-wrap tablet:justify-between" : "mx-auto flex w-full flex-wrap items-center justify-between gap-md"}
          style={{ paddingInline: UI_WIDTH_PAGE_PADDING_X, ...(mobileMenu ? { gridTemplateColumns: "auto minmax(0, 1fr) auto" } : {}) }}
        >
          <div className={mobileMenu ? "contents tablet:flex tablet:items-center tablet:gap-lg" : "flex items-center gap-lg"}>
            {mobileMenu ? <div className="col-start-2 row-start-1 min-w-0 justify-self-center tablet:contents">{tonedBrand}</div> : tonedBrand}
            {mobileMenu && nav ? <div className="col-start-1 row-start-1 tablet:contents">{nav}</div> : nav}
          </div>
          {secondaryAction || actions || surfaceLabel ? (
            <div className={mobileMenu ? "col-start-3 row-start-1 flex items-center justify-self-end gap-sm" : "flex items-center gap-sm"}>
              {secondaryAction}
              {actions}
              {surfaceLabel ? <Badge variant="neutral">{surfaceLabel}</Badge> : null}
            </div>
          ) : null}
        </div>
      )}
    </header>
  );
}

/** The `Button` looks an `ActionLink` can take. `danger` is not a header call to action. */
export type SiteHeaderActionLinkVariant = "primary" | "secondary" | "ghost";

export interface SiteHeaderActionLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href" | "aria-current" | "aria-label"> {
  /** The destination, rendered as a real `<a href>`. Required: the component assumes no route. */
  href: string;
  /**
   * The link's words, supplied by the caller. With an icon, visible beside it
   * from `tablet` up and visually hidden below it, still naming the link.
   * Without an icon, plain visible text at every width.
   */
  label: string;
  /** Optional glyph before the label. Decorative: `label` names the link. */
  icon?: IconNode;
  /**
   * Marks this link as the current item of its set, for example the
   * environment the page belongs to. Renders `aria-current="true"` and an
   * inset bar along the bottom edge, visible in the icon-only layout too.
   * The value is `true` rather than `page` because the link points to the
   * set member's home, which is not necessarily the page being shown.
   */
  isCurrent?: boolean;
  /**
   * The `Button` look to borrow, at size `sm`.
   * @default "secondary"
   */
  variant?: SiteHeaderActionLinkVariant;
}

/**
 * A call-to-action link for `SiteHeader`'s `actions` or `secondaryAction`
 * slot: a visible text label, or an icon plus a label from `tablet` up and
 * the icon alone below it. Built for an environment switcher - one link per environment (an
 * app, an admin, a demo), each to that environment's home, with `isCurrent`
 * on the one the page belongs to - but nothing in it is specific to
 * environments.
 *
 * Why a component rather than a composed `Link` with `buttonVariant` and an
 * `Icon`: the label must stay the accessible name while it is hidden below
 * `tablet`, which needs a responsive visually-hidden class that a consumer on
 * the `compiled.css` path cannot generate from its own source; the tap target
 * must reach `--ui-layout-tap-target` at the small button size; the current
 * item needs a cue that is not colour alone and survives the icon-only layout;
 * and `Link` is a client component, while site chrome renders on the server.
 * This component imports no react-aria-components, so it ships from
 * `@clossys/designer/shell/server` as well.
 *
 * It ships no copy and no route: `href` and `label` are required props.
 */
function SiteHeaderActionLink({
  href,
  label,
  icon,
  isCurrent = false,
  variant = "secondary",
  className,
  style,
  ...rest
}: SiteHeaderActionLinkProps) {
  const look = buttonLinkClassName(variant, "sm");
  return (
    <a
      {...rest}
      href={href}
      aria-current={isCurrent ? "true" : undefined}
      className={cx(look, className)}
      style={{
        minHeight: UI_LAYOUT_TAP_TARGET,
        minWidth: UI_LAYOUT_TAP_TARGET,
        ...(isCurrent ? { boxShadow: `inset 0 calc(-2 * ${UI_BORDER_HAIRLINE}) 0 currentColor` } : {}),
        ...style,
      }}
    >
      {icon ? <><Icon glyph={icon} decorative size="sm" /><span className="sr-only tablet:not-sr-only">{label}</span></> : label}
    </a>
  );
}

export const SiteHeader = Object.assign(SiteHeaderRoot, { ActionLink: SiteHeaderActionLink });
