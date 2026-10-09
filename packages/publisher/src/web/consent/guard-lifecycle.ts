"use client";

import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";

/** A lifecycle whose calls cannot throw into React: a failure reads as a fixed failure snapshot. */
export interface GuardedLifecycle extends ConsentLifecyclePort {
  failed(): boolean;
  /** Subscribes a React store listener, notified in a microtask on failure because a read can happen during render. */
  subscribeDeferred(listener: () => void): () => void;
}

/** The failure snapshot after a throw from `refuse()`, or after a snapshot that showed a failed withdrawal. */
export const FAILED_WITHDRAWAL_VIEW: ConsentSnapshotView = Object.freeze({ ...NO_DECISION_VIEW, withdrawal: "failed" });

/**
 * Wraps the host's lifecycle so a throw from any of its calls never reaches
 * React. The first throw is logged and every later read returns the failure
 * snapshot: the no-decision snapshot, or `FAILED_WITHDRAWAL_VIEW` when the
 * throw came from `refuse()` or the last snapshot read showed a failed
 * withdrawal. Listeners from `subscribe` are notified synchronously inside
 * the failure, so a bound transport reads the failure snapshot before the
 * failing call returns; listeners from `subscribeDeferred`, then
 * `onFailure`, run once in a microtask.
 */
export function guardLifecycle(lifecycle: ConsentLifecyclePort, onFailure: () => void): GuardedLifecycle {
  let failed = false;
  let disposed = false;
  let failureView = NO_DECISION_VIEW;
  let withdrawalFailed = false;
  const syncListeners = new Set<() => void>();
  const deferredListeners = new Set<() => void>();
  const fail = (error: unknown, fromRefuse: boolean): ConsentSnapshotView => {
    if (!failed) {
      failed = true;
      if (fromRefuse || withdrawalFailed) failureView = FAILED_WITHDRAWAL_VIEW;
      console.error("ConsentExperience: the lifecycle threw, so analytics is not allowed.", error);
      for (const listener of [...syncListeners]) listener();
      queueMicrotask(() => {
        for (const listener of [...deferredListeners]) listener();
        onFailure();
      });
    }
    return failureView;
  };
  const read = (call: () => ConsentSnapshotView, fromRefuse = false): ConsentSnapshotView => {
    if (failed) return failureView;
    try {
      const view = call();
      withdrawalFailed = view.withdrawal === "failed";
      return view;
    } catch (error) {
      return fail(error, fromRefuse);
    }
  };
  const listen = (listeners: Set<() => void>, listener: () => void): (() => void) => {
    if (failed) return () => {};
    let unsubscribe: () => void;
    try {
      unsubscribe = lifecycle.subscribe(listener);
    } catch (error) {
      fail(error, false);
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
