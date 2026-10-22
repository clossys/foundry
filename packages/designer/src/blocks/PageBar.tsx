"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { Icon } from "../atoms/Icon.js";
import { Link } from "../atoms/Link.js";
import { Menu } from "../atoms/Menu.js";
import { Popover } from "../atoms/Popover.js";
import { Box } from "../icons/Box.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ExternalLink } from "../icons/ExternalLink.js";
import { CONTROL, TAP, PAGE_BAR_LAYOUT, pageBarDirection } from "./page-bar-layout.js";

export type PageBarWidth = "contained" | "full";
export interface PageBarDestination { id: string; label: string; href: string }
export interface PageBarCrumb {
  id: string;
  label: string;
  href?: string;
  /** Alternatives at this level, rendered with the existing Menu atom. */
  siblings?: readonly PageBarDestination[];
}
export type PageBarAction = { id: string; label: string; primary?: boolean; isDisabled?: boolean } & (
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
  /** Carried for AppFrame's page default; PageBar renders its explicit width prop. */
  width?: PageBarWidth;
}
export interface PageBarLabels {
  breadcrumb: string;
  collapsedBreadcrumb: string;
  pageInfo: string;
  fullWidth: string;
  containedWidth: string;
  pageActions: string;
}
export interface PageBarProps {
  /** Trail root: a link or, with workspaces, a menu labelled by root.label. */
  root: { label: string; href?: string };
  width: PageBarWidth;
  onWidthChange: (width: PageBarWidth) => void;
  labels: PageBarLabels;
  /** Absent: brand slot and width control, without a trail. */
  page?: PageBarPage;
  workspaces?: readonly PageBarDestination[];
  /** Leading slot before the trail; AppFrame supplies its own brand renderer. */
  brand?: ReactNode;
  /** Collapse ancestors and overflow non-primary actions. @default false */
  narrow?: boolean;
  /** Reserve a tap target plus gap at the inline start. @default false */
  reserveStart?: boolean;
  /** Reserve a tap target plus gap at the inline end. @default false */
  reserveEnd?: boolean;
  dir?: "ltr" | "rtl";
  onHeightChange?: (height: number) => void;
}

function PageAction({ label, href, onAction, isDisabled, primary }: PageBarAction) {
  return href !== undefined
    ? <Link href={href} buttonVariant={primary ? "primary" : "ghost"} isDisabled={isDisabled} className="min-w-0 max-w-full"
        data-application-frame-action={primary ? "primary" : "secondary"}><span className="min-w-0 truncate">{label}</span></Link>
    : <Button variant={primary ? "primary" : "ghost"} onPress={onAction} isDisabled={isDisabled} className="min-w-0 max-w-full"
        data-application-frame-action={primary ? "primary" : "secondary"}><span className="min-w-0 truncate">{label}</span></Button>;
}

function CrumbMenu({ label, href, id, siblings }: PageBarCrumb) {
  return <Menu trigger={<Button variant="ghost" className={CONTROL + " min-w-0 gap-xs"} style={TAP}><span className="truncate">{label}</span><Icon glyph={ChevronDown} decorative size="sm" /></Button>}>
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
      <li className="min-w-0 shrink-0">
        {workspaces?.length ? <CrumbMenu id="workspace" label={root.label} siblings={workspaces} /> :
          <Link href={root.href} variant="standalone" className={CONTROL} style={TAP}>{root.label}</Link>}
      </li>
      {narrow && ancestors.length > 0
        ? <li className="shrink-0"><Menu trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={collapsedBreadcrumbLabel}><span aria-hidden="true">...</span></Button>}>
            {ancestors.map(item => <Menu.Section key={item.id} heading={item.label}>
              <Menu.Item id={JSON.stringify([item.id])} href={item.href}>{item.label}</Menu.Item>
              {item.siblings?.map(sibling => <Menu.Item key={sibling.id} id={JSON.stringify([item.id, sibling.id])} href={sibling.href}>{sibling.label}</Menu.Item>)}
            </Menu.Section>)}
          </Menu></li>
        : ancestors.map(item => <li key={item.id} className="min-w-0 shrink-0">
            {item.siblings?.length ? <CrumbMenu {...item} /> : <Link href={item.href} variant="standalone" className={CONTROL} style={TAP}>{item.label}</Link>}
          </li>)}
      <li className="min-w-0 flex-1">
        <h1 aria-current="page" className="m-0 truncate text-body font-semibold">{title}</h1>
        {current?.siblings?.length ? <CrumbMenu {...current} /> : null}
      </li>
    </ol>
  </nav>;
}

/** Draft standalone page trail, metadata, actions and stage-width controls. */
export function PageBar({ root, brand, page, workspaces, width, onWidthChange, labels, narrow = false, reserveStart = false, reserveEnd = false, onHeightChange, dir }: PageBarProps) {
  const { pageInfo: pageInfoLabel, fullWidth: fullWidthLabel, containedWidth: containedWidthLabel, pageActions: pageActionsLabel } = labels;
  const bar = useRef<HTMLElement>(null);
  const [glass, setGlass] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [barWidth, setBarWidth] = useState<number>();
  const [direction, setDirection] = useState(dir);
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
      setDirection(dir ?? pageBarDirection(bar.current));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    if (bar.current) observer?.observe(bar.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [dir, onHeightChange, page, narrow, width, infoOpen]);
  const primary = page?.actions?.find(action => action.primary);
  const information = page && [page.status, page.description, page.updatedAt, page.meta, page.scope].some(value => value !== undefined && value !== null && value !== false);
  return <header ref={bar} data-application-frame-region="bar" className={"relative flex min-w-0 flex-wrap items-center gap-xs rounded-control border border-line-base p-sm text-ink-primary " + (glass ? "bg-surface-glass" : "bg-surface-raised")}
    style={{ position: "sticky", insetBlockStart: PAGE_BAR_LAYOUT.gutter, marginBlockStart: PAGE_BAR_LAYOUT.gutter, marginInline: PAGE_BAR_LAYOUT.gutter,
      paddingInlineStart: reserveStart ? `calc(${PAGE_BAR_LAYOUT.tap} + ${PAGE_BAR_LAYOUT.gap})` : PAGE_BAR_LAYOUT.gap,
      paddingInlineEnd: reserveEnd ? `calc(${PAGE_BAR_LAYOUT.tap} + ${PAGE_BAR_LAYOUT.gap})` : PAGE_BAR_LAYOUT.gap,
      backdropFilter: glass ? PAGE_BAR_LAYOUT.blur : "none", WebkitBackdropFilter: glass ? PAGE_BAR_LAYOUT.blur : "none", zIndex: PAGE_BAR_LAYOUT.barLayer }}>
    {brand}
    {page && <PageTrail root={root} title={page.title} breadcrumb={page.breadcrumb} workspaces={workspaces} narrow={narrow} labels={labels} />}
    {information && <Popover anchorRef={bar} className="text-body text-ink-primary" aria-label={pageInfoLabel} placement="bottom start" offset={0} isOpen={infoOpen} onOpenChange={setInfoOpen}
      trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={pageInfoLabel} aria-expanded={infoOpen}><Icon glyph={ChevronDown} decorative className={infoOpen ? "rotate-180" : undefined} /></Button>}
      style={{ direction, inlineSize: barWidth, maxInlineSize: `calc(100vw - 2 * ${PAGE_BAR_LAYOUT.gutter})` }}>
      <div data-application-frame-region="page-info" className="flex flex-wrap items-start gap-sm">
        <div>{page?.status}</div><div>{page?.description}</div><div>{page?.updatedAt}</div><div>{page?.meta}</div><div>{page?.scope}</div>
      </div>
    </Popover>}
    <div data-application-frame-region="bar-actions" className="ms-auto flex min-w-0 items-center justify-end gap-xs" style={{ flexBasis: narrow ? "100%" : undefined }}>
      {page?.actions?.map(action => (!narrow || action === primary) && <PageAction key={action.id} {...action} primary={action === primary} />)}
      {narrow && page?.actions?.some(action => action !== primary) && <Menu trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={pageActionsLabel}><Icon glyph={ChevronDown} decorative /></Button>}>
        {page.actions.filter(action => action !== primary).map(action => <Menu.Item key={action.id} id={action.id} href={action.href} isDisabled={action.isDisabled} onAction={action.onAction}>{action.label}</Menu.Item>)}
      </Menu>}
      <div className="ms-xs shrink-0 border-s border-line-base ps-xs">
        {width === "full" ? <Button variant="ghost" className={CONTROL} style={TAP} aria-label={containedWidthLabel} aria-pressed={true} onPress={() => onWidthChange("contained")}><Icon glyph={Box} decorative /></Button> :
          <Button variant="ghost" className={CONTROL} style={TAP} aria-label={fullWidthLabel} aria-pressed={false} onPress={() => onWidthChange("full")}><Icon glyph={ExternalLink} decorative /></Button>}
      </div>
    </div>
  </header>;
}
