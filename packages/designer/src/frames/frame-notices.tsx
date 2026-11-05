"use client";
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast, type ToastFunction } from "../shell/Toaster.js";
export interface AppFrameNotice {
  id: string;
  severity: "error" | "warning" | "success" | "info";
  text: ReactNode;
  action?: { label: string; onAction: () => void };
  /** Defaults to true. `false` keeps the notice in view with no dismiss control, ignoring any earlier dismissal of the same id: use it for a pending state that must stay visible until it resolves. Error notices are never dismissible. */
  dismissible?: boolean;
}
const priority = { error: 0, warning: 1, success: 2, info: 2 } as const;
/** Input order is oldest first; the newest message within a severity bucket is nearest the stage. */
export function visibleFrameNotices(notices: readonly AppFrameNotice[], dismissed: ReadonlySet<string>) {
  if (new Set(notices.map(notice => notice.id)).size !== notices.length || notices.some(notice => !notice.id.trim())) throw new TypeError("Frame notices: message ids must be nonempty and unique.");
  return notices.map((notice, index) => ({ notice, index })).filter(({ notice }) => notice.severity === "error" || notice.dismissible === false || !dismissed.has(notice.id))
    .sort((a, b) => priority[a.notice.severity] - priority[b.notice.severity] || b.index - a.index).slice(0, 3).map(({ notice }) => notice);
}

type Lease = { owner: symbol; notice: AppFrameNotice };
const NO_LEASES: readonly Lease[] = [];
const same = (a: AppFrameNotice, b: AppFrameNotice) => a.id === b.id && a.severity === b.severity && a.text === b.text && a.action === b.action && a.dismissible === b.dismissible;
/** Page leases live outside React state so a page re-render never re-renders the frame chrome, only the notice region. */
function createFrameNoticeStore() {
  let leases = NO_LEASES;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => leases,
    lease(owner: symbol, notice: AppFrameNotice) {
      const current = leases.find(lease => lease.owner === owner);
      if (current && same(current.notice, notice)) return;
      leases = current ? leases.map(lease => lease.owner === owner ? { owner, notice } : lease) : [...leases, { owner, notice }];
      emit();
    },
    release(owner: symbol) {
      if (!leases.some(lease => lease.owner === owner)) return;
      leases = leases.filter(lease => lease.owner !== owner);
      emit();
    },
  };
}
type FrameNoticeStore = ReturnType<typeof createFrameNoticeStore>;
const FrameNotices = createContext<FrameNoticeStore | null>(null);

/** AppFrame mounts one notice registry; pages reach it only through useFrameNotice. */
export function FrameNoticeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFrameNoticeStore);
  return <FrameNotices.Provider value={store}>{children}</FrameNotices.Provider>;
}
/** The frame's own notice region reads page leases, oldest first, after host-supplied notices. */
export function useFrameNoticeLeases(): readonly AppFrameNotice[] {
  const store = useContext(FrameNotices);
  const leases = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.snapshot ?? noLeases, noLeases);
  return leases.map(lease => lease.notice);
}
const noSubscription = () => () => {};
const noLeases = () => NO_LEASES;
export interface FrameNoticeApi {
  /** Frame-routed toasts: they render in the frame's toast region, clear of the header and dock. */
  toast: ToastFunction;
}
const API: FrameNoticeApi = { toast };

/**
 * Pages submit transient chrome to the frame instead of rendering their own banners or toast stacks.
 * A non-null notice is held in the frame notice region for as long as the page passes it and stays mounted;
 * passing null or undefined withdraws it. Ids share one namespace with AppFrame's own `notices`.
 */
export function useFrameNotice(notice?: AppFrameNotice | null): FrameNoticeApi {
  const store = useContext(FrameNotices);
  if (!store) throw new TypeError("useFrameNotice requires an AppFrame; standalone pages must supply a frame.");
  const owner = useRef<symbol | null>(null);
  owner.current ??= Symbol("frame-notice");
  useLayoutEffect(() => { if (notice) store.lease(owner.current!, notice); else store.release(owner.current!); });
  useLayoutEffect(() => () => store.release(owner.current!), [store]);
  return API;
}
