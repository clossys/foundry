"use client";
import { ShellI18nProvider } from "#designer-frame-i18n";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ModalContext, PopoverContext, useLocale } from "react-aria-components";
import { Button, Icon, Logomark, Menu, Tooltip } from "../components/index.js";
import { Layers, List, Search } from "../icons/index.js";
import { AccountMenu, AppNavigation, PageBar, CommandMenu, Drawer, ResizablePane, useCommandMenuShortcut, type DrawerProps } from "../blocks/index.js";
import { ThemeProvider, ThemeToggle } from "../theme/index.js";
import { FrameSlotProvider, FrameSlotOutlet, useFramePageHeader } from "../shell/index.js";
import { assertAppFrameBrand } from "./AppFrameBrand.js";
import { FrameDock } from "./FrameDock.js";
import { SkipLink } from "../shell/SkipLink.js";
import { ToasterFrameInsetProvider, type ToasterFrameInset } from "../shell/Toaster.js";
import { FrameNoticeProvider } from "./frame-notices.js";
import { APP_FRAME_ALWAYS_NARROW, APP_FRAME_ALWAYS_WIDE, APP_FRAME_LAYOUT, APP_FRAME_NAVIGATION_SIZE, APP_FRAME_PANEL_SIZE, APP_FRAME_PANEL_WIDTH_VAR, APP_FRAME_WIDE_QUERY, appFrameMainId, appFramePanels, appFrameCorner } from "./app-frame-layout.js";
import type { AppFrameAccount, AppFrameProps } from "./app-frame-types.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

/** DOM provenance (WIRE-3 D1): this frame root stamps its leaf and fill. */
const FRAME_STAMP = dsAttrs("frames", "frames.app-shell", "foundry/frames.app-shell");

/**
 * Header row and stage main classes live here, above every template literal: the compiled-CSS
 * class scan pairs backticks file-wide, so a class literal inside the JSX below can be skipped.
 */
const HEADER_ROW = "frame-header-container relative flex min-w-0 shrink-0 items-center frame-header-row";
/** Root block size per `fill`: the host's definite height, or the dynamic viewport with no host glue. */
const ROOT_FILL: Record<NonNullable<AppFrameProps["fill"]>, string> = { host: "h-full", viewport: "h-dvh" };
const MAIN = "flex h-full min-h-0 min-w-0 flex-col frame-main-gap overflow-auto ";
const MAIN_INSET = "frame-main-inset frame-main-bleed ";
const CONTROL = "control-h-md inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-frame-control text-body text-ink-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring forced-colors:border-current";
/** The two edge toggles share one glyph, each facing its own edge: the panel toggle is the navigation toggle's mirror in either direction. */
const NAVIGATION_GLYPH = "rtl:-scale-x-100";
const PANEL_GLYPH = "-scale-x-100 rtl:scale-x-100";

function SignedOutMenu({ sections, signedOutLabel, onRoute, markSrc }: Omit<AppFrameAccount, "avatar"> & { markSrc: string }) {
  const populated = sections.filter(section => section.entries.length > 0);
  if (!signedOutLabel.trim()) throw new TypeError("AppFrame: signed-out label must be non-empty.");
  if (!populated.length) return <div className="flex min-w-0 items-center frame-account-row"><Logomark src={markSrc} size="sm" /><span className="min-w-0 truncate">{signedOutLabel}</span></div>;
  const itemKey = (section: string, entry: string) => JSON.stringify([section, entry]);
  return <Menu trigger={<Button variant="ghost" className={CONTROL + " w-full justify-start text-start"}><Logomark src={markSrc} size="sm" /><span className="min-w-0 truncate">{signedOutLabel}</span></Button>}>
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

function FrameContent({ brand, navigation, account: { avatar = "initials", ...account }, commands, children, toasts, rightPanel, theme, themeControl, footerLayout = "inline", fill = "host", dir: suppliedDir, onNavigate, layout: shellLayout = "standard", stage: stageInset = "contained", notices, dock, headerPosition, headerSurface, context, root, page, workspaces, breadcrumbLabel, collapsedBreadcrumbLabel, pageInfoLabel, pageActionsLabel,
  /** @default "Skip to content" */
  skipLabel = "Skip to content", mainId }: AppFrameProps) {
  const { direction: contextDirection, locale } = useLocale();
  const dir = suppliedDir ?? contextDirection;
  // The page header is leased by PageHeaderModule only; the frame takes no header prop.
  const resolvedHeader = useFramePageHeader();
  assertAppFrameBrand(brand);
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [width, setWidth] = useState(rightPanel?.defaultValue ?? 0);
  const [panelCollapsed, setPanelCollapsed] = useState(rightPanel?.defaultCollapsed ?? false);
  const [panelSupplied, setPanelSupplied] = useState(rightPanel !== undefined);
  if (rightPanel && !panelSupplied) {
    // A panel first supplied after mount starts from its own defaults, not the absent-panel placeholders.
    setPanelSupplied(true); setWidth(rightPanel.defaultValue); setPanelCollapsed(rightPanel.defaultCollapsed ?? false);
  }
  const [navigationCollapsed, setNavigationCollapsed] = useState(navigation.defaultCollapsed ?? shellLayout === "immersive");
  const collapsed = rightPanel?.collapsed ?? panelCollapsed;
  const navCollapsed = navigation.collapsed ?? navigationCollapsed;
  const { openLabel = "Open panel", closeLabel = "Close panel" } = rightPanel ?? {};
  const frame = useRef<HTMLDivElement>(null);
  const [navigationControlHost, setNavigationControlHost] = useState<HTMLSpanElement | null>(null);
  const [panelCloseButtonStyle, setPanelCloseButtonStyle] = useState<DrawerProps["closeButtonStyle"]>();
  useEffect(() => {
    if (!narrow || !panelOpen) { setPanelCloseButtonStyle(undefined); return; }
    const measure = () => {
      const opener = frame.current?.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]');
      if (opener) setPanelCloseButtonStyle(appFrameCorner(opener, dir));
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
  const stage = useRef<HTMLDivElement>(null);
  const [toastInset, setToastInset] = useState<ToasterFrameInset | null>(null);
  const hasToasts = toasts !== undefined && toasts !== null && toasts !== false;
  useLayoutEffect(() => {
    const element = stage.current;
    if (!hasToasts || !element) return;
    // Toasts portal to the document; anchoring them to the stage corner keeps them clear of the header and dock.
    const measure = () => {
      const rect = element.getBoundingClientRect(), direction = dir;
      const next = { blockEnd: Math.max(0, window.innerHeight - rect.bottom), inlineEnd: Math.max(0, direction === "rtl" ? rect.left : window.innerWidth - rect.right), direction };
      setToastInset(previous => previous?.blockEnd === next.blockEnd && previous.inlineEnd === next.inlineEnd && previous.direction === next.direction ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [hasToasts, dir]);
  const changeCollapsed = (next: boolean) => { setPanelCollapsed(next); rightPanel?.onCollapsedChange?.(next); };
  // Initials come from the actor name (Avatar's fallback); a signed-out row has no person, so it keeps the mark.
  const accountControl = account.actor ? <AccountMenu {...account} actor={{ ...account.actor, image: avatar === "initials" ? undefined : brand.markSrc }} /> : <SignedOutMenu {...account} markSrc={brand.markSrc} />;
  const themeSlot = themeControl !== null && <div data-application-frame-slot="theme-control" className="shrink-0">
    {themeControl === undefined ? <ThemeToggle className={CONTROL} preferenceLabels={theme?.preferenceLabels} toggleLabel={theme?.toggleLabel} preferenceAnnouncement={theme?.preferenceAnnouncement} /> : themeControl}
  </div>;
  const footer = footerLayout === "stacked" ? <div data-application-frame-footer="stacked" className="flex min-w-0 flex-col frame-footer-gap">
    {themeSlot}
    <div data-application-frame-slot="account" className="w-full min-w-0">{accountControl}</div>
  </div> : <div className="flex min-w-0 items-center justify-between frame-footer-gap">
    <div className="min-w-0 flex-1">{accountControl}</div>
    {themeSlot}
  </div>;
    const panelTrigger = rightPanel && (narrow ? <div className="contents" onFocusCapture={capturePanelFocus}><ModalContext.Provider value={{ style: { direction: dir } }}><Drawer fullViewport wide="sheet" placement="end" dismissAt={APP_FRAME_WIDE_QUERY}
    heading={rightPanel.label} closeLabel={closeLabel} closeButtonStyle={panelCloseButtonStyle} navigationKey={navigation.navigationKey}
    isOpen={panelOpen} onOpenChange={next => { setPanelOpen(next); if (next) { setNavDrawerOpen(false); navigation.onDrawerOpenChange?.(false); } }}
    trigger={<Button variant="ghost" className={CONTROL} aria-label={openLabel} aria-expanded={panelOpen} data-application-frame-panel="trigger"><Icon glyph={List} decorative className={PANEL_GLYPH} /></Button>}>
    <FrameSlotOutlet slot="right-panel">{rightPanel.children}</FrameSlotOutlet>
  </Drawer></ModalContext.Provider></div> : <Button variant="ghost" className={CONTROL} aria-controls={generated + "-panel"} aria-expanded={!collapsed} aria-label={collapsed ? openLabel : closeLabel} data-application-frame-panel="trigger"
    onPress={() => changeCollapsed(!collapsed)}><Icon glyph={List} decorative className={PANEL_GLYPH} /></Button>);
  const navOpen = layout.navigationOverlay ? navigation.drawerOpen ?? navDrawerOpen : !navCollapsed;
  const changeNav = () => {
    if (layout.navigationOverlay) { if (!navOpen) setPanelOpen(false); setNavDrawerOpen(!navOpen); navigation.onDrawerOpenChange?.(!navOpen); }
    else { setNavigationCollapsed(navOpen); navigation.onCollapsedChange?.(navOpen); }
  };
  const navigationTrigger = <Button variant="ghost" className={CONTROL}
    data-application-frame-navigation="trigger"
    aria-controls={generated + "-navigation"} aria-label={navOpen ? navigationCloseLabel : navigationOpenLabel} aria-expanded={navOpen} onPress={changeNav}><Icon glyph={List} decorative className={NAVIGATION_GLYPH} /></Button>;
  // The navigation top reserves one tap-sized corner row (the drawer close control sits at its start); a brand row takes that row instead of bare padding.
  const navigationBrand = <div data-application-frame-slot="brand" className="flex min-w-0 items-center frame-brand-gap"
    style={{ minBlockSize: APP_FRAME_LAYOUT.tap, marginBlockEnd: APP_FRAME_LAYOUT.gutter, paddingInlineStart: layout.navigationOverlay ? `calc(${APP_FRAME_LAYOUT.tap} + ${APP_FRAME_LAYOUT.gap})` : undefined }}>
    <Logomark src={brand.markSrc} size="sm" />{brand.navigationMark && <span className="min-w-0 truncate text-body text-ink-primary">{brand.navigationMark.label}</span>}
  </div>;
  const commandTrigger = <div>{navigationBrand}<Button variant="ghost" className={CONTROL + " w-full justify-start"} onPress={openCommands}><Icon glyph={Search} decorative /><span className="min-w-0 truncate">{triggerLabel}</span></Button></div>;
  const pageBar = <PageBar position={headerPosition} surface={headerSurface ?? (shellLayout === "immersive" ? "glass" : "solid")} header={resolvedHeader} onNavigate={onNavigate} context={context} root={root} page={page} workspaces={workspaces} narrow={!wide}
    reserveStart={false} reserveEnd={false} dir={dir}
    labels={{ breadcrumb: breadcrumbLabel ?? "Breadcrumb", collapsedBreadcrumb: collapsedBreadcrumbLabel ?? "More breadcrumb levels", pageInfo: pageInfoLabel ?? "Page information",
      pageActions: pageActionsLabel ?? "More page actions" }} />;
  return <ModalContext.Provider value={{ style: { direction: dir } }}><PopoverContext.Provider value={{ style: { direction: dir } }}>
    <div ref={frame} lang={locale} dir={dir} data-application-frame="" data-application-frame-layout={shellLayout} data-application-frame-stage={stageInset} data-application-frame-fill={fill} {...FRAME_STAMP} className={"relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-base text-body text-ink-primary " + ROOT_FILL[fill]}>
      <SkipLink targetId={target}>{skipLabel}</SkipLink>
      <span aria-hidden="true" className="absolute size-0 overflow-hidden"><span ref={sidebarProbe} className="block" style={{ inlineSize: APP_FRAME_LAYOUT.sidebar }} /></span>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div id={generated + "-navigation"} data-application-frame-region="navigation" data-open={navigationDocked} aria-hidden={!navigationDocked} inert={!navigationDocked && !layout.navigationOverlay} className={"frame-docked-navigation min-h-0 shrink-0 overflow-hidden " + APP_FRAME_NAVIGATION_SIZE[navigationDocked ? "docked" : "closed"]}>
          <FrameSlotOutlet slot="left-sidebar"><AppNavigation {...navigation} fullViewport retainMounted onNavigate={onNavigate} dismissAt={layout.navigationOverlay ? APP_FRAME_ALWAYS_NARROW : APP_FRAME_ALWAYS_WIDE}
            header={commandTrigger} footer={footer} triggerContainer={navigationControlHost} trigger={navigationControlHost ? <Tooltip trigger={navigationTrigger}>{navOpen ? navigationCloseLabel : navigationOpenLabel}</Tooltip> : <></>}
            drawerOpen={navigation.drawerOpen ?? navDrawerOpen} onDrawerOpenChange={next => { setNavDrawerOpen(next); if (next) setPanelOpen(false); navigation.onDrawerOpenChange?.(next); }}
            collapsed={navCollapsed} onCollapsedChange={next => { setNavigationCollapsed(next); navigation.onCollapsedChange?.(next); }} /></FrameSlotOutlet>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div data-application-frame-region="header" className={HEADER_ROW}>
            <span ref={setNavigationControlHost} className="contents">{!navigationControlHost && <Tooltip trigger={navigationTrigger}>{navOpen ? navigationCloseLabel : navigationOpenLabel}</Tooltip>}</span>
            <div className="min-w-0 flex-1">{pageBar}</div>
            {rightPanel ? <Tooltip trigger={panelTrigger}>{panelOpen || panelDocked ? closeLabel : openLabel}</Tooltip> : <span aria-hidden="true" className="icon-control-md shrink-0" />}
          </div>
          <div ref={stage} data-application-frame-region="stage" data-stage-navigation={layout.navigationOverlay ? "overlay" : "docked"} data-stage-panel={narrow ? "overlay" : "docked"}
            className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
            <main id={target} tabIndex={-1} className={MAIN + (stageInset === "full" ? "" : MAIN_INSET) + "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring"}>{children}</main>
          </div>
          <FrameDock notices={notices} dock={dock} sheet={!wide} />
        </div>
        {rightPanel && <aside id={generated + "-panel"} aria-label={rightPanel.label} data-open={panelDocked} aria-hidden={!panelDocked} inert={!panelDocked}
          className={"frame-docked-panel h-full min-h-0 shrink-0 overflow-hidden " + APP_FRAME_PANEL_SIZE[panelDocked ? "docked" : "closed"]} style={panelDocked ? { [APP_FRAME_PANEL_WIDTH_VAR]: `${currentPanelWidth}px` } as CSSProperties : undefined}>
          {!narrow && <ResizablePane min={rightPanel.min} max={rightPanel.max} defaultValue={rightPanel.defaultValue}
            value={rightPanel.value ?? width} step={rightPanel.step} label={rightPanel.label} handleLabel={rightPanel.handleLabel}
            onChange={next => { setWidth(next); rightPanel.onChange?.(next); }} onFocusCapture={capturePanelFocus} data-application-frame-panel="pane"
            className="h-full min-h-0 shrink-0 rounded-none border-0 border-s border-line-base p-frame-panel"><FrameSlotOutlet slot="right-panel">{rightPanel.children}</FrameSlotOutlet></ResizablePane>}
        </aside>}
      </div>
      <CommandMenu {...commandProps} dir={dir} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={setQuery} />
      {hasToasts ? <ToasterFrameInsetProvider value={toastInset}>{toasts}</ToasterFrameInsetProvider> : null}
    </div>
  </PopoverContext.Provider></ModalContext.Provider>;

}

/** Host-resolved application chrome; the host owns routes, account actions and main-free route content. */
export function AppFrame(props: AppFrameProps) {
  return <ShellI18nProvider locale={props.locale}><ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference} preference={props.theme?.preference} onPreferenceChange={props.theme?.onPreferenceChange}><FrameSlotProvider><FrameNoticeProvider><FrameContent {...props} /></FrameNoticeProvider></FrameSlotProvider></ThemeProvider></ShellI18nProvider>;
}
