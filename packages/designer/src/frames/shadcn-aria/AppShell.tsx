"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, Sheet, SheetHeader, SheetTitle, Tooltip, SemanticContent, Button, Logomark, Menu } from "../../components/index.js";
import { AccountMenu, CommandMenu, ResizablePane, useCommandMenuShortcut, validateAppNavigationTree, type AppNavigationNode } from "../../blocks/index.js";
import { Icon as AssetIcon } from "../../components/icon/index.js";
import { ThemeProvider, useTheme } from "../../theme/index.js";
import { FrameSlotProvider, FrameSlotOutlet } from "../../shell/FrameSlots.js";
import { framePageHeaderDeclaration } from "../../shell/FrameSlots.js";
import { SkipLink } from "../../shell/SkipLink.js";
import { ShellCopyProvider, useShellCopy } from "../../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../../components/Banner.copy.js";
import { ShellI18nProvider } from "#designer-frame-i18n";
import type { AppFrameProps } from "../app-frame-types.js";
import { PageFrame, type PageFrameManifest } from "../PageFrame.js";
import { AppFrameChromeStyle, useAppFrameChromeMotion } from "./chrome.js";

/** Source surfaces expose change callbacks directly; nested AppFrame inputs remain compatible. */
export interface ShadcnAppShellProps extends AppFrameProps {
  /** The page owns this projection; workspace navigation never keeps a parallel action roster. */
  pageManifest?: PageFrameManifest;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  onInspectorCollapsedChange?: (collapsed: boolean) => void;
  onInspectorWidthChange?: (width: number) => void;
  onThemePreferenceChange?: NonNullable<AppFrameProps["theme"]>["onPreferenceChange"];
  onNavigatingChange?: (navigating: boolean) => void;
  onMainStateChange?: (state: NonNullable<AppFrameProps["state"]>["main"]) => void;
}

const FRAME = { "data-ds-leaf": "frames.app-shell", "data-ds-fill": "shadcn@aria/frames.app-shell", "data-ds-layer": "frames" } as const;
const SIDEBAR = { "data-ds-leaf": "components.sidebar", "data-ds-fill": "shadcn@aria/components.sidebar", "data-ds-layer": "components" } as const;
const MenuSection = Menu.Section, MenuItem = Menu.Item;

/** Sidebar anatomy follows the pinned official Aria sidebar, with host-owned navigation and copy. */
function Navigation({ tree, activeId, close }: { tree: readonly AppNavigationNode[]; activeId?: string; close: () => void }) {
  const finish = close;
  return <SidebarMenu>{tree.map(node => <SidebarMenuItem key={node.id}>
    {node.href ? <SidebarMenuButton href={node.href} isActive={node.id === activeId} aria-current={node.id === activeId ? "page" : undefined} onPress={finish}>{node.icon}{node.label}</SidebarMenuButton>
      : node.onAction ? <SidebarMenuButton isActive={node.id === activeId} onPress={() => { node.onAction?.(); finish(); }}>{node.icon}{node.label}</SidebarMenuButton>
        : <SemanticContent as="div" className="px-sm py-xs text-caption text-ink-muted">{node.label}</SemanticContent>}
    {node.children && <SidebarMenuSub>{node.children.map(child => <SidebarMenuSubItem key={child.id}>
      {child.href ? <SidebarMenuSubButton href={child.href} isActive={child.id === activeId} aria-current={child.id === activeId ? "page" : undefined} onPress={finish}>{child.icon}{child.label}</SidebarMenuSubButton>
        : <SidebarMenuSubButton isActive={child.id === activeId} onPress={() => { child.onAction?.(); finish(); }}>{child.icon}{child.label}</SidebarMenuSubButton>}
    </SidebarMenuSubItem>)}</SidebarMenuSub>}
  </SidebarMenuItem>)}</SidebarMenu>;
}

function Account({ account, mark }: { account: AppFrameProps["account"]; mark: string }) {
  if (account.actor) return <AccountMenu {...account} actor={{ ...account.actor, ...(account.avatar === "initials" ? {} : { image: mark }) }} />;
  return <Menu trigger={<Button variant="ghost" className="w-full justify-start"><Logomark src={mark} size="sm" />{account.signedOutLabel}</Button>}>
    {account.sections.map(section => <MenuSection key={section.id} heading={section.label} aria-label={section.label ?? account.signedOutLabel}>
      {section.entries.map(entry => <MenuItem key={entry.id} id={entry.id} isDisabled={entry.isDisabled} href={entry.kind === "link" ? entry.href : undefined} target={entry.kind === "link" ? entry.target : undefined} rel={entry.kind === "link" && entry.target === "_blank" ? "noopener noreferrer" : undefined}
        onAction={() => { if (entry.kind === "link") account.onRoute?.(entry); else if (entry.kind === "preference") entry.onCheckedChange(!entry.checked); else entry.onAction(); }}>{entry.label}</MenuItem>)}
    </MenuSection>)}
  </Menu>;
}

function Content(props: AppFrameProps) {
  const { navigation, brand, commands, account, rightPanel, children } = props;
  const copy = useShellCopy(), theme = useTheme(), id = useId();
  const chrome = useRef<HTMLDivElement>(null);
  useAppFrameChromeMotion(chrome);
  const [collapsed, setCollapsed] = useState(navigation.defaultCollapsed ?? props.layout === "immersive");
  const [narrow, setNarrow] = useState(false), [ownDrawer, setOwnDrawer] = useState(false);
  const drawerOpen = navigation.drawerOpen ?? ownDrawer;
  const changeDrawer = (next: boolean) => { if (navigation.drawerOpen === undefined) setOwnDrawer(next); navigation.onDrawerOpenChange?.(next); };
  const route = useRef(navigation.navigationKey);
  useEffect(() => {
    const breakpoint = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-mobile-lg").trim();
    if (!breakpoint) throw new TypeError("AppShell requires the selected mobile breakpoint token");
    const media = window.matchMedia(`(min-width: ${breakpoint})`), sync = () => setNarrow(!media.matches);
    sync(); media.addEventListener("change", sync); return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => { if (route.current !== navigation.navigationKey) { route.current = navigation.navigationKey; changeDrawer(false); } }, [navigation.navigationKey]);
  const [commandOpen, setCommandOpen] = useState(false), [query, setQuery] = useState("");
  const [ownPanelCollapsed, setOwnPanelCollapsed] = useState(rightPanel?.defaultCollapsed ?? false);
  const panelCollapsed = rightPanel?.collapsed ?? ownPanelCollapsed;
  const changePanel = (next: boolean) => { if (rightPanel?.collapsed === undefined) setOwnPanelCollapsed(next); rightPanel?.onCollapsedChange?.(next); };
  const isCollapsed = navigation.collapsed ?? collapsed;
  const navigationRegion = useRef<HTMLDivElement>(null), panelRegion = useRef<HTMLElement>(null);
  const previousCollapse = useRef({ navigation: isCollapsed, panel: panelCollapsed });
  useLayoutEffect(() => {
    const previous = previousCollapse.current;
    previousCollapse.current = { navigation: isCollapsed, panel: panelCollapsed };
    // Desktop regions stay mounted when collapsed. Move only their current focus;
    // mobile Sheets retain their own modal focus restoration.
    if (narrow) return;
    const active = document.activeElement;
    const region = !previous.navigation && isCollapsed && navigationRegion.current?.contains(active) ? "navigation"
      : !previous.panel && panelCollapsed && panelRegion.current?.contains(active) ? "panel" : null;
    if (region) chrome.current?.querySelector<HTMLElement>(`[data-app-frame-toggle="${region}"]`)?.focus();
  }, [isCollapsed, panelCollapsed, narrow]);
  const changeCollapsed = (next: boolean) => { if (navigation.collapsed === undefined) setCollapsed(next); navigation.onCollapsedChange?.(next); };
  const mainId = props.mainId ?? `main-content-${id.replaceAll(":", "")}`;
  const mark = theme.resolvedTheme === "dark" ? brand.reversedMarkSrc ?? brand.markSrc : brand.markSrc;
  const openNavigation = navigation.openLabel ?? copy(SHELL_COPY_REFS.frame.navigationOpen);
  const closeNavigation = navigation.closeLabel ?? copy(SHELL_COPY_REFS.frame.navigationClose);
  const openCommands = () => { setQuery(""); commands.onQueryChange?.(""); setCommandOpen(true); };
  useCommandMenuShortcut({ onOpen: openCommands, enabled: commands.shortcutEnabled !== false });
  validateAppNavigationTree(navigation.tree);
  const { triggerLabel, onQueryChange, shortcutEnabled: _shortcutEnabled, ...commandProps } = commands;
  const main = props.main ?? children;
  const railCopy = (ref: { id: string }) => ({ ref, text: copy(ref) });
  const sidebar = <>
    <SidebarHeader style={{ paddingBlockStart: "calc(env(safe-area-inset-top) + var(--ui-layout-tap-target) + var(--spacing-md))" }}>
      <SemanticContent as="div" className="flex min-w-0 items-center gap-sm p-sm"><Logomark src={mark} size="sm" />{brand.navigationMark && <SemanticContent as="span" className="truncate text-body font-medium">{brand.navigationMark.label}</SemanticContent>}</SemanticContent>
      <Button variant="ghost" onPress={openCommands} className="w-full justify-start">{triggerLabel}</Button>
    </SidebarHeader>
    <SidebarContent><Navigation tree={navigation.tree} activeId={navigation.activeId} close={() => changeDrawer(false)} /><FrameSlotOutlet slot="left-sidebar" /></SidebarContent>
    <SidebarFooter><SemanticContent as="div" className="flex min-w-0 items-center gap-sm">
      <SemanticContent as="div" className="min-w-0 flex-1"><Account account={account} mark={mark} /></SemanticContent>
      {props.themeControl === null ? null : props.themeControl ?? <Tooltip trigger={<Button variant="ghost" aria-label={copy(theme.resolvedTheme === "dark" ? SHELL_COPY_REFS.theme.light : SHELL_COPY_REFS.theme.dark)} aria-pressed={theme.resolvedTheme === "dark"} onPress={() => theme.setPreference(theme.resolvedTheme === "dark" ? "light" : "dark")} className="shrink-0 aspect-square p-0"><AssetIcon asset={theme.resolvedTheme === "dark" ? "assets.icon-theme-light" : "assets.icon-theme-dark"} decorative /></Button>}>{copy(theme.resolvedTheme === "dark" ? SHELL_COPY_REFS.theme.light : SHELL_COPY_REFS.theme.dark)}</Tooltip>}
    </SemanticContent></SidebarFooter>
  </>;
  const corner = (panel: "navigation" | "panel", open: boolean, change: () => void) => <Button variant="ghost"
    data-app-frame-toggle={panel} aria-label={panel === "navigation" ? open ? closeNavigation : openNavigation : open ? rightPanel?.closeLabel ?? copy(SHELL_COPY_REFS.frame.panelClose) : rightPanel?.openLabel ?? copy(SHELL_COPY_REFS.frame.panelOpen)}
    aria-expanded={open} onPress={change} style={{ position: "fixed", insetBlockStart: "calc(env(safe-area-inset-top) + var(--spacing-sm))", ...(panel === "navigation" ? { left: "calc(env(safe-area-inset-left) + var(--spacing-sm))" } : { right: "calc(env(safe-area-inset-right) + var(--spacing-sm))" }), zIndex: "var(--ui-z-modal)", inlineSize: "var(--ui-layout-tap-target)", blockSize: "var(--ui-layout-tap-target)", padding: 0, transition: "none", background: "var(--color-surface-base)" }}>
    <AssetIcon asset="assets.icon-panel-left" decorative className={(panel === "navigation" ? open : !open) ? "" : "-scale-x-100"} />
  </Button>;
  return <SidebarProvider {...FRAME} ref={chrome} data-app-frame-chrome="" data-app-frame-has-panel={rightPanel ? "true" : "false"} dir={props.dir} open={!isCollapsed} onOpenChange={open => changeCollapsed(!open)}
    className={props.fill === "viewport" ? "h-dvh min-h-0 overflow-hidden bg-surface-raised" : "h-full min-h-0 overflow-hidden bg-surface-raised"}>
    <AppFrameChromeStyle />
    <SkipLink targetId={mainId}>{props.skipLabel ?? copy(SHELL_COPY_REFS.frame.skip)}</SkipLink>
    {!(narrow && drawerOpen) && corner("navigation", narrow ? drawerOpen : !isCollapsed, () => narrow ? changeDrawer(!drawerOpen) : changeCollapsed(!isCollapsed))}
    {rightPanel && !(narrow && !panelCollapsed) && corner("panel", !panelCollapsed, () => changePanel(!panelCollapsed))}
    {narrow ? <Sheet {...SIDEBAR} side="left" showCloseButton={false} isOpen={drawerOpen} onOpenChange={changeDrawer} copyResolver={railCopy}>
      {corner("navigation", true, () => changeDrawer(false))}
      <SheetHeader><SheetTitle>{navigation.label ?? openNavigation}</SheetTitle></SheetHeader>
      <SemanticContent as="div" role="navigation" aria-label={navigation.label ?? openNavigation}>{sidebar}</SemanticContent>
    </Sheet> : <Sidebar {...SIDEBAR} ref={navigationRegion} variant="inset" collapsible="icon" copyResolver={railCopy} aria-hidden={isCollapsed} inert={isCollapsed} aria-label={navigation.label ?? openNavigation} role="navigation" onClickCapture={event => {
      if (!props.onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href"); if (!href) return;
      event.preventDefault(); void Promise.resolve().then(() => props.onNavigate?.(href)).catch(() => {});
    }}>
      {sidebar}
    </Sidebar>}
    {!narrow && isCollapsed && <Sidebar {...SIDEBAR} collapsible="none" role="navigation" aria-label={navigation.label ?? openNavigation}
      style={{ position: "fixed", insetBlock: 0, left: 0, inlineSize: "var(--ui-layout-sidebar-rail-w)", zIndex: "var(--ui-z-sticky)", paddingBlockStart: "calc(var(--ui-layout-tap-target) + var(--spacing-lg))" }}>
      <SidebarMenu>{navigation.tree.map(node => <SidebarMenuItem key={node.id}><SidebarMenuButton href={node.href} isActive={node.id === navigation.activeId} tooltip={node.label} aria-label={node.label} onPress={node.onAction}>
        {node.icon ?? <AssetIcon asset="assets.icon-layers" decorative />}<SemanticContent as="span" className="sr-only">{node.label}</SemanticContent>
      </SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
      <SidebarFooter><Logomark src={mark} size="sm" /></SidebarFooter>
    </Sidebar>}
    <SemanticContent as="div" data-app-frame-page="" data-slot="sidebar-inset" className="flex min-h-0 min-w-0 flex-1 gap-sm p-sm">
      <SemanticContent as="div" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-control border border-line-base bg-surface-base shadow-sm">{main}</SemanticContent>
      {rightPanel && (narrow ? <Sheet side="right" showCloseButton={false} isOpen={!panelCollapsed} onOpenChange={open => changePanel(!open)} copyResolver={railCopy}>
        {corner("panel", true, () => changePanel(true))}<SheetHeader><SheetTitle>{rightPanel.label}</SheetTitle></SheetHeader>
        {props.inspectorContext ?? rightPanel.children}
      </Sheet> : <SemanticContent as="aside" ref={panelRegion} aria-label={rightPanel.label} hidden={panelCollapsed} className="frame-docked-panel min-h-0 shrink-0 overflow-hidden" style={{ paddingBlockStart: "calc(var(--ui-layout-tap-target) + var(--spacing-md))" }}>
        <ResizablePane {...rightPanel} handleEdge="start" className="h-full min-h-0 border-s border-line-base">{props.inspectorContext ?? rightPanel.children}</ResizablePane>
      </SemanticContent>)}
    </SemanticContent>
    {props.toasts}
    <CommandMenu {...commandProps} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={next => { setQuery(next); onQueryChange?.(next); }} dir={props.dir} />
  </SidebarProvider>;
}

/** A distinct sidebar/inset assembly, rather than an alias of the Foundry AppFrame. */
export function ShadcnAppShell(input: ShadcnAppShellProps) {
  const generated = useId(), mainId = input.mainId ?? `main-content-${generated.replaceAll(":", "")}`;
  const props: AppFrameProps = {
    ...input,
    navigation: { ...input.navigation, onCollapsedChange: input.onSidebarCollapsedChange ?? input.navigation.onCollapsedChange },
    ...(input.rightPanel ? { rightPanel: { ...input.rightPanel, onCollapsedChange: input.onInspectorCollapsedChange ?? input.rightPanel.onCollapsedChange, onChange: input.onInspectorWidthChange ?? input.rightPanel.onChange } } : {}),
    theme: { ...input.theme, onPreferenceChange: input.onThemePreferenceChange ?? input.theme?.onPreferenceChange },
    mainId,
  };
  return <ShellCopyProvider resolver={props.copyResolver}><ShellI18nProvider locale={props.locale}>
    <ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference} preference={props.theme?.preference} onPreferenceChange={props.theme?.onPreferenceChange}>
      <FrameSlotProvider initialHeader={framePageHeaderDeclaration(props.children)}><AppShellPage {...props} /></FrameSlotProvider>
    </ThemeProvider>
  </ShellI18nProvider></ShellCopyProvider>;
}

function AppShellPage(input: AppFrameProps) {
  const copy = useShellCopy(), mainId = input.mainId!;
  const manifest = input.pageManifest ?? { id: input.navigation.navigationKey ?? mainId, breadcrumbs: input.headerTrail ?? input.page?.breadcrumb ?? (input.root ? [{ id: "root", ...input.root }] : []), actions: [] };
  const state = input.state?.main ?? "ready";
  const content = state === "ready" ? input.main ?? input.children : input.stateViews?.[state];
  if (state !== "ready" && content === undefined) throw new TypeError("AppShell requires a resolved view for its main state");
  const page = <PageFrame headerSurface={input.headerSurface} manifest={manifest} navigationKey={input.navigation.navigationKey} mainId={mainId} stage={input.stage === "full" ? "full" : "padded"} mainBusy={state === "loading"}
    breadcrumbLabel={input.breadcrumbLabel ?? copy(SHELL_COPY_REFS.frame.breadcrumb)} actionsLabel={input.pageActionsLabel ?? copy(SHELL_COPY_REFS.frame.pageActions)}
    modulesLabel={manifest.actions.map(action => action.module.label).join(", ")} onNavigate={input.onNavigate}>
    {input.state?.navigating && input.progress}{content}
  </PageFrame>;
  return <Content {...input} main={page} />;
}
