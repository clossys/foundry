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
import { getAppNavigationAncestry, type AppNavigationNode } from "./app-navigation-tree.js";

export interface AppNavigationProps {
  tree: readonly AppNavigationNode[];
  activeId?: string;
  activeHref?: string;
  label?: string;
  footer?: ReactNode;
  emptyMessage?: ReactNode;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  navigationKey?: string;
  dismissAt?: string;
  openLabel?: string;
  closeLabel?: string;
}

const CONTROL = "flex min-w-0 items-center gap-sm rounded-control px-sm py-sm text-start text-ink-primary no-underline hover:no-underline hover:bg-surface-sunken focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

/** Host routes and identity arrive as data and slots; one Drawer owns the narrow modal lifecycle. */
export function AppNavigation({
  tree, activeId, activeHref, label = "Navigation", footer, emptyMessage = "No destinations available",
  collapsed: suppliedCollapsed, defaultCollapsed = false, onCollapsedChange,
  drawerOpen, onDrawerOpenChange, navigationKey, dismissAt = "(min-width: 768px)",
  openLabel = "Open navigation", closeLabel = "Close navigation",
}: AppNavigationProps) {
  const ancestry = getAppNavigationAncestry(tree, { id: activeId, href: activeHref });
  const active = ancestry.at(-1)?.id;
  const ancestor = ancestry.length > 1 ? ancestry[0]?.id : undefined;
  const [expanded, setExpanded] = useState(() => new Set(ancestor ? [ancestor] : []));
  const [internalCollapsed, setCollapsed] = useState(defaultCollapsed);
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const collapsed = !narrow && (suppliedCollapsed ?? internalCollapsed);
  const nav = useRef<HTMLElement>(null);
  const focusedId = useRef<string | undefined>(undefined);
  const handoff = useRef(false);
  const latest = useRef({ onDrawerOpenChange, active, requested: drawerOpen ?? open });
  latest.current = { onDrawerOpenChange, active, requested: drawerOpen ?? open };
  const instance = useId();
  const route = JSON.stringify([navigationKey, activeId, activeHref]);
  const changeOpen = (next: boolean) => { setOpen(next); latest.current.onDrawerOpenChange?.(next); };

  useEffect(() => {
    if (ancestor) setExpanded(previous => new Set([...previous, ancestor]));
  }, [ancestor, active]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(dismissAt);
    const sync = () => {
      const surface = nav.current?.closest('[role="dialog"]') ?? nav.current;
      handoff.current = Boolean(surface?.contains(document.activeElement));
      setNarrow(!query.matches);
      if (query.matches && latest.current.requested) changeOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [dismissAt]);
  useEffect(() => {
    if (!focusedId.current && !handoff.current) return;
    const id = focusedId.current ?? latest.current.active;
    const frame = requestAnimationFrame(() => {
      const destination = [...(nav.current?.querySelectorAll<HTMLElement>("[data-app-navigation-control]") ?? [])]
        .find(element => element.dataset.nodeId === id);
      (destination ?? nav.current?.querySelector<HTMLElement>("[data-app-navigation-control]") ??
        document.getElementById(`${instance}-trigger`))?.focus();
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
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-app-navigation-control]")];
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-app-navigation-control]");
    if (!target) return;
    const index = controls.indexOf(target);
    const movement = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 :
      event.key === "ArrowDown" ? Math.min(index + 1, controls.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : undefined;
    if (movement !== undefined) { event.preventDefault(); controls[movement]?.focus(); return; }
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl" || event.currentTarget.closest('[dir="rtl"]') !== null;
    const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight");
    const backward = event.key === (rtl ? "ArrowRight" : "ArrowLeft");
    const parent = tree.find(node => node.id === (target.dataset.parentId ?? target.dataset.nodeId));
    if ((forward || backward) && parent?.children?.length && !collapsed) {
      event.preventDefault();
      if (backward) controls.find(element => element.dataset.nodeId === parent.id)?.focus();
      toggle(parent.id, forward);
    }
    if (event.key === " " && target.tagName === "A") { event.preventDefault(); target.click(); }
  };
  const destination = (node: AppNavigationNode, parentId?: string) => {
    const current = node.id === active;
    const className = cx(CONTROL, "flex-1", collapsed && "justify-center px-0", current &&
      "bg-control-tonal font-semibold outline-solid outline-1 outline-line-strong forced-colors:outline-current");
    const content = <><span aria-hidden="true" className="flex shrink-0 items-center justify-center" style={{ inlineSize: "var(--ui-icon-md, 24px)" }}>{node.icon ?? node.label.slice(0, 1)}</span>
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{node.label}</span></>;
    const shared = { "data-app-navigation-control": "", "data-node-id": node.id, "data-parent-id": parentId,
      "aria-current": current ? "page" as const : undefined, className, style: { minBlockSize: "var(--ui-layout-tap-target, 44px)" } };
    const control = node.href !== undefined ? <Link {...shared} variant="muted" href={node.href}>{content}</Link> :
      <Button {...shared} variant="ghost" onPress={() => { node.onAction?.(); if (narrow) changeOpen(false); }}>{content}</Button>;
    return collapsed ? <Tooltip delay={0} placement="end" trigger={control}>{node.label}</Tooltip> : control;
  };
  const footerRegion = footer !== undefined && footer !== null && footer !== false ?
    <div data-app-navigation-region="footer" className="min-w-0 shrink-0 border-t border-line-base pt-sm">{footer}</div> : undefined;
  const links = <nav ref={nav} aria-label={label} className="flex h-full min-h-0 flex-col" onKeyDown={keyboard}
    onFocus={event => { focusedId.current = (event.target as HTMLElement).closest<HTMLElement>("[data-node-id]")?.dataset.nodeId; }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusedId.current = undefined; }}>
    <div data-app-navigation-region="links" className="min-h-0 flex-1 overflow-auto">
      {!tree.length ? <p className="p-sm text-body text-ink-muted">{emptyMessage}</p> :
        <ul className="flex flex-col gap-xs">{tree.map(node => {
          const children = node.children ?? [];
          const isExpanded = expanded.has(node.id);
          const panelId = `${instance}-${encodeURIComponent(node.id)}`;
          return <li key={node.id} data-active-ancestor={node.id === ancestor ? "true" : undefined}>
            <div className={cx("flex min-w-0 items-center gap-xs rounded-control", node.id === ancestor && "bg-control-tonal")}>
              {(node.href !== undefined || node.onAction) && destination(node)}
              {children.length > 0 && !collapsed && <Button variant="ghost" className={cx(CONTROL, "shrink-0", !node.href && !node.onAction && "flex-1")}
                style={{ minBlockSize: "var(--ui-layout-tap-target, 44px)", minInlineSize: "var(--ui-layout-tap-target, 44px)" }}
                data-app-navigation-control="" data-node-id={node.id}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.label}`} aria-expanded={isExpanded} aria-controls={panelId}
                onPress={() => toggle(node.id)}>
                {!node.href && !node.onAction && <span className="min-w-0 flex-1 truncate">{node.label}</span>}
                <Icon glyph={ChevronDown} decorative size="sm" className={isExpanded ? "rotate-180" : undefined} />
              </Button>}
            </div>
            {children.length > 0 && <ul id={panelId} className={cx("flex flex-col gap-xs", !collapsed && "ms-md border-s border-line-base ps-sm", !collapsed && !isExpanded && "hidden")}
              hidden={!collapsed && !isExpanded}>
              {(collapsed || isExpanded) && children.map(child => <li key={child.id}>{destination(child, node.id)}</li>)}
            </ul>}
          </li>;
        })}</ul>}
    </div>
  </nav>;
  if (narrow) return <Drawer trigger={<Button id={`${instance}-trigger`} variant="ghost">{openLabel}</Button>}
    heading={label} closeLabel={closeLabel} footer={footerRegion} navigationKey={route} dismissAt={dismissAt}
    isOpen={drawerOpen ?? open} onOpenChange={changeOpen} className="gap-xs p-sm">{links}</Drawer>;
  return <Panel className="h-full min-h-0 shrink-0 gap-xs rounded-none border-0 p-sm"
    style={{ inlineSize: collapsed ? "var(--ui-layout-sidebar-rail-w, 64px)" : "var(--ui-layout-sidebar-w, 256px)" }}
    header={<div className="flex min-w-0 items-center justify-between gap-xs">
      <span className={collapsed ? "sr-only" : "min-w-0 truncate text-body font-semibold"}>{label}</span>
      <Button variant="ghost" className="icon-control-md shrink-0 p-0" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        onPress={() => { setCollapsed(!collapsed); onCollapsedChange?.(!collapsed); }}>
        <Icon glyph={collapsed ? ChevronRight : ChevronLeft} decorative size="sm" className="rtl:rotate-180" />
      </Button>
    </div>} footer={footerRegion}>{links}</Panel>;
}
