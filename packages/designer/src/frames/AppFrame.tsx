"use client";
import { ShellI18nProvider } from "#designer-frame-i18n";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ModalContext, PopoverContext, useLocale } from "react-aria-components";
import { Button, Icon, Logomark, Menu, Tooltip, SemanticContent } from "../components/index.js";
import { List, Moon, Search, Sun } from "../icons/index.js";
import { AccountMenu, AppNavigation, CommandMenu, Drawer, ResizablePane, useCommandMenuShortcut, type DrawerProps } from "../blocks/index.js";
import { ThemeProvider, useTheme } from "../theme/index.js";
import { FrameSlotProvider, FrameSlotOutlet } from "../shell/index.js";
import { framePageHeaderDeclaration } from "../shell/FrameSlots.js";
import { PageFrame, type PageFrameManifest } from "./PageFrame.js";
import { AppFrameChromeStyle, useAppFrameChromeMotion } from "./shadcn-aria/chrome.js";
import { assertAppFrameBrand } from "./AppFrameBrand.js";
import { FrameDock } from "./FrameDock.js";
import { SkipLink } from "../shell/SkipLink.js";
import { ToasterFrameInsetProvider, type ToasterFrameInset } from "../shell/Toaster.js";
import { FrameNoticeProvider } from "./frame-notices.js";
import { APP_FRAME_ALWAYS_NARROW, APP_FRAME_ALWAYS_WIDE, APP_FRAME_LAYOUT, APP_FRAME_NAVIGATION_SIZE, APP_FRAME_PANEL_SIZE, APP_FRAME_PANEL_WIDTH_VAR, APP_FRAME_WIDE_QUERY, appFrameMainId, appFramePanels, appFrameCorner } from "./app-frame-layout.js";
import type { AppFrameAccount, AppFrameProps } from "./app-frame-types.js";
import { ShellCopyProvider, useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

/** DOM provenance (WIRE-3 D1): this frame root stamps its leaf and fill. */
const FRAME_STAMP = dsAttrs("frames", "frames.app-shell", "foundry/frames.app-shell");

/** Root block size per `fill`: the host's definite height, or the dynamic viewport with no host glue. */
const ROOT_FILL: Record<NonNullable<AppFrameProps["fill"]>, string> = { host: "h-full", viewport: "h-dvh" };
const CONTROL = "control-h-md inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-frame-control text-body text-ink-primary focus-ring forced-colors:border-current";
const CORNER_CONTROL = "icon-control-md shrink-0 rounded-control border-0 bg-transparent p-0 text-ink-primary focus-ring forced-colors:border-current";
const CORNER_STYLE: CSSProperties = { position: "fixed", top: "calc(env(safe-area-inset-top) + var(--spacing-sm))", inlineSize: APP_FRAME_LAYOUT.tap, blockSize: APP_FRAME_LAYOUT.tap, minInlineSize: APP_FRAME_LAYOUT.tap, minBlockSize: APP_FRAME_LAYOUT.tap, zIndex: APP_FRAME_LAYOUT.controlLayer };
const NAVIGATION_CORNER: CSSProperties = { ...CORNER_STYLE, left: "calc(env(safe-area-inset-left) + var(--spacing-sm))" };
const PANEL_CORNER: CSSProperties = { ...CORNER_STYLE, right: "calc(env(safe-area-inset-right) + var(--spacing-sm))" };
/** The two edge toggles share one glyph, each facing its own edge: the panel toggle is the navigation toggle's mirror in either direction. */
const NAVIGATION_GLYPH = "rtl:-scale-x-100";
const PANEL_GLYPH = "-scale-x-100 rtl:scale-x-100";

function SignedOutMenu({ sections, contextLabel, signedOutLabel, onRoute, markSrc }: Omit<AppFrameAccount, "avatar"> & { markSrc: string }) {
  const populated = sections.map(section => ({ ...section, entries: section.entries.filter(entry => !entry.isDisabled) }) as typeof section).filter(section => section.entries.length > 0);
  if (!signedOutLabel.trim()) throw new TypeError("AppFrame: signed-out label must be non-empty.");
  const label = signedOutLabel;
  const subtitle = contextLabel;
  const identity = <><Logomark src={markSrc} size="sm" /><SemanticContent as="span" className="flex min-w-0 flex-1 flex-col text-start"><SemanticContent as="span" className="truncate">{label}</SemanticContent>{subtitle && <SemanticContent as="span" className="truncate text-caption text-ink-muted">{subtitle}</SemanticContent>}</SemanticContent></>;
  if (!populated.length) return <SemanticContent as="div" className="flex min-w-0 flex-1 items-center gap-sm">{identity}</SemanticContent>;
  const itemKey = (section: string, entry: string) => JSON.stringify([section, entry]);
  const trigger = <Button variant="ghost" aria-label={label} className={CONTROL + " w-full justify-start gap-sm whitespace-normal text-start"}>{identity}</Button>;
  const content = (close?: () => void) => <>{populated.map(section => <Menu.Section key={section.id} heading={section.label} aria-label={section.label ?? label}
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
        isDestructive={entry.kind === "destructive"} href={entry.kind === "link" ? entry.href : undefined} target={entry.kind === "link" ? entry.target : undefined} rel={entry.kind === "link" && entry.target === "_blank" ? "noopener noreferrer" : undefined}
        onAction={entry.kind === "preference" ? undefined : () => { if (entry.kind === "link") onRoute?.(entry); else entry.onAction(); close?.(); }}>{entry.label}</Menu.Item>)}
    </Menu.Section>)}</>;
  return <Menu trigger={trigger} popoverClassName="mb-lg">{content()}</Menu>;
}

function FrameContent({ brand, navigation, account, commands, children, main: suppliedMain, pageManifest, headerTrail, inspectorContext, state, stateViews, progress, toasts, rightPanel: suppliedRightPanel, theme, themeControl, footerLayout = "inline", fill = "host", dir: suppliedDir, onNavigate, layout: shellLayout = "standard", stage: stageInset = "contained", notices, dock, root, page, breadcrumbLabel, pageInfoLabel, pageActionsLabel, headerSurface,
  /** @default "Skip to content" */
  skipLabel: suppliedSkipLabel, mainId }: AppFrameProps) {
  const rightPanel = suppliedRightPanel && inspectorContext !== undefined ? { ...suppliedRightPanel, children: inspectorContext } : suppliedRightPanel;
  const main = suppliedMain === undefined ? children : suppliedMain;
  const { resolvedTheme, preference, setPreference } = useTheme();
  const markSrc = resolvedTheme === "dark" ? brand.reversedMarkSrc ?? brand.markSrc : brand.markSrc;
  const { direction: contextDirection, locale } = useLocale();
  const dir = suppliedDir ?? contextDirection;
  const copy = useShellCopy();
  const skipLabel = suppliedSkipLabel ?? copy(SHELL_COPY_REFS.frame.skip);
  assertAppFrameBrand(brand);
  const {
    /** @default "Open navigation" */ openLabel: suppliedNavigationOpenLabel,
    /** @default "Close navigation" */ closeLabel: suppliedNavigationCloseLabel,
  } = navigation;
  const navigationOpenLabel = suppliedNavigationOpenLabel ?? copy(SHELL_COPY_REFS.frame.navigationOpen);
  const navigationCloseLabel = suppliedNavigationCloseLabel ?? copy(SHELL_COPY_REFS.frame.navigationClose);
  const generated = useId();
  const target = appFrameMainId(mainId, generated);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const queryChange = commands.onQueryChange;
  const openCommands = useCallback(() => { setQuery(""); queryChange?.(""); setCommandOpen(true); }, [queryChange]);
  const { shortcutEnabled = true, triggerLabel, onQueryChange: _onQueryChange, ...commandProps } = commands;
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
  const openLabel = rightPanel ? rightPanel.openLabel ?? copy(SHELL_COPY_REFS.frame.panelOpen) : "";
  const closeLabel = rightPanel ? rightPanel.closeLabel ?? copy(SHELL_COPY_REFS.frame.panelClose) : "";
  const frame = useRef<HTMLDivElement>(null);
  useAppFrameChromeMotion(frame);
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
  const [themeAnnouncement, setThemeAnnouncement] = useState("");
  const themeLabels = theme?.preferenceLabels ?? { system: copy(SHELL_COPY_REFS.theme.system), light: copy(SHELL_COPY_REFS.theme.light), dark: copy(SHELL_COPY_REFS.theme.dark) };
  const targetTheme = resolvedTheme === "dark" ? "light" : "dark";
  const themeLabel = theme?.toggleLabel?.(preference, targetTheme, themeLabels) ?? themeLabels[targetTheme];
  const themeSlot = themeControl === null ? null : <SemanticContent as="div" data-application-frame-slot="theme-control" className="shrink-0">{themeControl ?? <Tooltip trigger={
    <Button variant="ghost" aria-label={themeLabel} aria-pressed={resolvedTheme === "dark"} className={CORNER_CONTROL} onPress={() => {
      setPreference(targetTheme);
      setThemeAnnouncement(theme?.preferenceAnnouncement?.(targetTheme, themeLabels) ?? copy(SHELL_COPY_REFS.theme.announcement, { theme: themeLabels[targetTheme] }));
    }}><Icon glyph={resolvedTheme === "dark" ? Sun : Moon} decorative /></Button>
  }>{themeLabel}</Tooltip>}</SemanticContent>;
  const footer = <SemanticContent as="div" data-application-frame-footer={footerLayout} className="flex w-full min-w-0 items-center gap-sm">
    <SemanticContent as="div" data-application-frame-slot="account" className="min-w-0 flex-1">{account.actor
      ? <AccountMenu {...account} actor={{ ...account.actor, image: account.avatar === "initials" ? account.actor.image : markSrc }}
        sections={account.sections} />
      : <SignedOutMenu {...account} markSrc={markSrc} />}</SemanticContent>
    {themeSlot}<SemanticContent as="span" role="status" aria-live="polite" className="sr-only">{themeAnnouncement}</SemanticContent>
  </SemanticContent>;
    const panelTrigger = rightPanel && (narrow ? <SemanticContent as="div" className="contents" onFocusCapture={capturePanelFocus}><ModalContext.Provider value={{ style: { direction: dir } }}><Drawer fullViewport wide="sheet" placement="end" dismissAt={APP_FRAME_WIDE_QUERY}
    heading={rightPanel.label} closeLabel={closeLabel} closeButtonStyle={panelCloseButtonStyle} navigationKey={navigation.navigationKey}
    isOpen={panelOpen} onOpenChange={next => { setPanelOpen(next); if (next) { setNavDrawerOpen(false); navigation.onDrawerOpenChange?.(false); } }}
    trigger={<Button variant="ghost" className={CORNER_CONTROL} style={PANEL_CORNER} aria-label={openLabel} aria-expanded={panelOpen} data-application-frame-panel="trigger"><Icon glyph={List} decorative className={PANEL_GLYPH} /></Button>}>
    <FrameSlotOutlet slot="right-panel">{rightPanel.children}</FrameSlotOutlet>
  </Drawer></ModalContext.Provider></SemanticContent> : <Button variant="ghost" className={CORNER_CONTROL} style={PANEL_CORNER} aria-controls={generated + "-panel"} aria-expanded={!collapsed} aria-label={collapsed ? openLabel : closeLabel} data-application-frame-panel="trigger"
    onPress={() => changeCollapsed(!collapsed)}><Icon glyph={List} decorative className={PANEL_GLYPH} /></Button>);
  const navOpen = layout.navigationOverlay ? navigation.drawerOpen ?? navDrawerOpen : !navCollapsed;
  const changeNav = () => {
    if (layout.navigationOverlay) { if (!navOpen) setPanelOpen(false); setNavDrawerOpen(!navOpen); navigation.onDrawerOpenChange?.(!navOpen); }
    else { setNavigationCollapsed(navOpen); navigation.onCollapsedChange?.(navOpen); }
  };
  const navigationTrigger = <Button variant="ghost" className={CORNER_CONTROL} style={NAVIGATION_CORNER}
    data-application-frame-navigation="trigger"
    aria-controls={generated + "-navigation"} aria-label={navOpen ? navigationCloseLabel : navigationOpenLabel} aria-expanded={navOpen} onPress={changeNav}><Icon glyph={List} decorative className={NAVIGATION_GLYPH} /></Button>;
  // The navigation top reserves one tap-sized corner row (the drawer close control sits at its start); a brand row takes that row instead of bare padding.
  const navigationBrand = <SemanticContent as="div" data-application-frame-slot="brand" className="flex min-w-0 items-center frame-brand-gap"
    style={{ minBlockSize: APP_FRAME_LAYOUT.tap, marginBlockEnd: APP_FRAME_LAYOUT.gutter, paddingBlockStart: `calc(${APP_FRAME_LAYOUT.tap} + ${APP_FRAME_LAYOUT.gap})` }}>
    <Logomark src={markSrc} size="sm" />{brand.navigationMark && <SemanticContent as="span" className="min-w-0 truncate text-body text-ink-primary">{brand.navigationMark.label}</SemanticContent>}
  </SemanticContent>;
  const commandTrigger = <SemanticContent as="div">{navigationBrand}<Button variant="ghost" className={CONTROL + " w-full justify-start"} onPress={openCommands}><Icon glyph={Search} decorative /><SemanticContent as="span" className="min-w-0 truncate">{triggerLabel}</SemanticContent></Button></SemanticContent>;
  const resolvedManifest: PageFrameManifest = pageManifest ?? {
    id: navigation.navigationKey ?? generated,
    breadcrumbs: [...(root ? [{ id: generated + "-root", ...root }] : []), ...(headerTrail ?? page?.breadcrumb ?? [])],
    actions: [],
  };
  const mainState = state?.main ?? "ready";
  const displayedMain = mainState === "ready" ? main : stateViews?.[mainState];
  if (mainState !== "ready" && displayedMain === undefined) throw new TypeError("AppFrame: a resolved view is required for its main state");
  return <ModalContext.Provider value={{ style: { direction: dir } }}><PopoverContext.Provider value={{ style: { direction: dir } }}>
    <SemanticContent as="div" ref={frame} lang={locale} dir={dir} data-app-frame-chrome="" data-app-frame-has-panel={rightPanel ? "true" : "false"} data-application-frame="" data-application-frame-layout={shellLayout} data-application-frame-stage={stageInset} data-application-frame-fill={fill} {...FRAME_STAMP} className={"relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-base text-body text-ink-primary " + ROOT_FILL[fill]}>
      <AppFrameChromeStyle />
      <SemanticContent as="span" ref={setNavigationControlHost} className="contents">{!navigationControlHost && <Tooltip trigger={navigationTrigger}>{navOpen ? navigationCloseLabel : navigationOpenLabel}</Tooltip>}</SemanticContent>
      {rightPanel && <Tooltip trigger={panelTrigger}>{panelOpen || panelDocked ? closeLabel : openLabel}</Tooltip>}
      {state?.navigating && progress ? <SemanticContent as="div" data-application-frame-region="progress" style={{ position: "absolute", insetBlockStart: 0, insetInline: 0, blockSize: "var(--ui-border-hairline)", overflow: "hidden", pointerEvents: "none", zIndex: "var(--ui-z-progress)" }}>{progress}</SemanticContent> : null}
      <SkipLink targetId={target}>{skipLabel}</SkipLink>
      <SemanticContent as="span" aria-hidden="true" className="absolute size-0 overflow-hidden"><SemanticContent as="span" ref={sidebarProbe} className="block" style={{ inlineSize: APP_FRAME_LAYOUT.sidebar }} /></SemanticContent>
      <SemanticContent as="div" className="flex min-h-0 min-w-0 flex-1">
        <SemanticContent as="div" id={generated + "-navigation"} data-application-frame-region="navigation" data-open={navigationDocked} aria-hidden={!navigationDocked} inert={!navigationDocked && !layout.navigationOverlay} className={"frame-docked-navigation min-h-0 shrink-0 overflow-hidden " + APP_FRAME_NAVIGATION_SIZE[navigationDocked ? "docked" : "closed"]}>
          <FrameSlotOutlet slot="left-sidebar"><AppNavigation {...navigation} fullViewport retainMounted onNavigate={onNavigate} dismissAt={layout.navigationOverlay ? APP_FRAME_ALWAYS_NARROW : APP_FRAME_ALWAYS_WIDE}
            header={commandTrigger} footer={footer} triggerContainer={navigationControlHost} trigger={navigationControlHost ? <Tooltip trigger={navigationTrigger}>{navOpen ? navigationCloseLabel : navigationOpenLabel}</Tooltip> : <></>}
            drawerOpen={navigation.drawerOpen ?? navDrawerOpen} onDrawerOpenChange={next => { setNavDrawerOpen(next); if (next) setPanelOpen(false); navigation.onDrawerOpenChange?.(next); }}
            collapsed={navCollapsed} onCollapsedChange={next => { setNavigationCollapsed(next); navigation.onCollapsedChange?.(next); }} /></FrameSlotOutlet>
        </SemanticContent>
        <SemanticContent as="div" data-app-frame-page="" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SemanticContent as="div" ref={stage} data-application-frame-region="stage" data-stage-navigation={layout.navigationOverlay ? "overlay" : "docked"} data-stage-panel={narrow ? "overlay" : "docked"}
            className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PageFrame headerSurface={headerSurface} manifest={resolvedManifest} navigationKey={navigation.navigationKey} mainId={target} mainBusy={mainState === "loading"} onNavigate={onNavigate}
              breadcrumbLabel={breadcrumbLabel ?? copy(SHELL_COPY_REFS.frame.breadcrumb)} actionsLabel={pageActionsLabel ?? copy(SHELL_COPY_REFS.frame.pageActions)}
              modulesLabel={pageInfoLabel ?? copy(SHELL_COPY_REFS.frame.pageInfo)} stage={stageInset === "full" ? "full" : "padded"}>{displayedMain}</PageFrame>
          </SemanticContent>
          <FrameDock notices={notices} dock={dock} sheet={!wide} />
        </SemanticContent>
        {rightPanel && <SemanticContent as="aside" id={generated + "-panel"} aria-label={rightPanel.label} data-open={panelDocked} aria-hidden={!panelDocked} inert={!panelDocked}
          className={"frame-docked-panel h-full min-h-0 shrink-0 overflow-hidden " + APP_FRAME_PANEL_SIZE[panelDocked ? "docked" : "closed"]} style={panelDocked ? { [APP_FRAME_PANEL_WIDTH_VAR]: `${currentPanelWidth}px` } as CSSProperties : undefined}>
          {!narrow && <ResizablePane min={rightPanel.min} max={rightPanel.max} defaultValue={rightPanel.defaultValue}
            value={rightPanel.value ?? width} step={rightPanel.step} label={rightPanel.label} handleLabel={rightPanel.handleLabel}
            onChange={next => { setWidth(next); rightPanel.onChange?.(next); }} onFocusCapture={capturePanelFocus} data-application-frame-panel="pane"
            className="h-full min-h-0 shrink-0 rounded-none border-0 border-s border-line-base p-frame-panel"><FrameSlotOutlet slot="right-panel">{rightPanel.children}</FrameSlotOutlet></ResizablePane>}
        </SemanticContent>}
      </SemanticContent>
      <CommandMenu {...commandProps} dir={dir} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={value => { setQuery(value); queryChange?.(value); }} />
      {hasToasts ? <ToasterFrameInsetProvider value={toastInset}>{toasts}</ToasterFrameInsetProvider> : null}
    </SemanticContent>
  </PopoverContext.Provider></ModalContext.Provider>;

}

/** Host-resolved application chrome; the host owns routes, account actions and main-free route content. */
export function AppFrame(props: AppFrameProps) {
  return <ShellCopyProvider resolver={props.copyResolver}><ShellI18nProvider locale={props.locale}><ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference} preference={props.theme?.preference} onPreferenceChange={props.theme?.onPreferenceChange}><FrameSlotProvider initialHeader={framePageHeaderDeclaration(props.children)}><FrameNoticeProvider><FrameContent {...props} /></FrameNoticeProvider></FrameSlotProvider></ThemeProvider></ShellI18nProvider></ShellCopyProvider>;
}
