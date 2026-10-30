import { Children, Fragment, cloneElement, isValidElement, type AnchorHTMLAttributes, type ComponentType, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Brandmark, type BrandmarkProps } from "./Brandmark.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { Icon, type IconNode } from "../components/Icon.js";
import { cx } from "../components/internal/cx.js";
import { SHELL_GROUND_CLASSES } from "./internal/shell-ground.js";
import { UI_BORDER_HAIRLINE, UI_LAYOUT_TAP_TARGET, UI_Z_SHELL } from "./internal/shell-vars.js";
import { resolveFrameHeaderOptions } from "../catalog-core/frame-header-options.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

/** DOM provenance (WIRE-3 D1): this frame root stamps its leaf and fill. */
const FRAME_STAMP = dsAttrs("frames", "frames.site-header", "foundry/frames.site-header");

/** Real LinkButton secondary export from the consumer's selected button source. */
const SelectedLinkButton = componentLeaf<ComponentType<Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> & {
  children: ReactNode; variant: "default" | "secondary" | "ghost"; size: "sm";
}>>("components.button", "LinkButton");

/** One header surface: an in-flow solid plate, an always-transparent row, or fixed scroll glass. */
export type SiteHeaderSurface = "solid" | "transparent" | "glass";
/** Theme-relative ink polarity, shared by all three header surfaces. */
export type SiteHeaderTone = "base" | "inverse";

export interface SiteHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** Site identity. A Brandmark inherits the header ink and uses the accent mark unless markInk="image" opts out. */
  brand: ReactNode;
  /** Primary navigation, typically a NavDisclosure or a plain navigation landmark. */
  nav?: ReactNode;
  /**
   * One actions slot, in increasing importance. Direct ActionLinks and fragments
   * containing only ActionLinks are ordered ghost, secondary, primary. Unknown
   * custom nodes retain their authored positions, props and relative order;
   * the host controls their importance and order. No content is duplicated.
   * A ThemeToggle is composed by the host: shell may not import theme
   * (see `src/ladder.test.ts`).
   */
  actions?: ReactNode;
  /** Where navigation sits on a wide header; the narrow menu/brand/actions layout is shared. @default "centered" */
  navPlacement?: "leading" | "centered";
  /**
   * Solid is an in-flow plate with a hairline. Transparent never paints a plate
   * or border. Glass is fixed over the first block: transparent at the scroll
   * origin, translucent and blurred after scrolling or while a menu is open.
   * The opaque fallback is for reduced transparency or missing backdrop blur.
   * The page owns root scrolling, reserves space beneath a fixed header and
   * supplies contrast beneath a transparent surface.
   * @default "solid"
   */
  surface?: SiteHeaderSurface;
  /** Solid/transparent position. Omission preserves normal flow; glass stays fixed and refuses static. */
  position?: "sticky" | "static";
  /** Theme-relative inherited ink and the matching solid/glass plate. @default "base" */
  tone?: SiteHeaderTone;
  /** Keeps glass painted while a menu is open. Other surfaces ignore this hint. @default false */
  menuOpen?: boolean;
}

const INK_CLASSES: Record<SiteHeaderTone, string> = { base: "text-ink-primary", inverse: "text-ink-on-inverse" };
const actionPriority = (action: ReactElement<SiteHeaderActionLinkProps>) =>
  action.props.variant === "primary" ? 2 : action.props.variant === "ghost" ? 0 : 1;
const isAction = (node: ReactNode): node is ReactElement<SiteHeaderActionLinkProps> =>
  isValidElement<SiteHeaderActionLinkProps>(node) && node.type === SiteHeaderActionLink;
function actionGroup(children: ReactNode): boolean {
  return Children.toArray(children).every(child => isAction(child)
    || (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment && actionGroup(child.props.children)));
}
/** Flatten only known, stateless ActionLink groups; opaque custom subtrees are not inspected or cloned. */
function actionNodes(children: ReactNode, prefix = ""): ReactNode[] {
  return Children.toArray(children).flatMap(child => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment && actionGroup(child.props.children))
      return actionNodes(child.props.children, prefix + child.key + "/");
    return [isAction(child) ? cloneElement(child, { key: prefix + child.key }) : child];
  });
}
function orderedActions(children: ReactNode): ReactNode[] {
  const nodes = actionNodes(children);
  const ordered = nodes.filter(isAction).sort((a, b) => actionPriority(a) - actionPriority(b));
  let index = 0;
  return nodes.map(node => isAction(node) ? ordered[index++] : node);
}

/** Persistent site banner with one responsive row and one surface/ink contract. Server-safe: no hooks. */
function SiteHeaderRoot({ brand, nav, actions, navPlacement = "centered", surface = "solid", tone = "base", position,
  menuOpen = false, className, style, ...rest }: SiteHeaderProps) {
  if (surface !== "solid" && surface !== "transparent" && surface !== "glass")
    throw new TypeError("SiteHeader: surface must be solid, transparent or glass.");
  const headerPosition = resolveFrameHeaderOptions("frames.site-header", { surface, position }).position;
  const glass = surface === "glass";
  const solid = surface === "solid";
  const leading = navPlacement === "leading";
  const colors = SHELL_GROUND_CLASSES[tone];
  const headerBrand = isValidElement<BrandmarkProps>(brand) && brand.type === Brandmark ? brand : undefined;
  const tonedBrand = headerBrand && (headerBrand.props.tone === undefined || headerBrand.props.markInk === undefined)
    ? cloneElement(headerBrand, {
        ...(headerBrand.props.tone === undefined ? { tone: tone === "inverse" ? "inverse" : "auto" } : {}),
        ...(headerBrand.props.tone === undefined && headerBrand.props.className === undefined ? { className: "text-inherit" } : {}),
        ...(headerBrand.props.markInk === undefined ? { markInk: "accent" } : {}),
      } satisfies Partial<BrandmarkProps>)
    : brand;
  return (
    <header {...FRAME_STAMP} {...rest} data-header-root="" data-surface={surface} data-tone={tone}
      {...(glass ? { "data-placement": "overlay", "data-menu-open": menuOpen ? "" : undefined } : {})}
      className={cx("site-header-contract site-header-ink py-sm", INK_CLASSES[tone],
        glass ? "site-header-overlay" : solid ? cx(colors.surface, "border-b", colors.border) : undefined,
        leading ? "site-header-leading" : undefined, className)}
      style={{ position: headerPosition,
        ...(headerPosition === "sticky" ? { zIndex: "var(--ui-z-sticky, 10)", insetBlockStart: 0 }
          : position === "static" ? {} : { zIndex: UI_Z_SHELL }),
        ...(glass ? { insetBlockStart: 0, insetInline: 0 } : {}),
        ...(solid ? { borderBottomWidth: UI_BORDER_HAIRLINE } : {}), ...style }}>
      <div className="site-header-row">
        <div className="site-header-brand">{tonedBrand}</div>
        {nav}
        <div className="site-header-actions">{orderedActions(actions)}</div>
      </div>
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
   * environment the page belongs to. Renders `aria-current="page"` and an
   * inset bar along the bottom edge, visible in the icon-only layout too.
   * Set this only when the destination is the current page.
   */
  isCurrent?: boolean;
  /**
   * The `Button` look to borrow, at size `sm`.
   * @default "secondary"
   */
  variant?: SiteHeaderActionLinkVariant;
}

/**
 * A call-to-action link for `SiteHeader`'s ordered `actions` slot: a visible text label, or an icon plus a label from `tablet` up and
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
  return (
    <SelectedLinkButton
      {...rest}
      href={href}
      variant={variant === "primary" ? "default" : variant}
      size="sm"
      aria-current={isCurrent ? "page" : undefined}
      data-header-action-ghost={variant === "ghost" ? "" : undefined}
      className={className}
      style={{
        minHeight: UI_LAYOUT_TAP_TARGET,
        minWidth: UI_LAYOUT_TAP_TARGET,
        ...(isCurrent ? { boxShadow: `inset 0 calc(-2 * ${UI_BORDER_HAIRLINE}) 0 currentColor` } : {}),
        ...style,
      }}
    >
      {icon ? <><Icon glyph={icon} decorative size="sm" /><span className="sr-only tablet:not-sr-only">{label}</span></> : label}
    </SelectedLinkButton>
  );
}

export const SiteHeader = Object.assign(SiteHeaderRoot, { ActionLink: SiteHeaderActionLink });
