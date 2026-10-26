"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createPortal } from "react-dom";

export const FRAME_SLOT_IDS = ["header-start", "header-center", "header-end", "left-sidebar", "right-panel", "dock-tab", "dock-strip"] as const;
export type FrameSlotId = typeof FRAME_SLOT_IDS[number];
export interface FrameSlotModule {
  id: string;
  slot: FrameSlotId;
  label: string;
  children: ReactNode;
  order?: number;
  summary?: ReactNode;
}
export type { FramePageHeaderDestination, FramePageHeaderNav, FramePageHeaderActions, FramePageHeader } from "../frame-page-header.js";
import type { FramePageHeader, FramePageHeaderNav } from "../frame-page-header.js";
type HeaderData = { id: string; title: string; nav?: FramePageHeaderNav; hasActions: boolean };
type HeaderLease = HeaderData & { owner: symbol };
type HeaderHost = { id: string; node: HTMLElement; compact: boolean };
type Lease = FrameSlotModule & { owner: symbol };
const Slots = createContext<{ header: HeaderLease | null; headerHost: HeaderHost | null; registerHeader: (header: HeaderData, owner: symbol) => () => void; mountHeader: (id: string, node: HTMLElement | null) => void; compactHeader: (id: string, compact: boolean) => void; modules: readonly Lease[]; hosts: ReadonlyMap<string, HTMLElement>; mount: (id: string, host: HTMLElement | null) => void; register: (module: FrameSlotModule, owner: symbol) => () => void } | null>(null);

function useRequiredFrameSlots() {
  const context = useContext(Slots);
  if (!context) throw new TypeError("Frame slots require FrameSlotProvider; standalone pages must supply a frame.");
  return context;
}

/** Page modules declare content; the frame alone chooses its geometry and responsive presentation. */
export function FrameSlotProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HeaderLease | null>(null);
  const [headerHost, setHeaderHost] = useState<HeaderHost | null>(null);
  const registerHeader = useCallback((data: HeaderData, owner: symbol) => {
    if (!data.id.trim() || !data.title.trim()) throw new TypeError("PageHeaderModule requires a nonempty id and title.");
    setHeader(previous => {
      if (previous && previous.owner !== owner) throw new TypeError("Frame page header already leased.");
      return { ...data, owner };
    });
    return () => setHeader(previous => previous?.owner === owner ? null : previous);
  }, []);
  const mountHeader = useCallback((id: string, node: HTMLElement | null) => setHeaderHost(previous => {
    if (!node) return previous?.id === id ? null : previous;
    return previous?.id === id && previous.node === node ? previous : { id, node, compact: false };
  }), []);
  const compactHeader = useCallback((id: string, compact: boolean) => setHeaderHost(previous => previous?.id === id && previous.compact !== compact ? { ...previous, compact } : previous), []);
  const [modules, setModules] = useState<readonly Lease[]>([]);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const mount = useCallback((id: string, host: HTMLElement | null) => setHosts(previous => {
    if (previous.get(id) === host || (!host && !previous.has(id))) return previous;
    const next = new Map(previous); if (host) next.set(id, host); else next.delete(id); return next;
  }), []);
  const register = useCallback((module: FrameSlotModule, owner: symbol) => {
    if (!module.id.trim() || !module.label.trim() || !FRAME_SLOT_IDS.includes(module.slot)) throw new TypeError("Frame slot: invalid module identity or slot.");
    setModules(previous => {
      if (previous.some(item => item.id === module.id && item.owner !== owner)) throw new TypeError("Frame slot: module id already leased.");
      return [...previous.filter(item => item.id !== module.id), { ...module, owner }];
    });
    return () => setModules(previous => previous.filter(item => item.owner !== owner));
  }, []);
  const value = useMemo(() => ({ modules, hosts, mount, register, header, headerHost, registerHeader, mountHeader, compactHeader }), [modules, hosts, mount, register, header, headerHost, registerHeader, mountHeader, compactHeader]);
  return <Slots.Provider value={value}>{children}</Slots.Provider>;
}

/** Lease lifetime follows the module's mounting lifetime; updates preserve its identity. */
export function useSlotLease(module: FrameSlotModule) {
  const slots = useRequiredFrameSlots();
  const owner = useRef(Symbol(module.id));
  const register = slots.register;
  const { id, slot, label, order, summary } = module;
  useLayoutEffect(() => register({ id, slot, label, children: null, order, summary }, owner.current), [register, id, slot, label, order, summary]);
  const host = slots.hosts.get(id);
  return host ? createPortal(module.children, host, id) : null;
}
export function SlotModule(module: FrameSlotModule) { return useSlotLease(module); }
export function useFrameSlotModules(slot: FrameSlotId): readonly FrameSlotModule[] {
  const context = useRequiredFrameSlots();
  return context.modules.filter(module => module.slot === slot).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}
export function FrameModuleOutlet({ id }: { id: string }) {
  const context = useRequiredFrameSlots();
  const mount = context.mount;
  const ref = useCallback((node: HTMLDivElement | null) => mount(id, node), [mount, id]);
  return <div ref={ref} className="contents" data-frame-module={id} />;
}
export function FrameSlotOutlet({ slot, children }: { slot: FrameSlotId; children?: ReactNode }) {
  const modules = useFrameSlotModules(slot);
  return <>{modules.length ? modules.map(module => <FrameModuleOutlet key={module.id} id={module.id} />) : children}</>;
}

/** A single page supplies data; Frame retains title, navigation, and overflow ownership. */
export function PageHeaderModule({ id, header }: { id: string; header: FramePageHeader }) {
  const context = useRequiredFrameSlots();
  const owner = useRef(Symbol(id));
  // Compare public data fields, never the identity of inline objects or render callbacks.
  const dataKey = JSON.stringify({ id, title: header.title, nav: header.nav && { label: header.nav.label, activeId: header.nav.activeId, items: header.nav.items.map(({ id, label, href }) => ({ id, label, href })) }, hasActions: Boolean(header.actions) });
  const data = useMemo(() => JSON.parse(dataKey) as HeaderData, [dataKey]);
  const register = context.registerHeader;
  useLayoutEffect(() => register(data, owner.current), [register, data]);
  const host = context.headerHost;
  return host?.id === id && header.actions ? createPortal(header.actions.render({ compact: host.compact }), host.node, id) : null;
}
function PageHeaderActionsOutlet({ id, compact }: { id: string; compact: boolean }) {
  const { mountHeader, compactHeader } = useRequiredFrameSlots();
  const ref = useCallback((node: HTMLDivElement | null) => mountHeader(id, node), [mountHeader, id]);
  useLayoutEffect(() => compactHeader(id, compact), [compactHeader, id, compact]);
  return <div ref={ref} className="contents" data-frame-header-module={id} />;
}
export function useFramePageHeader(fallback?: FramePageHeader): FramePageHeader | undefined {
  const { header, modules } = useRequiredFrameSlots();
  const leased = useMemo<FramePageHeader | undefined>(() => header ? { title: header.title, nav: header.nav, actions: header.hasActions ? { render: ({ compact }) => <PageHeaderActionsOutlet id={header.id} compact={compact} /> } : undefined } : undefined, [header]);
  if (modules.some(module => module.slot.startsWith("header-"))) throw new TypeError("Frame page headers require PageHeaderModule rather than raw header slots.");
  return leased ?? fallback;
}
