"use client";
import { useCallback, useEffect, useState } from "react";

/** The rail's cards, in rail order. */
export type RailCardId = "explorer" | "inspector" | "map" | "zoom" | "checks";
export const RAIL_CARDS: readonly RailCardId[] = ["explorer", "inspector", "map", "zoom", "checks"];

/** Per-user rail view: whether the whole rail is hidden, and which cards are collapsed (in rail order). */
export interface RailViewState { readonly hidden: boolean; readonly collapsed: readonly RailCardId[] }
export const RAIL_VIEW_KEY = "designer-rail-view";
export const DEFAULT_RAIL_VIEW: RailViewState = Object.freeze({ hidden: false, collapsed: Object.freeze(["checks"]) as readonly RailCardId[] });

/** The slice of Web Storage the rail uses; null when the page has none. */
export type RailStore = Pick<Storage, "getItem" | "setItem">;

/** A stored value, tolerating anything malformed or foreign: unknown cards are dropped and duplicates collapse. */
export function parseRailView(raw: string | null): RailViewState {
  if (!raw) return DEFAULT_RAIL_VIEW;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_RAIL_VIEW;
    const { hidden, collapsed, version } = value as { hidden?: unknown; collapsed?: unknown; version?: unknown };
    const listed: readonly unknown[] = Array.isArray(collapsed) ? collapsed : [];
    return { hidden: hidden === true, collapsed: RAIL_CARDS.filter(id => listed.includes(id) || id === "checks" && version !== 2) };
  } catch { return DEFAULT_RAIL_VIEW; }
}

/** Read the stored view; a missing or throwing store degrades to the default. */
export function readRailView(store: RailStore | null): RailViewState {
  try { return store ? parseRailView(store.getItem(RAIL_VIEW_KEY)) : DEFAULT_RAIL_VIEW; } catch { return DEFAULT_RAIL_VIEW; }
}

/** Store the view; a missing or throwing store is ignored (storage is optional). */
export function writeRailView(state: RailViewState, store: RailStore | null): void {
  try { store?.setItem(RAIL_VIEW_KEY, JSON.stringify({ version: 2, hidden: state.hidden, collapsed: RAIL_CARDS.filter(id => state.collapsed.includes(id)) })); } catch { /* Storage is optional. */ }
}

/** The page's localStorage, or null where reading it throws (sandboxed frames, blocked site data) or it is absent. */
export function railStore(): RailStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * The persisted rail view. It reads after mount (the server and the first paint use the default), like the
 * package's other Web Storage readers, and writes on every change.
 */
export function useRailView(): readonly [RailViewState, (change: (current: RailViewState) => RailViewState) => void] {
  const [view, setView] = useState<RailViewState>(DEFAULT_RAIL_VIEW);
  useEffect(() => { setView(readRailView(railStore())); }, []);
  const update = useCallback((change: (current: RailViewState) => RailViewState) => {
    setView(current => { const next = change(current); writeRailView(next, railStore()); return next; });
  }, []);
  return [view, update] as const;
}
