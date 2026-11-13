"use client";
import { useReducer, useRef } from "react";

/**
 * A back stack the host may keep above the panel, so it survives the panel remounting (a host that shows
 * each layer in a different inspector). Elements visited before the current one, oldest first.
 */
export interface UsageHistory { readonly stack: string[] }

export interface UsageNavigation {
  readonly canGoBack: boolean;
  /** Go to an element: the current one is pushed, then the host is told. */
  select(id: string): void;
  /** Return to the element visited before this one. */
  back(): void;
}

/**
 * The Usage area's back stack. Frame-agnostic: it never switches a tab itself, it only calls the host's
 * `onNavigate(id)`, and the host decides what showing that element means.
 */
export function useUsageNavigation(current: string, onNavigate: (id: string) => void, history?: UsageHistory): UsageNavigation {
  const own = useRef<UsageHistory>({ stack: [] });
  const stack = (history ?? own.current).stack;
  const [, changed] = useReducer((count: number) => count + 1, 0);
  return {
    canGoBack: stack.length > 0,
    select(id) {
      if (id === current) return;
      stack.push(current); changed();
      onNavigate(id);
    },
    back() {
      const previous = stack.pop();
      if (previous === undefined) return;
      changed();
      onNavigate(previous);
    },
  };
}
