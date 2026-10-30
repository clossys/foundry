"use client";
import { useLocale } from "react-aria-components";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDown } from "../icons/ChevronDown.js";
import type { FramePageHeader, FramePageHeaderNav, FramePageHeaderActions, FramePageHeaderDestination } from "../frame-page-header.js";
import { Check } from "../icons/Check.js";

import { frameLinkNavigation, type FrameNavigate } from "./frame-navigation.js";
import { frameHeaderOverflow } from "./frame-header-layout.js";
import { CONTROL, TAP, PAGE_BAR_LAYOUT } from "./page-bar-layout.js";
import { resolveFrameHeaderOptions } from "../catalog-core/frame-header-options.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Popover = componentLeaf<typeof import("../components/Popover.js").Popover>("components.popover");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const ToggleButton = componentLeaf<typeof import("../components/ToggleButton.js").ToggleButton>("components.toggle-button");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");
const Menu = componentLeaf<typeof import("../components/Menu.js").Menu>("components.menu");
const Tooltip = componentLeaf<typeof import("../components/Tooltip.js").Tooltip>("components.tooltip");

const EMBEDDED_HEADER = "frame-header-row";
const GLASS_SURFACE = "bg-surface-glass";
const RAISED_SURFACE = "bg-surface-raised";

export type PageBarDestination = FramePageHeaderDestination;
export interface PageBarCrumb {
  id: string;
  label: string;
  href?: string;
  /** Alternatives at this level, rendered with the existing Menu component. */
  siblings?: readonly PageBarDestination[];
}
export type PageBarAction = { id: string; label: string; primary?: boolean; isDisabled?: boolean; icon?: ReactNode; isSelected?: boolean; onSelectedChange?: (selected: boolean) => void } & (
  | { href: string; onAction?: never }
  | { href?: never; onAction: () => void }
);
export interface PageBarPage {
  /** Rendered as the one page h1. */
  title: string;
  /** Ancestors after the root; an optional last entry whose label equals title supplies current-page siblings. */
  breadcrumb?: readonly PageBarCrumb[];
  status?: ReactNode;
  description?: ReactNode;
  updatedAt?: ReactNode;
  meta?: ReactNode;
  /** Only the first primary request receives primary styling. */
  actions?: readonly PageBarAction[];
  scope?: ReactNode;
}
export interface PageBarLabels {
  breadcrumb: string;
  collapsedBreadcrumb: string;
  pageInfo: string;
  pageActions: string;
}
export type PageBarHeaderNav = FramePageHeaderNav;
export type PageBarHeaderActions = FramePageHeaderActions;
export type PageBarHeader = FramePageHeader;
export interface PageBarProps {
  /** Frame-owned chrome remains in the stage track, including glass surfaces. */
  embedded?: boolean;
  start?: ReactNode;
  end?: ReactNode;
  /** Omission keeps the floating sticky bar. Explicit solid/transparent uses a full-width bar; solid adds a hairline. */
  surface?: "solid" | "transparent" | "glass";
  /** Static stays in document flow and reads no sticky layer. Glass is fixed and refuses static. */
  position?: "sticky" | "static";
  /** Optional trail root: a link or, with workspaces, a menu labelled by root.label. Omitted: the trail starts at page.breadcrumb. */
  root?: { label: string; href?: string };
  header?: PageBarHeader;
  onNavigate?: FrameNavigate;
  labels: PageBarLabels;
  /** Absent: optional context slot, without a trail. */
  page?: PageBarPage;
  workspaces?: readonly PageBarDestination[];
  /** Optional app-header content at the start of the bar, before the page trail. */
  context?: ReactNode;
  /** Collapse ancestors and overflow non-primary actions. @default false */
  narrow?: boolean;
  /** Reserve a tap target plus gap at the inline start. @default false */
  reserveStart?: boolean;
  /** Reserve a tap target plus gap at the inline end. @default false */
  reserveEnd?: boolean;
  dir?: "ltr" | "rtl";
  onHeightChange?: (height: number) => void;
}

function PageAction({ label, href, onAction, isDisabled, primary, icon, isSelected, onSelectedChange }: PageBarAction) {
  if (isSelected !== undefined) return <ToggleButton aria-label={label} shape={icon ? "icon-only" : "text"} isSelected={isSelected} onChange={onSelectedChange ?? (() => onAction?.())} isDisabled={isDisabled}>{icon ?? label}</ToggleButton>;
  if (icon) return href !== undefined ? <Link href={href} aria-label={label} buttonVariant="ghost" isDisabled={isDisabled}>{icon}</Link> : <Button aria-label={label} className={CONTROL} style={TAP} variant="ghost" onPress={onAction} isDisabled={isDisabled}>{icon}</Button>;
  return href !== undefined
    ? <Link href={href} buttonVariant={primary ? "primary" : "ghost"} isDisabled={isDisabled} className="min-w-0 max-w-full"
        data-application-frame-action={primary ? "primary" : "secondary"}><SemanticContent as="span" className="min-w-0 truncate">{label}</SemanticContent></Link>
    : <Button variant={primary ? "primary" : "ghost"} onPress={onAction} isDisabled={isDisabled} className="min-w-0 max-w-full"
        data-application-frame-action={primary ? "primary" : "secondary"}><SemanticContent as="span" className="min-w-0 truncate">{label}</SemanticContent></Button>;
}

function CrumbMenu({ label, href, id, siblings }: PageBarCrumb) {
  return <Menu trigger={<Button variant="ghost" className={CONTROL + " min-w-0 gap-xs"} style={TAP}><SemanticContent as="span" className="truncate">{label}</SemanticContent><Icon glyph={ChevronDown} decorative size="sm" /></Button>}>
    {href && <Menu.Item id={id} href={href}>{label}</Menu.Item>}
    {siblings?.map(item => <Menu.Item key={item.id} id={item.id} href={item.href}>{item.label}</Menu.Item>)}
  </Menu>;
}

function PageTrail({ root, title, breadcrumb = [], workspaces, narrow,
  labels: { breadcrumb: breadcrumbLabel, collapsedBreadcrumb: collapsedBreadcrumbLabel },
}: Pick<PageBarProps, "root" | "workspaces" | "labels"> & Pick<PageBarPage, "title" | "breadcrumb"> & { narrow: boolean }) {
  const current = breadcrumb.at(-1)?.label === title ? breadcrumb.at(-1) : undefined;
  const ancestors = current ? breadcrumb.slice(0, -1) : breadcrumb;
  return <nav aria-label={breadcrumbLabel} className="min-w-0 flex-1">
    <ol className="m-0 flex min-w-0 list-none items-center gap-xs p-0">
      {root && <SemanticContent as="li" className="min-w-0 shrink-0">
        {workspaces?.length ? <CrumbMenu id="workspace" label={root.label} siblings={workspaces} /> :
          <Link href={root.href} variant="standalone" className={CONTROL} style={TAP}>{root.label}</Link>}
      </SemanticContent>}
      {narrow && ancestors.length > 0
        ? <SemanticContent as="li" className="shrink-0"><Menu trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={collapsedBreadcrumbLabel}><SemanticContent as="span" aria-hidden="true">...</SemanticContent></Button>}>
            {ancestors.map(item => <Menu.Section key={item.id} heading={item.label}>
              <Menu.Item id={JSON.stringify([item.id])} href={item.href}>{item.label}</Menu.Item>
              {item.siblings?.map(sibling => <Menu.Item key={sibling.id} id={JSON.stringify([item.id, sibling.id])} href={sibling.href}>{sibling.label}</Menu.Item>)}
            </Menu.Section>)}
          </Menu></SemanticContent>
        : ancestors.map(item => <SemanticContent as="li" key={item.id} className="min-w-0 shrink-0">
            {item.siblings?.length ? <CrumbMenu {...item} /> : <Link href={item.href} variant="standalone" className={CONTROL} style={TAP}>{item.label}</Link>}
          </SemanticContent>)}
      <SemanticContent as="li" className="min-w-0 flex-1">
        <SemanticContent as="h1" aria-current="page" className="m-0 truncate text-body font-semibold">{title}</SemanticContent>
        {current?.siblings?.length ? <CrumbMenu {...current} /> : null}
      </SemanticContent>
    </ol>
  </nav>;
}

/** Page header and metadata composition. The frame owns stage sizing. */
export function PageBar({ root, context, page, workspaces, header, onNavigate, labels, embedded = false, start, end, narrow: suppliedNarrow = false, reserveStart = false, reserveEnd = false, onHeightChange, dir, position, surface }: PageBarProps) {
  const resolvedPosition = resolveFrameHeaderOptions("frames.app-header", { position, surface }).position;
  const headerPosition = embedded ? "relative" : resolvedPosition;
  const legacy = !embedded && surface === undefined && position === undefined;
  const { pageInfo: pageInfoLabel, pageActions: pageActionsLabel } = labels;
  const bar = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const legacyActions = useRef<HTMLDivElement>(null);
  const legacyIntrinsic = useRef({ nav: 0, actions: 0 });
  const [frameCompact, setFrameCompact] = useState(false);
  const narrow = embedded ? frameCompact : suppliedNarrow;

  const [glassSupported, setGlass] = useState(false);
  const glass = (legacy || surface === "glass") && glassSupported;
  const [infoOpen, setInfoOpen] = useState(false);
  const [barWidth, setBarWidth] = useState<number>();
  const { direction: contextDirection } = useLocale();
  const direction = dir ?? contextDirection;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const forced = window.matchMedia("(forced-colors: active)");
    const sync = () => setGlass(!reduced.matches && !forced.matches && Boolean(globalThis.CSS?.supports?.("backdrop-filter", PAGE_BAR_LAYOUT.blur) || globalThis.CSS?.supports?.("-webkit-backdrop-filter", PAGE_BAR_LAYOUT.blur)));
    sync(); reduced.addEventListener("change", sync); forced.addEventListener("change", sync);
    return () => { reduced.removeEventListener("change", sync); forced.removeEventListener("change", sync); };
  }, []);
  useEffect(() => {
    const measure = () => {
      if (!bar.current) return;
      const rect = bar.current.getBoundingClientRect();
      if (rect.height > 0) onHeightChange?.(rect.height);
      setBarWidth(rect.width || undefined);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    if (bar.current) observer?.observe(bar.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [dir, onHeightChange, page, context, narrow, infoOpen, header]);
  useEffect(() => {
    if (!embedded || header || !page) return;
    const measure = () => {
      const root = body.current, actions = legacyActions.current;
      if (!root || !actions || !root.clientWidth) return;
      const nav = root.querySelector("nav");
      const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
      if (!frameCompact) {
        legacyIntrinsic.current.actions = actions.scrollWidth;
        const items = [...(nav?.querySelector("ol")?.children ?? [])];
        legacyIntrinsic.current.nav = items.reduce((sum, item) => {
          const heading = item.querySelector("h1");
          if (!heading) return sum + item.getBoundingClientRect().width;
          const range = document.createRange(); range.selectNodeContents(heading);
          return sum + (typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect().width : heading.scrollWidth);
        }, Math.max(0, items.length - 1) * gap);
      }
      const other = [...root.children].filter(node => node !== nav && node !== actions).reduce((sum, node) => sum + node.getBoundingClientRect().width + gap, 0);
      const size = legacyIntrinsic.current;
      const next = frameHeaderOverflow(root.clientWidth - other, 0, size.nav, size.actions, actions.scrollWidth, gap);
      setFrameCompact(next.compactActions || next.compactNav);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    if (body.current) observer?.observe(body.current);
    if (legacyActions.current) observer?.observe(legacyActions.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [embedded, header, page, frameCompact]);
  const primary = page?.actions?.find(action => action.primary);
  const information = page && [page.status, page.description, page.updatedAt, page.meta, page.scope].some(value => value !== undefined && value !== null && value !== false);
  const content = header ? <HeaderSlots header={header} onNavigate={onNavigate} embedded={embedded} /> : <>
    {context === undefined || context === null ? null : <SemanticContent as="div" data-application-frame-slot="context" className="min-w-0 max-w-full">{context}</SemanticContent>}
    {page && <PageTrail root={root} title={page.title} breadcrumb={page.breadcrumb} workspaces={workspaces} narrow={narrow} labels={labels} />}
    {information && <Popover anchorRef={bar} className="text-body text-ink-primary" aria-label={pageInfoLabel} placement="bottom start" offset={0} isOpen={infoOpen} onOpenChange={setInfoOpen}
      trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={pageInfoLabel} aria-expanded={infoOpen}><Icon glyph={ChevronDown} decorative className={infoOpen ? "rotate-180" : undefined} /></Button>}
      style={{ direction, inlineSize: barWidth, maxInlineSize: `calc(100vw - 2 * ${PAGE_BAR_LAYOUT.gutter})` }}>
      <SemanticContent as="div" data-application-frame-region="page-info" className="flex flex-wrap items-start gap-sm">
        <SemanticContent as="div">{page?.status}</SemanticContent><SemanticContent as="div">{page?.description}</SemanticContent><SemanticContent as="div">{page?.updatedAt}</SemanticContent><SemanticContent as="div">{page?.meta}</SemanticContent><SemanticContent as="div">{page?.scope}</SemanticContent>
      </SemanticContent>
    </Popover>}
    <SemanticContent as="div" ref={legacyActions} data-application-frame-region="bar-actions" className={"ms-auto flex min-w-0 items-center justify-end gap-xs" + (embedded ? " shrink-0" : "")} style={{ flexBasis: narrow && !embedded ? "100%" : undefined }}>
      {page?.actions?.map(action => (!narrow || action === primary) && <PageAction key={action.id} {...action} primary={action === primary} />)}
      {narrow && page?.actions?.some(action => action !== primary) && <Menu trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={pageActionsLabel}><Icon glyph={ChevronDown} decorative /></Button>}>
        {page.actions.filter(action => action !== primary).map(action => <Menu.Item key={action.id} id={action.id} href={action.href} isDisabled={action.isDisabled} onAction={action.onAction}>{action.label}</Menu.Item>)}
      </Menu>}
    </SemanticContent>
    </>;
  return <header onClick={event => frameLinkNavigation(event, onNavigate)} ref={bar} data-application-frame-region="bar" className={legacy
      ? "relative flex min-w-0 flex-wrap items-center gap-xs rounded-control border border-line-base p-sm text-ink-primary " + (glass ? GLASS_SURFACE : RAISED_SURFACE)
      : "relative flex min-w-0 flex-wrap items-center gap-xs p-sm text-ink-primary "
        + (surface === "transparent" ? "" : "border-b border-line-base ")
        + (surface === "transparent" ? "" : glass ? GLASS_SURFACE : RAISED_SURFACE) + (embedded ? " " + EMBEDDED_HEADER : "")}
    style={{ position: headerPosition, inlineSize: embedded ? "100%" : undefined, flexWrap: embedded ? "nowrap" : undefined,
      ...(headerPosition === "sticky" ? { insetBlockStart: legacy ? PAGE_BAR_LAYOUT.gutter : 0 }
        : headerPosition === "fixed" ? { insetBlockStart: 0, insetInline: 0 } : {}),
      ...(legacy ? { marginBlockStart: PAGE_BAR_LAYOUT.gutter, marginInline: PAGE_BAR_LAYOUT.gutter }
        : surface === "transparent" ? {} : { borderBottomWidth: PAGE_BAR_LAYOUT.hairline }),
      paddingInlineStart: reserveStart ? `calc(${PAGE_BAR_LAYOUT.tap} + ${PAGE_BAR_LAYOUT.gap})` : PAGE_BAR_LAYOUT.gap,
      paddingInlineEnd: reserveEnd ? `calc(${PAGE_BAR_LAYOUT.tap} + ${PAGE_BAR_LAYOUT.gap})` : PAGE_BAR_LAYOUT.gap,
      backdropFilter: glass ? PAGE_BAR_LAYOUT.blur : "none", WebkitBackdropFilter: glass ? PAGE_BAR_LAYOUT.blur : "none",
      ...(headerPosition === "sticky" ? { zIndex: PAGE_BAR_LAYOUT.barLayer }
        : headerPosition === "fixed" ? { zIndex: "var(--ui-z-shell)" } : {}) }}>
    {embedded ? <>{start}<SemanticContent as="div" ref={body} className="flex min-w-0 flex-1 items-center gap-xs">{content}</SemanticContent>{end}</> : content}
  </header>;
}

function HeaderSlots({ header, onNavigate, embedded = false }: { header: PageBarHeader; onNavigate?: FrameNavigate; embedded?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const intrinsic = useRef({ title: 0, nav: 0, actions: 0, compactActions: 0 });
  const [overflow, setOverflow] = useState({ compactActions: false, compactNav: false });
  useEffect(() => {
    const measure = () => {
      if (!root.current) return;
      const size = intrinsic.current;
      if (!embedded || !overflow.compactNav) size.nav = nav.current?.scrollWidth ?? 0;
      if (!overflow.compactNav) size.title = title.current?.scrollWidth ?? 0;
      if (overflow.compactActions) size.compactActions = actions.current?.scrollWidth ?? 0;
      else size.actions = actions.current?.scrollWidth ?? 0;
      const available = root.current.clientWidth;
      if (!available) return;
      const gap = Number.parseFloat(getComputedStyle(root.current).columnGap) || 0;
      const tap = Number.parseFloat(getComputedStyle(root.current).getPropertyValue("--ui-layout-tap-target")) || 0;
      const next = frameHeaderOverflow(available, Math.min(size.title, tap), size.nav, size.actions, size.compactActions, gap);
      setOverflow(previous => previous.compactActions === next.compactActions && previous.compactNav === next.compactNav ? previous : next);
    };
    measure(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    if (root.current) observer?.observe(root.current);
    if (nav.current) observer?.observe(nav.current);
    if (actions.current) observer?.observe(actions.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [header, overflow.compactActions, overflow.compactNav]);
  const active = header.nav?.items.find(item => item.id === header.nav?.activeId);
  return <SemanticContent as="div" ref={root} data-frame-header-overflow={overflow.compactNav ? "navigation" : overflow.compactActions ? "actions" : "none"}
    className="frame-header-grid relative grid w-full min-w-0 items-center gap-xs" style={embedded ? { rowGap: 0 } : undefined}>
    <SemanticContent as="div" className="w-full min-w-0 justify-self-start" style={embedded ? { gridColumn: 1, gridRow: 1 } : undefined}>
      {overflow.compactNav && header.nav ? <Menu trigger={<Button variant="ghost" className="min-w-0 max-w-full gap-xs" style={TAP}><SemanticContent as="h1" className="m-0 truncate text-body font-semibold">{header.title}{active ? ` / ${active.label}` : ""}</SemanticContent><Icon glyph={ChevronDown} decorative /></Button>}>
        {header.nav.items.map(item => <Menu.Item key={item.id} id={item.id} href={item.href} textValue={item.label}
          aria-current={item.id === header.nav?.activeId ? "page" : undefined}>
          {item.id === header.nav?.activeId && <Icon glyph={Check} decorative />}{item.label}
        </Menu.Item>)}
      </Menu> : <Tooltip trigger={<SemanticContent as="h1" ref={title} tabIndex={0} className="m-0 max-w-full truncate text-body font-semibold">{header.title}</SemanticContent>}>{header.title}</Tooltip>}
    </SemanticContent>
    <nav ref={nav} aria-label={header.nav?.label} aria-hidden={overflow.compactNav || undefined} inert={overflow.compactNav}
      className={(overflow.compactNav ? (embedded ? "invisible pointer-events-none " : "invisible pointer-events-none absolute ") : "") + "flex w-max min-w-0 items-center justify-center gap-xs"}
      style={embedded && overflow.compactNav ? { gridColumn: "1 / -1", gridRow: 2, blockSize: 0, inlineSize: 0, overflow: "hidden" } : undefined}>
      {header.nav?.items.map(item => {
        const selected = item.id === header.nav?.activeId;
        return <Link key={item.id} href={item.href} onClick={event => frameLinkNavigation(event, onNavigate)} aria-current={selected ? "page" : undefined} data-selected={selected || undefined} buttonVariant="ghost"
          className={"whitespace-nowrap border-b-2 " + (selected ? "border-accent text-ink-primary" : "border-transparent")} style={TAP}>{item.label}</Link>;
      })}
    </nav>
    <SemanticContent as="div" ref={actions} style={embedded ? { gridColumn: "-2 / -1", gridRow: 1 } : undefined} className="flex min-w-0 items-center justify-self-end" data-frame-header-actions="">{header.actions?.render({ compact: overflow.compactActions })}</SemanticContent>
  </SemanticContent>;
}
