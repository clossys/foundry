"use client";

import type { AnalyticsPermissionPort, ConsentLifecyclePort } from "./ports.js";

/**
 * Binds an analytics transport to a consent lifecycle synchronously.
 *
 * `setPermission(snapshot.allowed && !snapshot.simulated)` runs once when
 * bound and again inside every `subscribe` notification, never from a React
 * effect, so a withdrawal reaches the transport before `refuse()` returns.
 * The returned function unbinds and sets permission to `false`. A simulated
 * snapshot never sets `true`.
 */
export function bindTransport(lifecycle: ConsentLifecyclePort, transport: AnalyticsPermissionPort): () => void {
  let bound = true;
  const apply = (): void => {
    if (!bound) return;
    const snapshot = lifecycle.getSnapshot();
    transport.setPermission(snapshot.allowed === true && snapshot.simulated === false);
  };
  const unsubscribe = lifecycle.subscribe(apply);
  apply();
  return () => {
    if (!bound) return;
    bound = false;
    unsubscribe();
    transport.setPermission(false);
  };
}
