import { ModalContext, useLocale } from "react-aria-components";
import { cloneElement, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../selected-components/Button.js";
import { Icon } from "../selected-components/Icon.js";
import { Link } from "../selected-components/Link.js";
import { useShellCopy } from "../selected-components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../selected-components/Banner.copy.js";
import { NavigationTree, NavigationTreeItem, NavigationTreeItemContent } from "../selected-components/NavigationTree.js";
import { Tooltip } from "../selected-components/Tooltip.js";
import { cx } from "../selected-components/internal/cx.js";
import { FileText } from "../icons/FileText.js";
import { Folder } from "../icons/Folder.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { ChevronLeft } from "../icons/ChevronLeft.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { frameLinkNavigation, type FrameNavigate } from "./frame-navigation.js";
import { Drawer } from "./Drawer.js";
import { Panel } from "./Panel.js";
import { getAppNavigationCloseStyle } from "./app-navigation-layout.js";
import { getAppNavigationAncestry, type AppNavigationNode } from "./app-navigation-tree.js";

export interface AppNavigationProps {
  tree: readonly AppNavigationNode[];
  onNavigate?: FrameNavigate;
  /** Use the full modal viewport for narrow page navigation. */
  fullViewport?: boolean;
  /** Keep docked contents mounted while their frame region slides closed. */
  retainMounted?: boolean;
  activeId?: string;
  activeHref?: string;
  /** Omitted means resolve the navigation name through the host Writer seam. */
  label?: string;
  /** Host controls before the destination list; no title row is synthesized. */
  header?: ReactNode;
  footer?: ReactNode;
  /** Optional host-owned corner control; wire its press to the controlled panel state. */
  trigger?: ReactNode;
  /** Optional DOM host for the complete measured control, retaining its dialog context and ref. */
  triggerContainer?: Element | null;
  /** Omitted means resolve the empty-state Writer reference. Host-owned reason/action remains separate. */
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
  /** Omitted means pass the host node name to Writer's disclosure reference. */
  formatDisclosureLabel?: (nodeLabel: string, expanded: boolean) => string;
}


/** The disclosure chevron turns on the theme's default transition duration (bound to --ui-duration-fast) and snaps under reduced motion. */
const CHEVRON_MOTION = "transition-transform motion-reduce:transition-none";
const CONTROL = "flex min-w-0 items-center justify-start gap-sm rounded-control border-0 bg-transparent px-sm py-sm text-start text-ink-primary no-underline hover:no-underline hover:bg-control-tonal-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2";

/*
 * A destination's icon sits in a small-icon slot (`--ui-icon-sm`, 16px) and a
 * package `Icon` is drawn at the small step, so every row's glyph matches
 * whatever size the caller built it at. The current destination takes the
 * selected surface and an inline-start accent edge (the edge keeps a
 * transparent width at rest so the label never shifts); forced colours draw
 * an outline instead, because neither paint survives there.
 */
const ICON_SLOT = { inlineSize: "var(--ui-icon-sm, var(--spacing-lg, 16px))" } as const;
const CURRENT = "bg-surface-selected font-medium border-s-accent forced-colors:outline-solid forced-colors:outline-1 forced-colors:outline-current";
function smallIcon(icon: ReactNode): ReactNode {
  return isValidElement(icon) && icon.type === Icon ? cloneElement(icon as ReactElement<{ size?: string }>, { size: "sm" }) : icon;
}

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
export function AppNavigation({ onNavigate, fullViewport = false, retainMounted = false,
  tree, activeId, activeHref, label: suppliedLabel, header, footer, trigger, triggerContainer, emptyMessage: suppliedEmptyMessage,
  collapsed: suppliedCollapsed, defaultCollapsed = false, onCollapsedChange,
  drawerOpen, onDrawerOpenChange, navigationKey, dismissAt = "(min-width: 768px)",
  openLabel: suppliedOpenLabel, closeLabel: suppliedCloseLabel, expandLabel, collapseLabel,
  /** Writer owns the omitted formatter's wording and interpolation. */
  formatDisclosureLabel: suppliedDisclosureLabel,
}: AppNavigationProps) {
  const copy = useShellCopy();
  const label = suppliedLabel ?? copy(SHELL_COPY_REFS.navigation.label);
  const emptyMessage = suppliedEmptyMessage ?? copy(SHELL_COPY_REFS.navigation.empty);
  const openLabel = suppliedOpenLabel ?? copy(SHELL_COPY_REFS.frame.navigationOpen);
  const closeLabel = suppliedCloseLabel ?? copy(SHELL_COPY_REFS.frame.navigationClose);
  const formatDisclosureLabel = suppliedDisclosureLabel ?? ((nodeLabel: string, expanded: boolean) => copy(expanded ? SHELL_COPY_REFS.navigation.collapse : SHELL_COPY_REFS.navigation.expand, { name: nodeLabel }));
  const { direction: localeDirection } = useLocale();
  // AppFrame supplies its explicit direction override through the existing modal context.
  const modalContext = useContext(ModalContext);
  const modalStyle = modalContext && "style" in modalContext ? modalContext.style : undefined;
  const modalDirection = typeof modalStyle === "object" ? modalStyle?.direction : undefined;
  const direction = modalDirection === "ltr" || modalDirection === "rtl" ? modalDirection : localeDirection;
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
      const rtl = direction === "rtl";
      setCornerMeasurement({ top: rect.top, left: rect.left, right: rect.right, rtl });
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [narrow, requested, customTrigger, trigger, triggerContainer, direction]);
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

  const destination = (node: AppNavigationNode, parentId?: string) => {
    const current = node.id === active;
    const className = cx(CONTROL, "control-h-md flex-1", current ? CURRENT : "border-s-transparent");
    const content = <><span aria-hidden="true" className="flex shrink-0 items-center justify-center" style={ICON_SLOT}>{node.icon == null || typeof node.icon === "string" || typeof node.icon === "number" ? <Icon glyph={node.children?.length ? Folder : FileText} decorative size="sm" /> : smallIcon(node.icon)}</span>
      <span className="min-w-0 truncate">{node.label}</span></>;
    const shared = { "data-application-navigation-control": "", "data-navigation-node-id": node.id, "data-parent-id": parentId,
      "aria-current": current ? "page" as const : undefined, style: { borderInlineStartWidth: "var(--ui-border-rule)" }, className };
    return node.href !== undefined ? <Link {...shared} variant="muted" href={node.href} onClick={event => frameLinkNavigation(event, onNavigate)}>{content}</Link> :
      <Button {...shared} variant="ghost" onPress={() => { node.onAction?.(); if (narrow) changeOpen(false); }}>{content}</Button>;
  };
  const item = (node: AppNavigationNode, parentId?: string): ReactNode => {
    const children = node.children ?? [];
    return <NavigationTreeItem key={node.id} id={node.id} textValue={node.label} href={node.href}
      data-navigation-node-id={node.id}
      data-active-ancestor={node.id === ancestor ? "true" : undefined}
      className={cx("min-w-0 rounded-control data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-accent data-focus-visible:-outline-offset-2", parentId && "ms-md border-s border-line-base ps-sm")}>
      <NavigationTreeItemContent>{({ isExpanded }) =>
        <div className="flex min-w-0 items-center gap-xs rounded-control">
          {(node.href !== undefined || node.onAction) && destination(node, parentId)}
          {children.length > 0 && <Button slot="chevron" variant="ghost"
            className={cx(CONTROL, "shrink-0", node.href || node.onAction ? "icon-control-md justify-center" : "control-h-md flex-1")}
            data-application-navigation-control="" data-navigation-node-id={node.id}
            aria-label={formatDisclosureLabel(node.label, isExpanded)} aria-labelledby="" aria-expanded={isExpanded}>
            {!node.href && !node.onAction && <span className="min-w-0 flex-1 truncate">{node.label}</span>}
            <Icon glyph={ChevronDown} decorative size="sm" className={cx(CHEVRON_MOTION, isExpanded && "rotate-180")} />
          </Button>}
        </div>
      }</NavigationTreeItemContent>
      {children.map(child => item(child, node.id))}
    </NavigationTreeItem>;
  };
  const footerRegion = footer !== undefined && footer !== null && footer !== false ?
    <div data-application-navigation-region="footer" className="min-w-0 shrink-0 border-t border-line-base pt-sm">{footer}</div> : undefined;
  const links = <nav ref={nav} aria-label={label} className="flex h-full min-h-0 flex-col" onClick={event => frameLinkNavigation(event, onNavigate)}
    onFocus={event => { focusedId.current = (event.target as HTMLElement).closest<HTMLElement>("[data-navigation-node-id]")?.dataset.navigationNodeId; }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusedId.current = undefined; }}>
    {header !== undefined && header !== null && header !== false && <div data-application-navigation-region="header" className="min-w-0 shrink-0 pb-sm">{header}</div>}
    <div data-application-navigation-region="links" className="min-h-0 flex-1 overflow-auto">
      {!tree.length ? <p className="p-sm text-body text-ink-muted">{emptyMessage}</p> :
        <NavigationTree aria-label={label} selectedRoute={ancestry.length ? ancestry.at(-1)?.href : activeHref}
          expandedKeys={expanded} onExpandedChange={keys => setExpanded(new Set([...keys].map(String)))}
          className="flex min-w-0 flex-col gap-xs outline-none">
          {tree.map(node => item(node))}
        </NavigationTree>}
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
  const measuredControl = <span ref={corner} id={instance + "-trigger"} className="contents">{trigger ?? (narrow
    ? <Button variant="ghost" className="icon-control-md shrink-0 border-0 bg-transparent p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={requested} aria-label={openLabel}><Icon glyph={ChevronRight} decorative size="sm" className="rtl:rotate-180" /></Button>
    : collapsed
      ? expandLabel === undefined
        ? <CornerTooltip trigger={wideControl} label={openLabel} requests={tooltipRequests} />
        : <CornerTooltip trigger={wideControl} label={expandLabel} requests={tooltipRequests} />
      : collapseLabel === undefined
        ? <CornerTooltip trigger={wideControl} label={closeLabel} requests={tooltipRequests} />
        : <CornerTooltip trigger={wideControl} label={collapseLabel} requests={tooltipRequests} />)}</span>;
  const control = triggerContainer ? createPortal(measuredControl, triggerContainer) : measuredControl;
  if (narrow) return <Drawer fullViewport={fullViewport} trigger={control}
    heading={<span className="sr-only">{label}</span>} closeLabel={closeLabel} closeButtonStyle={getAppNavigationCloseStyle(cornerMeasurement)} navigationKey={route} dismissAt={dismissAt}
    isOpen={requested} onOpenChange={changeOpen} className="gap-xs p-sm">{links}</Drawer>;
  return <>{control}{(!collapsed || retainMounted) && <Panel className="h-full min-h-0 shrink-0 gap-xs rounded-none border-0 p-sm"
    style={{ inlineSize: "var(--ui-layout-sidebar-w, 256px)" }}>{links}</Panel>}</>;
}
