import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { Icon } from "../atoms/Icon.js";
import { Link } from "../atoms/Link.js";
import { Tooltip } from "../atoms/Tooltip.js";
import { cx } from "../atoms/internal/cx.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { Drawer } from "./Drawer.js";
import { Panel } from "./Panel.js";
import { getAppNavigationCloseStyle } from "./app-navigation-layout.js";
import { getAppNavigationAncestry, type AppNavigationNode } from "./app-navigation-tree.js";

export interface AppNavigationProps {
  tree: readonly AppNavigationNode[];
  activeId?: string;
  activeHref?: string;
  /** @default "Navigation" */
  label?: string;
  /** Host controls before the destination list; no title row is synthesized. */
  header?: ReactNode;
  footer?: ReactNode;
  /** Optional host-owned corner control; wire its press to the controlled panel state. */
  trigger?: ReactNode;
  /** @default "No destinations available" */
  emptyMessage?: ReactNode;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  navigationKey?: string;
  /** @default "(min-width: 768px)" */
  dismissAt?: string;
  /** @default "Open navigation" */
  openLabel?: string;
  /** @default "Close navigation" */
  closeLabel?: string;
  /** Optional legacy label alias for the wide open control. */
  expandLabel?: string;
  /** Optional legacy label alias for the wide close control. */
  collapseLabel?: string;
  /** @default "Collapse {nodeLabel}" when expanded, "Expand {nodeLabel}" otherwise */
  formatDisclosureLabel?: (nodeLabel: string, expanded: boolean) => string;
}

function defaultDisclosureLabel(nodeLabel: string, expanded: boolean): string {
  return (expanded ? "Collapse " : "Expand ") + nodeLabel;
}

const CONTROL = "flex min-w-0 items-center justify-start gap-sm rounded-control border-0 bg-transparent px-sm py-sm text-start text-ink-primary no-underline hover:no-underline hover:bg-surface-sunken focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2";

/** Keep the overlay absent until the browser has completed focus-induced scrolling. */
function CornerTooltip({ trigger, label, requests }: { trigger: ReactNode; label: string; requests: { current: number } }) {
  const [open, setOpen] = useState(false);
  const frame = useRef<number | undefined>(undefined);
  const cancel = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  };
  const close = () => { cancel(); setOpen(false); };
  const change = (next: boolean) => {
    cancel();
    if (!next) { setOpen(false); return; }
    const ticket = ++requests.current;
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (ticket === requests.current) setOpen(true);
      });
    });
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => { ++requests.current; cancel(); setOpen(false); }, [label, requests]);
  return <span className="contents" onBlurCapture={close} onPointerDownCapture={close}
    onPointerOutCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancel(); }}
    onKeyDownCapture={event => { if (["Escape", "Enter", " "].includes(event.key)) close(); }}>
    <Tooltip trigger={trigger} delay={0} placement="end" isOpen={open} onOpenChange={change}>{label}</Tooltip>
  </span>;
}

/** Host routes and identity arrive as data and slots; one Drawer owns the narrow modal lifecycle. */
export function AppNavigation({
  tree, activeId, activeHref, label = "Navigation", header, footer, trigger, emptyMessage = "No destinations available",
  collapsed: suppliedCollapsed, defaultCollapsed = false, onCollapsedChange,
  drawerOpen, onDrawerOpenChange, navigationKey, dismissAt = "(min-width: 768px)",
  openLabel = "Open navigation", closeLabel = "Close navigation", expandLabel, collapseLabel,
  /** @default "Collapse {nodeLabel}" when expanded, "Expand {nodeLabel}" otherwise */
  formatDisclosureLabel = defaultDisclosureLabel,
}: AppNavigationProps) {
  const ancestry = getAppNavigationAncestry(tree, { id: activeId, href: activeHref });
  const active = ancestry.at(-1)?.id;
  const ancestor = ancestry.length > 1 ? ancestry[0]?.id : undefined;
  const [expanded, setExpanded] = useState(() => new Set(ancestor ? [ancestor] : []));
  const [internalCollapsed, setCollapsed] = useState(defaultCollapsed);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const requested = (drawerOpen ?? open) && !dismissed;
  const collapsed = !narrow && (suppliedCollapsed ?? internalCollapsed);
  const nav = useRef<HTMLElement>(null);
  const corner = useRef<HTMLSpanElement>(null);
  const [cornerMeasurement, setCornerMeasurement] = useState<{ top: number; left: number; right: number; rtl: boolean }>();
  const customTrigger = trigger !== undefined;
  useEffect(() => {
    if (!narrow || !requested || !customTrigger) { setCornerMeasurement(undefined); return; }
    const measure = () => {
      const opener = corner.current?.querySelector<HTMLElement>("button, a");
      if (!opener) return;
      const rect = opener.getBoundingClientRect();
      const computed = getComputedStyle(opener).direction;
      const rtl = computed === "rtl" || (!computed && opener.closest<HTMLElement>("[dir]")?.dir === "rtl");
      setCornerMeasurement({ top: rect.top, left: rect.left, right: rect.right, rtl });
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [narrow, requested, customTrigger]);
  const focusedId = useRef<string | undefined>(undefined);
  const handoff = useRef(false);
  const tooltipRequests = useRef(0);
  const latest = useRef({ onDrawerOpenChange, active, requested });
  latest.current = { onDrawerOpenChange, active, requested };
  const instance = useId();
  const route = JSON.stringify([navigationKey, activeId, activeHref]);
  const changeOpen = (next: boolean) => { setOpen(next); setDismissed(!next); latest.current.onDrawerOpenChange?.(next); };

  useEffect(() => { if (drawerOpen === false) setDismissed(false); }, [drawerOpen]);
  useEffect(() => {
    if (ancestor) setExpanded(previous => new Set([...previous, ancestor]));
  }, [ancestor, active]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(dismissAt);
    const sync = () => {
      const surface = nav.current?.closest("[role=dialog]") ?? nav.current?.closest("[data-panel]") ?? nav.current;
      handoff.current = Boolean(surface?.contains(document.activeElement));
      setNarrow(!query.matches);
      if (query.matches && latest.current.requested) changeOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [dismissAt, drawerOpen]);
  useEffect(() => {
    if (!focusedId.current && !handoff.current) return;
    const id = focusedId.current ?? latest.current.active;
    const frame = requestAnimationFrame(() => {
      const destination = [...(nav.current?.querySelectorAll<HTMLElement>("[data-application-navigation-control]") ?? [])]
        .find(element => element.dataset.navigationNodeId === id);
      (destination ?? nav.current?.querySelector<HTMLElement>("[data-application-navigation-control]") ??
        document.getElementById(instance + "-trigger")?.querySelector<HTMLElement>("button, a"))?.focus();
      handoff.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, narrow, instance]);

  const toggle = (id: string, next?: boolean) => setExpanded(previous => {
    const result = new Set(previous);
    if (next ?? !result.has(id)) result.add(id); else result.delete(id);
    return result;
  });
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-application-navigation-control]")];
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-application-navigation-control]");
    if (!target) return;
    const index = controls.indexOf(target);
    const movement = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 :
      event.key === "ArrowDown" ? Math.min(index + 1, controls.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : undefined;
    if (movement !== undefined) { event.preventDefault(); controls[movement]?.focus(); return; }
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl" || event.currentTarget.closest("[dir=rtl]") !== null;
    const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight");
    const backward = event.key === (rtl ? "ArrowRight" : "ArrowLeft");
    const parent = tree.find(node => node.id === (target.dataset.parentId ?? target.dataset.navigationNodeId));
    if ((forward || backward) && parent?.children?.length && !collapsed) {
      event.preventDefault();
      if (backward) controls.find(element => element.dataset.navigationNodeId === parent.id)?.focus();
      toggle(parent.id, forward);
    }
    if (event.key === " " && target.tagName === "A") { event.preventDefault(); target.click(); }
  };
  const destination = (node: AppNavigationNode, parentId?: string) => {
    const current = node.id === active;
    const className = cx(CONTROL, "flex-1", current &&
      "bg-control-tonal font-semibold outline-solid outline-1 outline-line-strong forced-colors:outline-current");
    const content = <><span aria-hidden="true" className="flex shrink-0 items-center justify-center" style={{ inlineSize: "var(--ui-icon-md, 24px)" }}>{node.icon ?? node.label.slice(0, 1)}</span>
      <span className="min-w-0 truncate">{node.label}</span></>;
    const shared = { "data-application-navigation-control": "", "data-navigation-node-id": node.id, "data-parent-id": parentId,
      "aria-current": current ? "page" as const : undefined, className, style: { minBlockSize: "var(--ui-layout-tap-target, 44px)" } };
    const control = node.href !== undefined ? <Link {...shared} variant="muted" href={node.href}>{content}</Link> :
      <Button {...shared} variant="ghost" onPress={() => { node.onAction?.(); if (narrow) changeOpen(false); }}>{content}</Button>;
    return control;
  };
  const footerRegion = footer !== undefined && footer !== null && footer !== false ?
    <div data-application-navigation-region="footer" className="min-w-0 shrink-0 border-t border-line-base pt-sm">{footer}</div> : undefined;
  const links = <nav ref={nav} aria-label={label} className="flex h-full min-h-0 flex-col" onKeyDown={keyboard}
    onFocus={event => { focusedId.current = (event.target as HTMLElement).closest<HTMLElement>("[data-navigation-node-id]")?.dataset.navigationNodeId; }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusedId.current = undefined; }}>
    {header !== undefined && header !== null && header !== false && <div data-application-navigation-region="header" className="min-w-0 shrink-0 pb-sm">{header}</div>}
    <div data-application-navigation-region="links" className="min-h-0 flex-1 overflow-auto">
      {!tree.length ? <p className="p-sm text-body text-ink-muted">{emptyMessage}</p> :
        <ul className="m-0 flex list-none flex-col gap-xs p-0">{tree.map(node => {
          const children = node.children ?? [];
          const isExpanded = expanded.has(node.id);
          const panelId = instance + "-" + encodeURIComponent(node.id);
          return <li key={node.id} data-active-ancestor={node.id === ancestor ? "true" : undefined}>
            <div className={cx("flex min-w-0 items-center gap-xs rounded-control", node.id === ancestor && "bg-control-tonal")}>
              {(node.href !== undefined || node.onAction) && destination(node)}
              {children.length > 0 && <Button variant="ghost" className={cx(CONTROL, "shrink-0", node.href || node.onAction ? "justify-center" : "flex-1")}
                style={{ minBlockSize: "var(--ui-layout-tap-target, 44px)", minInlineSize: "var(--ui-layout-tap-target, 44px)" }}
                data-application-navigation-control="" data-navigation-node-id={node.id}
                aria-label={formatDisclosureLabel(node.label, isExpanded)} aria-expanded={isExpanded} aria-controls={panelId}
                onPress={() => toggle(node.id)}>
                {!node.href && !node.onAction && <span className="min-w-0 flex-1 truncate">{node.label}</span>}
                <Icon glyph={ChevronDown} decorative size="sm" className={isExpanded ? "rotate-180" : undefined} />
              </Button>}
            </div>
            {children.length > 0 && <ul id={panelId} className={cx("m-0 flex list-none flex-col gap-xs p-0", "ms-md border-s border-line-base ps-sm", !isExpanded && "hidden")}
              hidden={!isExpanded}>
              {isExpanded && children.map(child => <li key={child.id}>{destination(child, node.id)}</li>)}
            </ul>}
          </li>;
        })}</ul>}
    </div>
    {footerRegion}
  </nav>;
  const changeCollapsed = () => { setCollapsed(!collapsed); onCollapsedChange?.(!collapsed); };
  const wideControl = collapsed
    ? expandLabel === undefined
      ? <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={false} aria-label={openLabel} onPress={changeCollapsed}><Icon glyph={ChevronRight} decorative size="sm" className="rtl:rotate-180" /></Button>
      : <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={false} aria-label={expandLabel} onPress={changeCollapsed}><Icon glyph={ChevronRight} decorative size="sm" className="rtl:rotate-180" /></Button>
    : collapseLabel === undefined
      ? <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={true} aria-label={closeLabel} onPress={changeCollapsed}><Icon glyph={ChevronLeft} decorative size="sm" className="rtl:rotate-180" /></Button>
      : <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={true} aria-label={collapseLabel} onPress={changeCollapsed}><Icon glyph={ChevronLeft} decorative size="sm" className="rtl:rotate-180" /></Button>;
  const control = <span ref={corner} id={instance + "-trigger"} className="contents">{trigger ?? (narrow
    ? <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={requested} aria-label={openLabel}><Icon glyph={ChevronRight} decorative size="sm" className="rtl:rotate-180" /></Button>
    : collapsed
      ? <CornerTooltip trigger={wideControl} label={openLabel} requests={tooltipRequests} />
      : <CornerTooltip trigger={wideControl} label={closeLabel} requests={tooltipRequests} />)}</span>;
  if (narrow) return <Drawer trigger={control}
    heading={<span className="sr-only">{label}</span>} closeLabel={closeLabel} closeButtonStyle={getAppNavigationCloseStyle(cornerMeasurement)} navigationKey={route} dismissAt={dismissAt}
    isOpen={requested} onOpenChange={changeOpen} className="gap-xs p-sm">{links}</Drawer>;
  return <>{control}{!collapsed && <Panel className="h-full min-h-0 shrink-0 gap-xs rounded-none border-0 p-sm"
    style={{ inlineSize: "var(--ui-layout-sidebar-w, 256px)" }}>{links}</Panel>}</>;
}
