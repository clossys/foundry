"use client";
import { useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChevronDown } from "../icons/index.js";
import { Drawer, ResizablePane } from "../blocks/index.js";
import { cx } from "../components/internal/cx.js";
import { FrameModuleOutlet, FrameSlotOutlet, useFrameSlotModules } from "../shell/index.js";
import { useFrameNoticeLeases, visibleFrameNotices, type AppFrameNotice } from "./frame-notices.js";
import { frameDockGeometry, FRAME_DOCK_DEFAULTS, FRAME_NOTICE_COMPACT_BLOCK, type FrameDockBounds } from "./frame-dock-layout.js";
import { FrameZoomGestures } from "./frame-zoom-gestures.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Banner = componentLeaf<typeof import("../components/index.js").Banner>("components.banner");
const Button = componentLeaf<typeof import("../components/index.js").Button>("components.button");
const Icon = componentLeaf<typeof import("../components/index.js").Icon>("components.icon");
const Tabs = componentLeaf<typeof import("../components/index.js").Tabs>("components.tabs");

export interface AppFrameDock extends FrameDockBounds {
  label: string;
  handleLabel: string;
  value?: number;
  onChange?: (height: number) => void;
}
const DISMISS_KEY = "frame-dismissed-notices";
/** Disclosure chevrons turn on the shared motion tokens; reduced motion snaps. */
export const FRAME_CHEVRON_MOTION = "frame-chevron-motion";
/** `sheet` is the frame's narrow layout (the sidebar-overlay breakpoint): the dock body becomes a bottom-sheet Drawer. */
export function FrameDock({ notices = [], dock, sheet = false }: { notices?: readonly AppFrameNotice[]; dock?: AppFrameDock; sheet?: boolean }) {
  const copy = useShellCopy();
  const modules = useFrameSlotModules("dock-tab");
  const strips = useFrameSlotModules("dock-strip");
  const [active, setActive] = useState<string>();
  const selected = modules.some(module => module.id === active) ? active : modules[0]?.id;
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A layout change never opens a modal sheet on its own.
  useEffect(() => { if (!sheet) setSheetOpen(false); }, [sheet]);
  const [height, setHeight] = useState(dock?.defaultValue ?? FRAME_DOCK_DEFAULTS.defaultValue);
  const [available, setAvailable] = useState<number>();
  const [short, setShort] = useState(false);
  const region = useRef<HTMLElement>(null);
  const noticesRegion = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { try { const ids: unknown = JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? "[]"); if (Array.isArray(ids)) setDismissed(new Set(ids.filter(id => typeof id === "string"))); } catch {} }, []);
  const dismiss = (id: string) => setDismissed(previous => {
    const next = new Set(previous).add(id);
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch {}
    return next;
  });
  const leased = useFrameNoticeLeases();
  const sorted = visibleFrameNotices(leased.length ? [...notices, ...leased] : notices, dismissed);
  // Severity order puts the most urgent notice first, so a short frame keeps that one.
  const visible = short ? sorted.slice(0, 1) : sorted;
  useLayoutEffect(() => {
    const root = region.current;
    const frame = root?.closest<HTMLElement>("[data-application-frame]");
    const header = frame?.querySelector<HTMLElement>('[data-application-frame-region="header"]');
    if (!root || !frame || !header) return;
    const measure = () => {
      const frameHeight = frame.getBoundingClientRect().height;
      // A short frame keeps the stage: one single-line notice instead of a stack.
      setShort(frameHeight > 0 && frameHeight < FRAME_NOTICE_COMPACT_BLOCK);
      const css = getComputedStyle(root);
      const border = (Number.parseFloat(css.borderBlockStartWidth) || 0) + (Number.parseFloat(css.borderBlockEndWidth) || 0);
      setAvailable(Math.max(0, frameHeight - header.getBoundingClientRect().height - (noticesRegion.current?.getBoundingClientRect().height ?? 0) - (strip.current?.getBoundingClientRect().height ?? 0) - border));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    for (const target of [frame, header, noticesRegion.current, strip.current]) if (target) observer?.observe(target);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [modules.length, strips.length, visible.length]);
  const geometry = frameDockGeometry(available, dock, dock?.value ?? height);
  // Mounted in every dock state so the frame gesture owner keeps one identity as the dock appears.
  const gestures = <FrameZoomGestures />;
  if (!modules.length && !strips.length && !visible.length) return <>{gestures}</>;
  const panels = modules.map(module => <Tabs.Panel key={module.id} id={module.id} className="min-h-0 min-w-0 overflow-auto"><FrameModuleOutlet id={module.id} /></Tabs.Panel>);
  const content = modules.length > 0 ? <ResizablePane orientation="horizontal" handleEdge="start" label={dock?.label ?? copy(SHELL_COPY_REFS.dock.label)} handleLabel={dock?.handleLabel ?? copy(SHELL_COPY_REFS.dock.handle)}
    {...geometry} onChange={next => { setHeight(next); dock?.onChange?.(next); }} className="min-h-0 rounded-none border-0 p-0">{panels}</ResizablePane> : null;
  return <>{gestures}<SemanticContent as="section" ref={region} data-application-frame-region="dock" className="min-w-0 shrink-0 border-t border-line-base bg-surface-raised">
    <SemanticContent as="div" ref={noticesRegion} data-frame-notices="" data-frame-notices-compact={short || undefined} className="flex w-full flex-col">
      {visible.map(notice => <Banner key={notice.id} variant={notice.severity === "error" ? "danger" : notice.severity}
        className={cx("w-full rounded-none", short && "items-center py-xs first-child-shrink")} onDismiss={notice.severity !== "error" && notice.dismissible !== false ? () => dismiss(notice.id) : undefined}>
        <SemanticContent as="div" className="mx-auto flex w-full max-w-wide items-center justify-between gap-sm"><SemanticContent as="span" className={cx(short && "min-w-0 truncate")}>{notice.text}</SemanticContent>{notice.action && <Button variant="ghost" onPress={notice.action.onAction}>{notice.action.label}</Button>}</SemanticContent>
      </Banner>)}
    </SemanticContent>
    {modules.length > 0 && sheet ? <SemanticContent as="div" ref={strip} data-frame-dock-strip="" className="flex min-w-0 items-center justify-between gap-xs px-sm">
      <Drawer placement="bottom" wide="sheet" heading={dock?.label ?? copy(SHELL_COPY_REFS.dock.label)} closeLabel={copy(SHELL_COPY_REFS.dock.collapse)} isOpen={sheetOpen} onOpenChange={setSheetOpen}
        trigger={<Button variant="ghost" className="icon-control-sm rounded-control p-0" aria-label={dock?.label ?? copy(SHELL_COPY_REFS.dock.label)} aria-expanded={sheetOpen}><Icon glyph={ChevronDown} decorative className={cx(FRAME_CHEVRON_MOTION, !sheetOpen && "rotate-180")} /></Button>}>
        <Tabs selectedKey={selected} onSelectionChange={key => setActive(String(key))} className="flex h-full min-h-0 flex-col gap-0">
          <Tabs.List aria-label={dock?.label ?? copy(SHELL_COPY_REFS.dock.label)} className="min-w-0 shrink-0 overflow-x-auto">
            {modules.map(module => <Tabs.Tab key={module.id} id={module.id} className="control-h-sm">{module.label}</Tabs.Tab>)}
          </Tabs.List>
          {modules.map(module => <Tabs.Panel key={module.id} id={module.id} className="min-h-0 min-w-0 flex-1 overflow-auto"><FrameModuleOutlet id={module.id} /></Tabs.Panel>)}
        </Tabs>
      </Drawer>
      <SemanticContent as="div" className="ms-auto flex shrink-0 items-center gap-xs"><FrameSlotOutlet slot="dock-strip" /></SemanticContent>
    </SemanticContent> : modules.length > 0 ? <Tabs selectedKey={selected} onSelectionChange={key => { setActive(String(key)); setExpanded(true); }} className="gap-0">
      <SemanticContent as="div" ref={strip} data-frame-dock-strip="" className="flex min-w-0 items-center justify-between gap-xs px-sm">
        {modules.length > 0 && <Tabs.List aria-label={dock?.label ?? copy(SHELL_COPY_REFS.dock.label)} className="min-w-0 flex-1 overflow-x-auto border-0">
          {modules.map(module => <Tabs.Tab key={module.id} id={module.id} onPress={() => setExpanded(true)} className="control-h-sm">{module.label}</Tabs.Tab>)}
        </Tabs.List>}
        {modules.length > 0 && <Button size="sm" variant="ghost" className="icon-control-sm rounded-control p-0" aria-label={copy(expanded ? SHELL_COPY_REFS.dock.collapse : SHELL_COPY_REFS.dock.expand)} aria-expanded={expanded} onPress={() => setExpanded(!expanded)}><Icon glyph={ChevronDown} decorative size="sm" className={cx(FRAME_CHEVRON_MOTION, !expanded && "rotate-180")} /></Button>}
        <SemanticContent as="div" className="ms-auto flex shrink-0 items-center gap-xs"><FrameSlotOutlet slot="dock-strip" /></SemanticContent>
      </SemanticContent>
      {expanded && content}
    </Tabs> : strips.length > 0 ? <SemanticContent as="div" className="flex min-w-0 items-center justify-end gap-xs px-sm"><FrameSlotOutlet slot="dock-strip" /></SemanticContent> : null}

  </SemanticContent></>;
}
