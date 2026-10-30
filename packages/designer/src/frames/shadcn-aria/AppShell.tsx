"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, Sheet, SheetHeader, SheetTitle, SemanticContent, Button, Logomark, Menu } from "../../components/index.js";
import { AccountMenu, CommandMenu, PageBar, useCommandMenuShortcut, validateAppNavigationTree, type AppNavigationNode } from "../../blocks/index.js";
import { ThemeProvider, useTheme } from "../../theme/index.js";
import { FrameSlotProvider, FrameSlotOutlet, useFramePageHeader } from "../../shell/FrameSlots.js";
import { framePageHeaderDeclaration } from "../../shell/FrameSlots.js";
import { SkipLink } from "../../shell/SkipLink.js";
import { InspectorFrame } from "../InspectorFrame.js";
import { ShellCopyProvider, useShellCopy } from "../../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../../components/Banner.copy.js";
import { ShellI18nProvider } from "#designer-frame-i18n";
import type { AppFrameProps } from "../app-frame-types.js";

/** Source surfaces expose change callbacks directly; nested AppFrame inputs remain compatible. */
export interface ShadcnAppShellProps extends AppFrameProps {
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
  if (account.actor) return <AccountMenu {...account} actor={{ ...account.actor, ...(account.avatar === "mark" ? { image: mark } : {}) }} />;
  return <Menu trigger={<Button variant="ghost" className="w-full justify-start"><Logomark src={mark} size="sm" />{account.signedOutLabel}</Button>}>
    {account.sections.map(section => <MenuSection key={section.id} heading={section.label} aria-label={section.label ?? account.signedOutLabel}>
      {section.entries.map(entry => <MenuItem key={entry.id} id={entry.id} isDisabled={entry.isDisabled} href={entry.kind === "link" ? entry.href : undefined}
        onAction={() => { if (entry.kind === "link") account.onRoute?.(entry); else if (entry.kind === "preference") entry.onCheckedChange(!entry.checked); else entry.onAction(); }}>{entry.label}</MenuItem>)}
    </MenuSection>)}
  </Menu>;
}

function Content(props: AppFrameProps) {
  const { navigation, brand, commands, account, rightPanel, state, stateViews, page, children } = props;
  const copy = useShellCopy(), theme = useTheme(), header = useFramePageHeader(), id = useId();
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
  const isCollapsed = navigation.collapsed ?? collapsed;
  const changeCollapsed = (next: boolean) => { if (navigation.collapsed === undefined) setCollapsed(next); navigation.onCollapsedChange?.(next); };
  const mainId = props.mainId ?? `main-content-${id.replaceAll(":", "")}`;
  const mark = theme.resolvedTheme === "dark" ? brand.reversedMarkSrc ?? brand.markSrc : brand.markSrc;
  const openNavigation = navigation.openLabel ?? copy(SHELL_COPY_REFS.frame.navigationOpen);
  const closeNavigation = navigation.closeLabel ?? copy(SHELL_COPY_REFS.frame.navigationClose);
  const openCommands = () => { setQuery(""); commands.onQueryChange?.(""); setCommandOpen(true); };
  useCommandMenuShortcut({ onOpen: openCommands, enabled: commands.shortcutEnabled !== false });
  validateAppNavigationTree(navigation.tree);
  const { triggerLabel, onQueryChange, shortcutEnabled: _shortcutEnabled, ...commandProps } = commands;
  const ready = state?.main === undefined || state.main === "ready";
  const main = ready ? props.main ?? children : stateViews?.[state.main];
  const railCopy = (ref: { id: string }) => ({ ref, text: copy(ref) });
  const sidebar = <>
    <SidebarHeader>
      <SemanticContent as="div" className="flex min-w-0 items-center gap-sm p-sm"><Logomark src={mark} size="sm" />{brand.navigationMark && <SemanticContent as="span" className="truncate text-body font-medium">{brand.navigationMark.label}</SemanticContent>}</SemanticContent>
      <Button variant="ghost" onPress={openCommands} className="w-full justify-start">{triggerLabel}</Button>
    </SidebarHeader>
    <SidebarContent><Navigation tree={navigation.tree} activeId={navigation.activeId} close={() => changeDrawer(false)} /><FrameSlotOutlet slot="left-sidebar" /></SidebarContent>
    <SidebarFooter><Account account={account} mark={mark} />{props.themeControl}</SidebarFooter>
  </>;
  return <SidebarProvider {...FRAME} dir={props.dir} open={!isCollapsed} onOpenChange={open => changeCollapsed(!open)}
    className={props.fill === "viewport" ? "h-dvh min-h-0 overflow-hidden bg-surface-raised" : "h-full min-h-0 overflow-hidden bg-surface-raised"}>
    <SkipLink targetId={mainId}>{props.skipLabel ?? copy(SHELL_COPY_REFS.frame.skip)}</SkipLink>
    {narrow ? <Sheet {...SIDEBAR} side={props.dir === "rtl" ? "right" : "left"} isOpen={drawerOpen} onOpenChange={changeDrawer} copyResolver={railCopy}>
      <SheetHeader><SheetTitle>{navigation.label ?? openNavigation}</SheetTitle></SheetHeader>
      <SemanticContent as="div" role="navigation" aria-label={navigation.label ?? openNavigation}>{sidebar}</SemanticContent>
    </Sheet> : <Sidebar {...SIDEBAR} variant="inset" collapsible="icon" copyResolver={railCopy} aria-label={navigation.label ?? openNavigation} role="navigation" onClick={event => {
      if (!props.onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href"); if (!href) return;
      event.preventDefault(); void Promise.resolve().then(() => props.onNavigate?.(href)).catch(() => {});
    }}>
      {sidebar}
    </Sidebar>}
    <SemanticContent as="div" className="flex min-h-0 min-w-0 flex-1 gap-sm p-sm">
      <SemanticContent as="div" data-slot="sidebar-inset" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-control border border-line-base bg-surface-base shadow-sm">
        <SemanticContent as="div" className="sticky top-0 z-sticky flex min-w-0 items-center gap-sm border-b border-line-base bg-surface-base px-md py-sm">
          <Button variant="ghost" aria-label={(narrow ? drawerOpen : !isCollapsed) ? closeNavigation : openNavigation} aria-expanded={narrow ? drawerOpen : !isCollapsed} onPress={() => narrow ? changeDrawer(!drawerOpen) : changeCollapsed(!isCollapsed)}>{(narrow ? drawerOpen : !isCollapsed) ? closeNavigation : openNavigation}</Button>
          <PageBar embedded header={header ?? undefined} page={page} context={props.context} root={props.root} workspaces={props.workspaces} onNavigate={props.onNavigate}
            labels={{ breadcrumb: props.breadcrumbLabel ?? copy(SHELL_COPY_REFS.frame.breadcrumb), collapsedBreadcrumb: props.collapsedBreadcrumbLabel ?? copy(SHELL_COPY_REFS.frame.collapsedBreadcrumb), pageInfo: props.pageInfoLabel ?? copy(SHELL_COPY_REFS.frame.pageInfo), pageActions: props.pageActionsLabel ?? copy(SHELL_COPY_REFS.frame.pageActions) }} />
        </SemanticContent>
        {state?.navigating && props.progress}
        <SemanticContent as="main" id={mainId} tabIndex={-1} className={props.stage === "full" ? "flex min-h-0 flex-1 flex-col overflow-auto" : "flex min-h-0 flex-1 flex-col gap-lg overflow-auto p-lg"}>
          {props.pageModule && <SemanticContent as="aside" aria-label={props.pageModuleLabel}>{props.pageModule}</SemanticContent>}
          {main}
        </SemanticContent>
      </SemanticContent>
      {rightPanel && <InspectorFrame {...rightPanel} closeLabel={rightPanel.closeLabel ?? copy(SHELL_COPY_REFS.frame.panelClose)} openLabel={rightPanel.openLabel ?? copy(SHELL_COPY_REFS.frame.panelOpen)}>{props.inspectorContext ?? rightPanel.children}</InspectorFrame>}
    </SemanticContent>
    {props.toasts}
    <CommandMenu {...commandProps} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={next => { setQuery(next); onQueryChange?.(next); }} dir={props.dir} />
  </SidebarProvider>;
}

/** A distinct sidebar/inset assembly, rather than an alias of the Foundry AppFrame. */
export function ShadcnAppShell(input: ShadcnAppShellProps) {
  const props: AppFrameProps = {
    ...input,
    navigation: { ...input.navigation, onCollapsedChange: input.onSidebarCollapsedChange ?? input.navigation.onCollapsedChange },
    ...(input.rightPanel ? { rightPanel: { ...input.rightPanel, onCollapsedChange: input.onInspectorCollapsedChange ?? input.rightPanel.onCollapsedChange, onChange: input.onInspectorWidthChange ?? input.rightPanel.onChange } } : {}),
    theme: { ...input.theme, onPreferenceChange: input.onThemePreferenceChange ?? input.theme?.onPreferenceChange },
  };
  return <ShellCopyProvider resolver={props.copyResolver}><ShellI18nProvider locale={props.locale}>
    <ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference} preference={props.theme?.preference} onPreferenceChange={props.theme?.onPreferenceChange}>
      <FrameSlotProvider initialHeader={framePageHeaderDeclaration(props.children)}><Content {...props} /></FrameSlotProvider>
    </ThemeProvider>
  </ShellI18nProvider></ShellCopyProvider>;
}
