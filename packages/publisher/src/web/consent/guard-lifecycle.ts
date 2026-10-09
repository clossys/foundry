"use client";

import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";

/** A lifecycle whose calls cannot throw into React: a failure reads as a fixed failure snapshot. */
export interface GuardedLifecycle extends ConsentLifecyclePort {
  failed(): boolean;
  /** Subscribes a React store listener, notified in a microtask on failure because a read can happen during render. */
  subscribeDeferred(listener: () => void): () => void;
}

/**
 * The failure snapshot after a throw from `refuse()` while analytics was
 * allowed, or after a snapshot that showed a failed withdrawal.
 */
export const FAILED_WITHDRAWAL_VIEW: ConsentSnapshotView = Object.freeze({ ...NO_DECISION_VIEW, withdrawal: "failed" });

const SNAPSHOT_KEYS = Object.keys(NO_DECISION_VIEW) as (keyof ConsentSnapshotView)[];

/** Every snapshot field is present with the type the no-decision snapshot gives it. */
function isSnapshotView(value: unknown): value is ConsentSnapshotView {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return SNAPSHOT_KEYS.every((key) => typeof record[key] === typeof NO_DECISION_VIEW[key]);
}

/** Runs each listener; a throwing listener cannot stop the others. */
function notify(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's own failure leaves the failure snapshot in place.
    }
  }
}

/**
 * Wraps the host's lifecycle so a throw or a malformed snapshot from any of
 * its calls never reaches React. The first failure is logged and every
 * later read returns the failure snapshot: `FAILED_WITHDRAWAL_VIEW` when the
 * failure came from `refuse()` while the last snapshot read allowed
 * analytics, or when that snapshot showed a failed withdrawal, and the
 * no-decision snapshot otherwise. The microtask that notifies listeners
 * from `subscribeDeferred`, then runs `onFailure`, is queued first; then
 * listeners from `subscribe` are notified synchronously, so a bound
 * transport reads the failure snapshot before the failing call returns.
 */
export function guardLifecycle(lifecycle: ConsentLifecyclePort, onFailure: () => void): GuardedLifecycle {
  let failed = false;
  let disposed = false;
  let failureView = NO_DECISION_VIEW;
  let lastAllowed = false;
  let withdrawalFailed = false;
  const syncListeners = new Set<() => void>();
  const deferredListeners = new Set<() => void>();
  const fail = (fromRefuse: boolean, log: () => void): ConsentSnapshotView => {
    if (!failed) {
      failed = true;
      if ((fromRefuse && lastAllowed) || withdrawalFailed) failureView = FAILED_WITHDRAWAL_VIEW;
      log();
      queueMicrotask(() => {
        notify(deferredListeners);
        onFailure();
      });
      notify(syncListeners);
    }
    return failureView;
  };
  const threw = (error: unknown) => () => {
    console.error("ConsentExperience: the lifecycle threw, so analytics is not allowed.", error);
  };
  const malformed = (): void => {
    console.error("ConsentExperience: the lifecycle returned a malformed snapshot, so analytics is not allowed.");
  };
  const read = (call: () => ConsentSnapshotView, fromRefuse = false): ConsentSnapshotView => {
    if (failed) return failureView;
    let view: unknown;
    try {
      view = call();
    } catch (error) {
      return fail(fromRefuse, threw(error));
    }
    if (!isSnapshotView(view)) return fail(fromRefuse, malformed);
    lastAllowed = view.allowed;
    withdrawalFailed = view.withdrawal === "failed";
    return view;
  };
  const listen = (listeners: Set<() => void>, listener: () => void): (() => void) => {
    if (failed) return () => {};
    let unsubscribe: () => void;
    try {
      unsubscribe = lifecycle.subscribe(listener);
    } catch (error) {
      fail(false, threw(error));
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      try {
        unsubscribe();
      } catch {
        // A lifecycle that cannot unsubscribe is disposed with the assembly.
      }
    };
  };
  return {
    failed: () => failed,
    getSnapshot: () => read(() => lifecycle.getSnapshot()),
    subscribe: (listener) => listen(syncListeners, listener),
    subscribeDeferred: (listener) => listen(deferredListeners, listener),
    grant: () => read(() => lifecycle.grant()),
    refuse: () => read(() => lifecycle.refuse(), true),
    refresh: () => read(() => lifecycle.refresh()),
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        lifecycle.dispose();
      } catch {
        // Disposal failure leaves nothing for the assembly to do.
      }
    },
  };
}
