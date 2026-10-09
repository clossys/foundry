"use client";

import type { AnalyticsPermissionPort, ConsentLifecyclePort } from "./ports.js";

function setPermission(transport: AnalyticsPermissionPort, allowed: boolean): void {
  try {
    transport.setPermission(allowed);
  } catch {
    console.error("bindTransport: the transport's setPermission threw.");
  }
}

/**
 * Binds an analytics transport to a consent lifecycle synchronously.
 *
 * `setPermission(snapshot.allowed && !snapshot.simulated)` runs once when
 * bound and again inside every `subscribe` notification, never from a React
 * effect, so a withdrawal reaches the transport before `refuse()` returns.
 * The returned function unbinds and sets permission to `false`. A simulated
 * snapshot never sets `true`. A throw from the transport or the lifecycle is
 * caught and logged without its value, so neither can crash the page; a
 * snapshot that cannot be read sets permission to `false`.
 */
export function bindTransport(lifecycle: ConsentLifecyclePort, transport: AnalyticsPermissionPort): () => void {
  let bound = true;
  const apply = (): void => {
    if (!bound) return;
    let allowed = false;
    try {
      const snapshot = lifecycle.getSnapshot();
      allowed = snapshot.allowed === true && snapshot.simulated === false;
    } catch {
      console.error("bindTransport: the lifecycle's getSnapshot threw, so permission is false.");
    }
    setPermission(transport, allowed);
  };
  const unsubscribe = lifecycle.subscribe(apply);
  apply();
  return () => {
    if (!bound) return;
    bound = false;
    try {
      unsubscribe();
    } catch {
      console.error("bindTransport: the lifecycle's unsubscribe threw.");
    }
    setPermission(transport, false);
  };
}
