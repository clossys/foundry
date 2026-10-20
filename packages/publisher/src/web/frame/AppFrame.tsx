"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ModalContext, PopoverContext } from "react-aria-components";
import { Button, Icon, Menu } from "@clossys/designer/atoms";
import { Layers, Search } from "@clossys/designer/icons";
import { AccountMenu, AppNavigation, CommandMenu, Drawer, ResizablePane, useCommandMenuShortcut } from "@clossys/designer/blocks";
import { ThemeProvider, ThemeToggle } from "@clossys/designer/theme";
import { AppFrameBrand } from "./AppFrameBrand.js";
import { SiteSkipLink } from "./SkipLink.client.js";
import { APP_FRAME_WIDE_QUERY, appFrameMainId } from "./app-frame-layout.js";
import type { AppFrameAccount, AppFrameProps } from "./app-frame-types.js";

const CONTROL = "inline-flex shrink-0 items-center justify-center rounded-control border-0 bg-transparent px-sm text-body text-ink-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent forced-colors:border-current";
const TAP = { minBlockSize: "var(--ui-layout-tap-target, 44px)", minInlineSize: "var(--ui-layout-tap-target, 44px)" };
const HEADER = { minBlockSize: "calc(var(--ui-layout-tap-target, 44px) + 2 * var(--spacing-sm, 8px))" };

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

function FrameContent({ brand, navigation, account, commands, children, rightPanel, theme, dir,
  /** @default "Skip to content" */
  skipLabel = "Skip to content", mainId }: AppFrameProps) {
  const generated = useId();
  const target = appFrameMainId(mainId, generated);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openCommands = useCallback(() => { setQuery(""); setCommandOpen(true); }, []);
  const { shortcutEnabled = true, triggerLabel, ...commandProps } = commands;
  useCommandMenuShortcut({ onOpen: openCommands, enabled: shortcutEnabled });
  const [narrow, setNarrow] = useState(false);
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
  const panelDrawer = useRef<HTMLDivElement>(null);
  const panelExpanding = useRef(false);
  const panelFocused = useRef(false);
  useEffect(() => {
    const media = window.matchMedia(APP_FRAME_WIDE_QUERY);
    const sync = () => {
      const active = document.activeElement;
      panelFocused.current = active !== null && frame.current?.contains(active) === true && active.closest("[data-application-frame-panel]") !== null;
      panelExpanding.current = media.matches && active !== null && panelDrawer.current?.contains(active) === true;
      if (panelExpanding.current) { setPanelOpen(false); return; }
      setNarrow(!media.matches); setPanelOpen(false);
    };
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (panelOpen || !panelExpanding.current) return;
    panelExpanding.current = false;
    // Release the modal focus trap, then focus content before removing its narrow opener.
    frame.current?.querySelector<HTMLElement>("main")?.focus();
    setNarrow(false);
  }, [panelOpen]);
  useEffect(() => {
    // The responsive handoff unmounts the focused panel control; focus its replacement opener instead of the document.
    if (!panelFocused.current) return;
    panelFocused.current = false;
    frame.current?.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]')?.focus();
  }, [narrow]);
  const changeCollapsed = (next: boolean) => { setPanelCollapsed(next); rightPanel?.onCollapsedChange?.(next); };
  const footer = account.actor ? <AccountMenu {...account} actor={account.actor} collapsed={navCollapsed && !narrow} /> : <SignedOutMenu {...account} />;
  const panelTrigger = rightPanel && (narrow ? <ModalContext.Provider value={{ ref: panelDrawer, style: { direction: dir } }}><Drawer wide="sheet" placement="end" dismissAt={APP_FRAME_WIDE_QUERY}
    heading={rightPanel.label} closeLabel={closeLabel} navigationKey={navigation.navigationKey}
    isOpen={panelOpen} onOpenChange={setPanelOpen}
    trigger={<Button variant="ghost" className={CONTROL} style={TAP} aria-label={openLabel} data-application-frame-panel="trigger"><Icon glyph={Layers} decorative /><span className="sr-only tablet:not-sr-only">{openLabel}</span></Button>}>
    {rightPanel.children}
  </Drawer></ModalContext.Provider> : <Button variant="ghost" className={CONTROL} style={TAP} aria-expanded={!collapsed} data-application-frame-panel="trigger"
    onPress={() => changeCollapsed(!collapsed)}><Icon glyph={Layers} decorative /><span className="sr-only tablet:not-sr-only">{collapsed ? openLabel : closeLabel}</span></Button>);
  return <ModalContext.Provider value={{ style: { direction: dir } }}><PopoverContext.Provider value={{ style: { direction: dir } }}>
    <div ref={frame} dir={dir} data-application-frame="" className="relative flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-surface-base text-body text-ink-primary">
      <SiteSkipLink targetId={target} label={skipLabel} />
      <header className="relative flex shrink-0 items-center justify-end gap-sm border-b border-line-base bg-surface-raised px-sm tablet:justify-between tablet:px-md"
        style={HEADER}>
        <div className="absolute start-1/2 -translate-x-1/2 rtl:translate-x-1/2 tablet:static tablet:translate-x-0 tablet:rtl:translate-x-0"><AppFrameBrand {...brand} /></div>
        <div className="flex min-w-0 items-center gap-xs">
          <Button variant="ghost" className={CONTROL} style={TAP} onPress={openCommands}><Icon glyph={Search} decorative /><span className="sr-only tablet:not-sr-only">{triggerLabel}</span></Button>
          <ThemeToggle className={CONTROL} style={TAP} preferenceLabels={theme?.preferenceLabels} toggleLabel={theme?.toggleLabel} preferenceAnnouncement={theme?.preferenceAnnouncement} />
          {panelTrigger}
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="absolute start-0 top-0 flex items-center px-sm tablet:static tablet:h-full tablet:items-stretch tablet:border-e tablet:border-line-base tablet:px-0"
          style={narrow ? HEADER : undefined}>
          <AppNavigation {...navigation} dismissAt={APP_FRAME_WIDE_QUERY} footer={footer} collapsed={navCollapsed}
            onCollapsedChange={next => { setNavigationCollapsed(next); navigation.onCollapsedChange?.(next); }} />
        </div>
        <main id={target} tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-auto p-md focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent">{children}</main>
        {rightPanel && !narrow && !collapsed && <ResizablePane min={rightPanel.min} max={rightPanel.max} defaultValue={rightPanel.defaultValue}
          value={rightPanel.value ?? width} step={rightPanel.step} label={rightPanel.label} handleLabel={rightPanel.handleLabel}
          onChange={next => { setWidth(next); rightPanel.onChange?.(next); }}
          data-application-frame-panel="pane" className="h-full min-h-0 shrink-0 rounded-none border-0 border-s border-line-base p-sm">{rightPanel.children}</ResizablePane>}
      </div>
      <CommandMenu {...commandProps} dir={dir} isOpen={commandOpen} onOpenChange={setCommandOpen} query={query} onQueryChange={setQuery} />
    </div>
  </PopoverContext.Provider></ModalContext.Provider>;
}

/** Host-resolved application chrome; the host owns routes, account actions and main-free route content. */
export function AppFrame(props: AppFrameProps) {
  return <ThemeProvider storageKey={props.theme?.storageKey} defaultPreference={props.theme?.defaultPreference}><FrameContent {...props} /></ThemeProvider>;
}
