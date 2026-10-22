"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ModalContext, PopoverContext } from "react-aria-components";
import { Button, Icon, Menu } from "@clossys/designer/atoms";
import { Layers, List, Search } from "@clossys/designer/icons";
import { AccountMenu, AppNavigation, PageBar, CommandMenu, Drawer, ResizablePane, useCommandMenuShortcut, type DrawerProps } from "@clossys/designer/blocks";
import { ThemeProvider, ThemeToggle } from "@clossys/designer/theme";
import { AppFrameBrand } from "./AppFrameBrand.js";
import { SiteSkipLink } from "./SkipLink.client.js";
import { APP_FRAME_ALWAYS_NARROW, APP_FRAME_ALWAYS_WIDE, APP_FRAME_LAYOUT, APP_FRAME_WIDE_QUERY, appFrameMainId, appFramePanels, appFrameCorner, appFrameDirection } from "./app-frame-layout.js";
import type { AppFrameAccount, AppFrameProps } from "./app-frame-types.js";

const CONTROL = "inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-sm text-body text-ink-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent forced-colors:border-current";
const TAP = { minBlockSize: "var(--ui-layout-tap-target, 44px)", minInlineSize: "var(--ui-layout-tap-target, 44px)" };

function SignedOutMenu({ sections, signedOutLabel, onRoute }: AppFrameAccount) {
  const populated = sections.filter(section => section.entries.length > 0);
  if (!signedOutLabel.trim()) throw new TypeError("AppFrame: signed-out label must be non-empty.");
  if (!populated.length) return <p className="m-0 px-sm py-sm text-body text-ink-secondary">{signedOutLabel}</p>;
  const itemKey = (section: string, entry: string) => JSON.stringify([section, entry]);
  return <Menu trigger={<Button variant="ghost" className={CONTROL + " w-full justify-start text-start"} style={TAP}>{signedOutLabel}</Button>}>
    {populated.map(section => <Menu.Section key={section.id} heading={section.label} aria-label={section.label ?? signedOutLabel}
      selectionMode={section.kind === "preferences" ? "multiple" : "none"}
      selectedKeys={section.kind === "preferences" ? section.entries.filter(entry => entry.checked).map(entry => itemKey(section.id, entry.id)) : undefined}
      shouldCloseOnSelect={section.kind === "preferences" ? false : undefined}
      onSelectionChange={section.kind === "preferences" ? keys => {
        for (const entry of section.entries) {
          const checked = keys === "all" || keys.has(itemKey(section.id, entry.id));
          if (checked !== entry.checked) entry.onCheckedChange(checked);
        }
      } : undefined}>
      {section.entries.map(entry => <Menu.Item key={entry.id} id={itemKey(section.id, entry.id)} textValue={entry.label} isDisabled={entry.isDisabled}
        isDestructive={entry.kind === "destructive"} href={entry.kind === "link" ? entry.href : undefined}
        onAction={entry.kind === "link" ? () => onRoute?.(entry) : entry.kind === "preference" ? undefined : entry.onAction}>{entry.label}</Menu.Item>)}
    </Menu.Section>)}
  </Menu>;
}

function FrameContent({ brand, navigation, account, commands, children, rightPanel, theme, themeControl, dir, page, workspaces, width: suppliedStageWidth, onWidthChange, breadcrumbLabel, collapsedBreadcrumbLabel, pageInfoLabel, fullWidthLabel, containedWidthLabel, pageActionsLabel,
  /** @default "Skip to content" */
  skipLabel = "Skip to content", mainId }: AppFrameProps) {
  const {
    /** @default "Open navigation" */ openLabel: navigationOpenLabel = "Open navigation",
    /** @default "Close navigation" */ closeLabel: navigationCloseLabel = "Close navigation",
  } = navigation;
  const generated = useId();
  const target = appFrameMainId(mainId, generated);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openCommands = useCallback(() => { setQuery(""); setCommandOpen(true); }, []);
  const { shortcutEnabled = true, triggerLabel, ...commandProps } = commands;
  useCommandMenuShortcut({ onOpen: openCommands, enabled: shortcutEnabled });
  const [narrow, setNarrow] = useState(false);
  const [available, setAvailable] = useState(Infinity);
  const [wide, setWide] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(APP_FRAME_LAYOUT.sidebarDefault);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [stageOverride, setStageOverride] = useState<"contained" | "full">();
  const stageWidth = suppliedStageWidth ?? stageOverride ?? page?.width ?? "contained";
  const [barHeight, setBarHeight] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [width, setWidth] = useState(rightPanel?.defaultValue ?? 0);
  const [panelCollapsed, setPanelCollapsed] = useState(rightPanel?.defaultCollapsed ?? false);
  const [panelSupplied, setPanelSupplied] = useState(rightPanel !== undefined);
  if (rightPanel && !panelSupplied) {
    // A panel first supplied after mount starts from its own defaults, not the absent-panel placeholders.
    setPanelSupplied(true); setWidth(rightPanel.defaultValue); setPanelCollapsed(rightPanel.defaultCollapsed ?? false);
  }
  const [navigationCollapsed, setNavigationCollapsed] = useState(navigation.defaultCollapsed ?? false);
  const collapsed = rightPanel?.collapsed ?? panelCollapsed;
  const navCollapsed = navigation.collapsed ?? navigationCollapsed;
  const { openLabel = "Open panel", closeLabel = "Close panel" } = rightPanel ?? {};
  const frame = useRef<HTMLDivElement>(null);
  const [panelCloseButtonStyle, setPanelCloseButtonStyle] = useState<DrawerProps["closeButtonStyle"]>();
  useEffect(() => {
    if (!narrow || !panelOpen) { setPanelCloseButtonStyle(undefined); return; }
    const measure = () => {
      const opener = frame.current?.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]');
      if (opener) setPanelCloseButtonStyle(appFrameCorner(opener));
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [narrow, panelOpen, dir]);
  const sidebarProbe = useRef<HTMLSpanElement>(null);
  const currentPanelWidth = rightPanel ? Math.min(rightPanel.max, Math.max(rightPanel.min, rightPanel.value ?? width)) : 0;
  const geometry = useRef({ sidebarWidth, panelWidth: currentPanelWidth, navOpen: !navCollapsed, panelOpen: Boolean(rightPanel) && !collapsed });
  useLayoutEffect(() => {
    geometry.current = { sidebarWidth, panelWidth: currentPanelWidth, navOpen: !navCollapsed, panelOpen: Boolean(rightPanel) && !collapsed };
  });
  const layout = appFramePanels(available, wide, sidebarWidth, currentPanelWidth, !navCollapsed, Boolean(rightPanel) && !collapsed);
  const navigationDocked = !layout.navigationOverlay && !navCollapsed;
  const panelDocked = Boolean(rightPanel) && !narrow && !collapsed;
  const syncResponsive = useRef<() => void>(() => {});
  const panelFocus = useRef<EventTarget | null>(null);
  const panelState = useRef({ narrow, panelOpen });
  panelState.current = { narrow, panelOpen };
  const desiredNarrow = useRef(false);
  const responsiveActive = useRef(false);
  const panelHandoff = useRef<"main" | "control" | null>(null);
  const drawerToRelease = useRef<Element | null>(null);
  const [handoffVersion, setHandoffVersion] = useState(0);
  const capturePanelFocus = (event: { target: EventTarget | null }) => { panelFocus.current = event.target; };
  useEffect(() => {
    responsiveActive.current = true;
    const media = window.matchMedia(APP_FRAME_WIDE_QUERY);
    const sync = () => {
      const nextAvailable = frame.current?.getBoundingClientRect().width || window.innerWidth;
      const nextSidebar = sidebarProbe.current?.getBoundingClientRect().width || APP_FRAME_LAYOUT.sidebarDefault;
      const currentGeometry = geometry.current;
      const nextLayout = appFramePanels(nextAvailable, media.matches, nextSidebar, currentGeometry.panelWidth, currentGeometry.navOpen, currentGeometry.panelOpen);
      const nextNarrow = nextLayout.panelOverlay;
      setAvailable(nextAvailable); setWide(media.matches); setSidebarWidth(nextSidebar);
      const current = panelState.current;
      desiredNarrow.current = nextNarrow;
      if (nextNarrow === current.narrow && panelHandoff.current === null) return;
      const active = document.activeElement;
      const panelTrigger = frame.current?.querySelector('[data-application-frame-panel="trigger"]');
      // React focus capture includes nested portals; exact identity avoids stale ownership outside the panel.
      const ownsFocus = active !== null && (panelFocus.current === active || panelTrigger === active);
      const drawerId = current.narrow ? panelTrigger?.getAttribute("aria-controls") : null;
      const drawer = drawerId ? document.getElementById(drawerId) : null;
      const drawerOpen = current.narrow && (current.panelOpen || drawer !== null);
      desiredNarrow.current = nextNarrow;
      panelHandoff.current = ownsFocus && nextNarrow !== current.narrow ? drawerOpen && !nextNarrow ? "main" : "control" : null;
      drawerToRelease.current = panelHandoff.current === "main" ? drawer : null;
      setPanelOpen(false);
      if (panelHandoff.current !== "main") setNarrow(nextNarrow);
      // Also process a handoff when closing an already-closed controlled drawer changes no state.
      setHandoffVersion(version => version + 1);
    };
    syncResponsive.current = sync;
    sync(); media.addEventListener("change", sync); window.addEventListener("resize", sync);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : undefined;
    if (frame.current) observer?.observe(frame.current);
    if (sidebarProbe.current) observer?.observe(sidebarProbe.current);
    return () => { observer?.disconnect(); window.removeEventListener("resize", sync); syncResponsive.current = () => {}; responsiveActive.current = false; panelHandoff.current = null; drawerToRelease.current = null; media.removeEventListener("change", sync); };
  }, []);
  useEffect(() => { syncResponsive.current(); }, [currentPanelWidth, navCollapsed, collapsed, rightPanel !== undefined]);
  useEffect(() => {
    const handoff = panelHandoff.current;
    if (!handoff || !responsiveActive.current) return;
    if (handoff === "main") {
      if (desiredNarrow.current || !narrow) { panelHandoff.current = null; drawerToRelease.current = null; return; }
      if (panelOpen) return;
      const drawer = drawerToRelease.current;
      if (drawer?.isConnected) {
        // React Aria may retain one exiting commit even without authored exit animation.
        const observer = new MutationObserver(() => {
          if (drawer.isConnected) return;
          observer.disconnect();
          if (responsiveActive.current && panelHandoff.current === "main" && !desiredNarrow.current) setHandoffVersion(version => version + 1);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
      }
      const active = document.activeElement;
      const trigger = frame.current?.querySelector('[data-application-frame-panel="trigger"]');
      const retainsFocus = active === null || active === document.body || active === panelFocus.current || active === trigger;
      panelHandoff.current = null;
      drawerToRelease.current = null;
      // The modal has unmounted and released its trap; keep its opener connected until main owns focus.
      if (retainsFocus) frame.current?.querySelector<HTMLElement>("main")?.focus();
      setNarrow(false);
      return;
    }
    if (desiredNarrow.current !== narrow) return;
    panelHandoff.current = null;
    drawerToRelease.current = null;
    frame.current?.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]')?.focus();
  }, [narrow, panelOpen, handoffVersion]);
  const changeCollapsed = (next: boolean) => { setPanelCollapsed(next); rightPanel?.onCollapsedChange?.(next); };
  const accountControl = account.actor ? <AccountMenu {...account} actor={account.actor} /> : <SignedOutMenu {...account} />;
  const footer = <div className="flex min-w-0 items-center justify-between gap-xs">
    <div className="min-w-0 flex-1">{accountControl}</div>
    {themeControl !== null && <div data-application-frame-slot="theme-control" className="shrink-0">
      {themeControl === undefined ? <ThemeToggle className={CONTROL} style={TAP} preferenceLabels={theme?.preferenceLabels} toggleLabel={theme?.toggleLabel} preferenceAnnouncement={theme?.preferenceAnnouncement} /> : themeControl}
    </div>}
  </div>;
  const corner = { ...TAP, position: "absolute" as const, insetBlockStart: APP_FRAME_LAYOUT.gutter, zIndex: APP_FRAME_LAYOUT.controlLayer };
  const panelTrigger = rightPanel && (narrow ? <div className="contents" onFocusCapture={capturePanelFocus}><ModalContext.Provider value={{ style: { direction: dir } }}><Drawer wide="sheet" placement="end" dismissAt={APP_FRAME_WIDE_QUERY}
    heading={rightPanel.label} closeLabel={closeLabel} closeButtonStyle={panelCloseButtonStyle} navigationKey={navigation.navigationKey}
    isOpen={panelOpen} onOpenChange={setPanelOpen}
    trigger={<Button variant="ghost" className={CONTROL} style={{ ...corner, insetInlineEnd: APP_FRAME_LAYOUT.gutter }} aria-label={openLabel} aria-expanded={panelOpen} data-application-frame-panel="trigger"><Icon glyph={Layers} decorative /></Button>}>
    {rightPanel.children}
  </Drawer></ModalContext.Provider></div> : <Button variant="ghost" className={CONTROL} style={{ ...corner, insetInlineEnd: APP_FRAME_LAYOUT.gutter }} aria-expanded={!collapsed} aria-label={collapsed ? openLabel : closeLabel} data-application-frame-panel="trigger"
    onPress={() => changeCollapsed(!collapsed)}><Icon glyph={Layers} decorative /></Button>);
  const navOpen = layout.navigationOverlay ? navigation.drawerOpen ?? navDrawerOpen : !navCollapsed;
  const changeNav = () => {
    if (layout.navigationOverlay) { setNavDrawerOpen(!navOpen); navigation.onDrawerOpenChange?.(!navOpen); }
    else { setNavigationCollapsed(navOpen); navigation.onCollapsedChange?.(navOpen); }
  };
  const navigationTrigger = <Button variant="ghost" className={CONTROL}
    style={{ ...corner, insetInlineStart: APP_FRAME_LAYOUT.gutter }} data-application-frame-navigation="trigger"
    aria-label={navOpen ? navigationCloseLabel : navigationOpenLabel} aria-expanded={navOpen} onPress={changeNav}><Icon glyph={List} decorative /></Button>;
  const commandTrigger = <div style={{ paddingBlockStart: `calc(${APP_FRAME_LAYOUT.tap} + ${APP_FRAME_LAYOUT.gutter})` }}><Button variant="ghost" className={CONTROL + " w-full justify-start gap-sm"} style={TAP} onPress={openCommands}><Icon glyph={Search} decorative /><span className="min-w-0 truncate">{triggerLabel}</span></Button></div>;
  const stageChange = (next: "contained" | "full") => { setStageOverride(next); onWidthChange?.(next); };
  return <ModalContext.Provider value={{ style: { direction: dir } }}><PopoverContext.Provider value={{ style: { direction: dir } }}>
    <div ref={frame} dir={dir} data-application-frame="" className="relative flex h-dvh min-h-0 min-w-0 overflow-hidden bg-surface-base text-body text-ink-primary">
      <SiteSkipLink targetId={target} label={skipLabel} />
      <span aria-hidden="true" className="absolute block overflow-hidden" style={{ inlineSize: 0, blockSize: 0 }}>
        <span ref={sidebarProbe} className="block" style={{ inlineSize: APP_FRAME_LAYOUT.sidebar, blockSize: 0 }} />
      </span>
      <div data-application-frame-region="navigation" className="min-h-0 shrink-0" style={{ inlineSize: navigationDocked ? APP_FRAME_LAYOUT.sidebar : 0 }}>
        <AppNavigation {...navigation} dismissAt={layout.navigationOverlay ? APP_FRAME_ALWAYS_NARROW : APP_FRAME_ALWAYS_WIDE} header={commandTrigger} footer={footer} trigger={navigationTrigger}
          drawerOpen={navigation.drawerOpen ?? navDrawerOpen} onDrawerOpenChange={next => { setNavDrawerOpen(next); navigation.onDrawerOpenChange?.(next); }}
          collapsed={navCollapsed} onCollapsedChange={next => { setNavigationCollapsed(next); navigation.onCollapsedChange?.(next); }} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
        <div data-application-frame-region="stage" data-stage-width={stageWidth} data-stage-navigation={layout.navigationOverlay ? "overlay" : "docked"} data-stage-panel={narrow ? "overlay" : "docked"}
          style={{ inlineSize: "100%", minInlineSize: 0, maxInlineSize: stageWidth === "contained" ? APP_FRAME_LAYOUT.maximum : "none", marginInline: "auto", overflowY: "auto", overflowX: "hidden", scrollPaddingBlockStart: `calc(${barHeight ? `${barHeight}px` : APP_FRAME_LAYOUT.tap} + 2 * ${APP_FRAME_LAYOUT.gutter})` }}>
          <PageBar brand={<AppFrameBrand {...brand} />} root={{ label: brand.wordmark, href: brand.href }} page={page} workspaces={workspaces} width={stageWidth} onWidthChange={stageChange} narrow={!wide}
            reserveStart={!navigationDocked} reserveEnd={Boolean(rightPanel) && !panelDocked} onHeightChange={setBarHeight} dir={dir}
            labels={{ breadcrumb: breadcrumbLabel ?? "Breadcrumb", collapsedBreadcrumb: collapsedBreadcrumbLabel ?? "More breadcrumb levels", pageInfo: pageInfoLabel ?? "Page information",
              fullWidth: fullWidthLabel ?? "Use full width", containedWidth: containedWidthLabel ?? "Use contained width", pageActions: pageActionsLabel ?? "More page actions" }} />
          <main id={target} tabIndex={-1} className="min-h-0 min-w-0 p-md focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent">{children}</main>
        </div>
      </div>
      {panelTrigger}
      {rightPanel && !narrow && !collapsed && <ResizablePane min={rightPanel.min} max={rightPanel.max} defaultValue={rightPanel.defaultValue}
        value={rightPanel.value ?? width} step={rightPanel.step} label={rightPanel.label} handleLabel={rightPanel.handleLabel}
        onChange={next => { setWidth(next); rightPanel.onChange?.(next); }}
        onFocusCapture={capturePanelFocus} data-application-frame-panel="pane" className="h-full min-h-0 shrink-0 rounded-none border-0 border-s border-line-base p-sm">{rightPanel.children}</ResizablePane>}
      <CommandMenu {...commandProps} dir={dir} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={setQuery} />
    </div>
  </PopoverContext.Provider></ModalContext.Provider>;

}

/** Host-resolved application chrome; the host owns routes, account actions and main-free route content. */
export function AppFrame(props: AppFrameProps) {
  return <ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference}><FrameContent {...props} /></ThemeProvider>;
}
