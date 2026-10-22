"use client";

import { useEffect, useRef } from "react";

/** The default reopen fragment, written without `#`. */
export const DEFAULT_REOPEN_FRAGMENT = "privacy-choices";
/** The default document event that reopens the notice. */
export const DEFAULT_REOPEN_EVENT = "privacy-choices:open";

/** Normalises the fragment prop: a leading `#` is ignored, `false` or an empty name disables it. */
export function normaliseReopenFragment(fragment: string | false | undefined): string | null {
  if (fragment === false) return null;
  const name = (fragment ?? DEFAULT_REOPEN_FRAGMENT).replace(/^#/, "");
  return name.length > 0 ? name : null;
}

/** Normalises the event prop: `false` or an empty name disables it. */
export function normaliseReopenEvent(eventName: string | false | undefined): string | null {
  if (eventName === false) return null;
  const name = eventName ?? DEFAULT_REOPEN_EVENT;
  return name.length > 0 ? name : null;
}

function currentFragment(): string | null {
  const hash = globalThis.location?.hash ?? "";
  if (!hash.startsWith("#")) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

function clearFragment(): void {
  try {
    const { pathname, search } = globalThis.location;
    globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${search}`);
  } catch {
    // Clearing the fragment is best effort; the notice is already open.
  }
}

/**
 * Listens for the reopen fragment and the reopen event once `enabled`, and
 * calls `onReopen` for each trigger. A fragment present when the listener is
 * enabled is honoured then, so a fragment at load is honoured after mount;
 * an event dispatched before that is not queued. After `onReopen` runs for a
 * fragment, the fragment is removed with `history.replaceState`, adding no
 * history entry. `onReopen` itself decides whether a trigger is a no-op.
 */
export function useConsentReopen(options: {
  enabled: boolean;
  fragment: string | null;
  eventName: string | null;
  onReopen: () => void;
}): void {
  const { enabled, fragment, eventName } = options;
  const onReopenRef = useRef(options.onReopen);
  onReopenRef.current = options.onReopen;

  useEffect(() => {
    if (!enabled) return undefined;
    const checkFragment = (): void => {
      if (fragment === null || currentFragment() !== fragment) return;
      onReopenRef.current();
      clearFragment();
    };
    const onEvent = (): void => {
      onReopenRef.current();
    };
    checkFragment();
    if (fragment !== null) globalThis.addEventListener("hashchange", checkFragment);
    if (eventName !== null) globalThis.document.addEventListener(eventName, onEvent);
    return () => {
      if (fragment !== null) globalThis.removeEventListener("hashchange", checkFragment);
      if (eventName !== null) globalThis.document.removeEventListener(eventName, onEvent);
    };
  }, [enabled, fragment, eventName]);
}
