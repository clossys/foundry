import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTransport } from "./bind-transport.js";
import { FAILED_WITHDRAWAL_VIEW, guardLifecycle } from "./guard-lifecycle.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type { ConsentLifecyclePort, ConsentSnapshotView } from "./ports.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const GRANTED: ConsentSnapshotView = Object.freeze({ ...NO_DECISION_VIEW, effective: "granted", allowed: true, persistence: "stored" });

/** A lifecycle whose calls throw while `throwing` names them, and record every call. */
function rawLifecycle(throwing: Set<string>, snapshot: ConsentSnapshotView = GRANTED) {
  const calls: string[] = [];
  const call = (name: string): ConsentSnapshotView => {
    calls.push(name);
    if (throwing.has(name)) throw new Error(`${name} failed`);
    return snapshot;
  };
  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => call("getSnapshot"),
    subscribe: () => {
      call("subscribe");
      return () => {};
    },
    grant: () => call("grant"),
    refuse: () => call("refuse"),
    refresh: () => call("refresh"),
    dispose: () => {
      calls.push("dispose");
    },
  };
  return { lifecycle, calls };
}

/**
 * A lifecycle whose `refuse()` publishes first, as the spec requires: it
 * notifies its subscribers of `allowed: false` before it throws or returns
 * a malformed value. Starts from `start`.
 */
function publishingLifecycle(outcome: "throws" | "returns a malformed value", start: ConsentSnapshotView = GRANTED) {
  let snapshot = start;
  const listeners = new Set<() => void>();
  const lifecycle: ConsentLifecyclePort = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    grant: () => snapshot,
    refuse() {
      snapshot = { ...snapshot, effective: "denied", allowed: false, withdrawal: "idle", sequence: snapshot.sequence + 1 };
      for (const listener of [...listeners]) listener();
      if (outcome === "throws") throw new Error("refuse failed");
      return {} as ConsentSnapshotView;
    },
    refresh: () => snapshot,
    dispose: () => {},
  };
  return lifecycle;
}

const OUTCOMES = ["throws", "returns a malformed value"] as const;

describe("guardLifecycle", () => {
  it("stays failed between the throw and the microtask: later reads and subscriptions never reach the lifecycle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set(["getSnapshot"]);
    const { lifecycle, calls } = rawLifecycle(throwing);
    const onFailure = vi.fn();
    const guard = guardLifecycle(lifecycle, onFailure);
    expect(guard.getSnapshot()).toBe(NO_DECISION_VIEW);
    // The lifecycle would now answer granted; the guard does not ask it again.
    throwing.clear();
    expect(guard.getSnapshot()).toBe(NO_DECISION_VIEW);
    expect(guard.grant()).toBe(NO_DECISION_VIEW);
    guard.subscribe(() => {});
    guard.subscribeDeferred(() => {});
    expect(calls).toEqual(["getSnapshot"]);
    expect(guard.failed()).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribe listeners inside the failing call and deferred listeners in the microtask", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set<string>();
    const { lifecycle } = rawLifecycle(throwing);
    const order: string[] = [];
    const guard = guardLifecycle(lifecycle, () => order.push("onFailure"));
    guard.subscribe(() => order.push(`sync ${guard.getSnapshot().allowed}`));
    guard.subscribeDeferred(() => order.push("deferred"));
    throwing.add("refuse");
    guard.refuse();
    order.push("refuse returned");
    await Promise.resolve();
    expect(order).toEqual(["sync false", "refuse returned", "deferred", "onFailure"]);
  });

  it("catches a throwing subscribe and fails", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { lifecycle } = rawLifecycle(new Set(["subscribe"]));
    const guard = guardLifecycle(lifecycle, () => {});
    expect(() => guard.subscribe(() => {})).not.toThrow();
    expect(guard.failed()).toBe(true);
    expect(guard.getSnapshot()).toBe(NO_DECISION_VIEW);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("reads as a failed withdrawal after a throw from refuse() while allowed, and as no decision after any other throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = guardLifecycle(rawLifecycle(new Set(["refuse"])).lifecycle, () => {});
    expect(refused.getSnapshot()).toBe(GRANTED);
    expect(refused.refuse()).toBe(FAILED_WITHDRAWAL_VIEW);
    expect(refused.getSnapshot()).toBe(FAILED_WITHDRAWAL_VIEW);
    expect(FAILED_WITHDRAWAL_VIEW).toMatchObject({ allowed: false, withdrawal: "failed" });
    const granted = guardLifecycle(rawLifecycle(new Set(["grant"])).lifecycle, () => {});
    expect(granted.grant()).toBe(NO_DECISION_VIEW);
  });

  it("keeps a failed withdrawal that the last snapshot showed when a later call throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set<string>();
    const failedWithdrawal: ConsentSnapshotView = { ...GRANTED, withdrawal: "failed" };
    const guard = guardLifecycle(rawLifecycle(throwing, failedWithdrawal).lifecycle, () => {});
    expect(guard.getSnapshot()).toBe(failedWithdrawal);
    throwing.add("refresh");
    expect(guard.refresh()).toBe(FAILED_WITHDRAWAL_VIEW);
  });

  it("reads as no decision after a throw from refuse() when the last snapshot did not allow analytics", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fresh = guardLifecycle(rawLifecycle(new Set(["refuse"]), NO_DECISION_VIEW).lifecycle, () => {});
    expect(fresh.getSnapshot()).toBe(NO_DECISION_VIEW);
    expect(fresh.refuse()).toBe(NO_DECISION_VIEW);
    const unread = guardLifecycle(rawLifecycle(new Set(["refuse"])).lifecycle, () => {});
    expect(unread.refuse()).toBe(NO_DECISION_VIEW);
  });

  it("runs every listener and onFailure when a synchronous listener throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set<string>();
    const { lifecycle } = rawLifecycle(throwing);
    const order: string[] = [];
    const guard = guardLifecycle(lifecycle, () => order.push("onFailure"));
    guard.subscribe(() => {
      order.push("sync throws");
      throw new Error("listener failed");
    });
    guard.subscribe(() => order.push("sync"));
    guard.subscribeDeferred(() => order.push("deferred"));
    throwing.add("grant");
    expect(() => guard.grant()).not.toThrow();
    await Promise.resolve();
    expect(order).toEqual(["sync throws", "sync", "deferred", "onFailure"]);
  });

  it.each(OUTCOMES)("reads as a failed withdrawal, with a bound transport, when refuse() publishes allowed: false and then %s", (outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = guardLifecycle(publishingLifecycle(outcome), () => {});
    const transport = { setPermission: vi.fn() };
    const unbind = bindTransport(guard, transport);
    expect(transport.setPermission).toHaveBeenLastCalledWith(true);
    expect(guard.refuse()).toBe(FAILED_WITHDRAWAL_VIEW);
    expect(guard.getSnapshot()).toBe(FAILED_WITHDRAWAL_VIEW);
    expect(transport.setPermission).toHaveBeenLastCalledWith(false);
    unbind();
  });

  it.each(OUTCOMES)("reads as a failed withdrawal, with only a React-style reader, when refuse() publishes allowed: false and then %s", async (outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onFailure = vi.fn();
    const guard = guardLifecycle(publishingLifecycle(outcome), onFailure);
    const reads: ConsentSnapshotView[] = [guard.getSnapshot()];
    // React's store listener reads the snapshot as soon as it is notified.
    guard.subscribeDeferred(() => reads.push(guard.getSnapshot()));
    expect(guard.refuse()).toBe(FAILED_WITHDRAWAL_VIEW);
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(reads.map((read) => read.allowed)).toEqual([true, false, false]);
    expect(reads.at(-1)).toBe(FAILED_WITHDRAWAL_VIEW);
  });

  it.each(OUTCOMES)("keeps a failed withdrawal from the last snapshot when refuse() publishes a cleared one and then %s", (outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failedWithdrawal: ConsentSnapshotView = { ...NO_DECISION_VIEW, withdrawal: "failed" };
    const guard = guardLifecycle(publishingLifecycle(outcome, failedWithdrawal), () => {});
    guard.subscribe(() => guard.getSnapshot());
    expect(guard.getSnapshot()).toBe(failedWithdrawal);
    expect(guard.refuse()).toBe(FAILED_WITHDRAWAL_VIEW);
  });

  it("reads as no decision when a call throws after a refuse() that completed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set<string>();
    const { lifecycle } = rawLifecycle(throwing);
    const denied: ConsentSnapshotView = { ...NO_DECISION_VIEW, effective: "denied", persistence: "stored" };
    lifecycle.refuse = () => denied;
    const guard = guardLifecycle(lifecycle, () => {});
    expect(guard.getSnapshot()).toBe(GRANTED);
    expect(guard.refuse()).toBe(denied);
    throwing.add("refresh");
    expect(guard.refresh()).toBe(NO_DECISION_VIEW);
  });

  it("returns the failure snapshot, not the call's own result, when a read during the call failed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { lifecycle } = rawLifecycle(new Set());
    let publishing = false;
    const listeners = new Set<() => void>();
    lifecycle.subscribe = (listener) => {
      listeners.add(listener);
      return () => {};
    };
    lifecycle.getSnapshot = () => {
      if (publishing) throw new Error("snapshot read failed");
      return NO_DECISION_VIEW;
    };
    lifecycle.grant = () => {
      publishing = true;
      for (const listener of [...listeners]) listener();
      publishing = false;
      return GRANTED;
    };
    const guard = guardLifecycle(lifecycle, () => {});
    guard.subscribe(() => guard.getSnapshot());
    expect(guard.grant()).toBe(NO_DECISION_VIEW);
    expect(guard.failed()).toBe(true);
    expect(guard.getSnapshot()).toBe(NO_DECISION_VIEW);
  });

  it("queues the deferred notification before it notifies synchronous listeners", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = new Set<string>();
    const { lifecycle } = rawLifecycle(throwing);
    const order: string[] = [];
    const guard = guardLifecycle(lifecycle, () => order.push("onFailure"));
    guard.subscribe(() => queueMicrotask(() => order.push("sync listener's microtask")));
    guard.subscribeDeferred(() => order.push("deferred"));
    throwing.add("grant");
    guard.grant();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["deferred", "onFailure", "sync listener's microtask"]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 5],
    ["an empty object", {}],
    ["a snapshot with a string allowed", { ...GRANTED, allowed: "true" }],
    ["a snapshot without sequence", { ...GRANTED, sequence: undefined }],
  ])("fails closed on %s from a lifecycle call, and logs no value", (_label, value) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { lifecycle } = rawLifecycle(new Set());
    lifecycle.grant = () => value as unknown as ConsentSnapshotView;
    const guard = guardLifecycle(lifecycle, () => {});
    expect(guard.getSnapshot()).toBe(GRANTED);
    expect(guard.grant()).toBe(NO_DECISION_VIEW);
    expect(guard.failed()).toBe(true);
    expect(guard.getSnapshot()).toBe(NO_DECISION_VIEW);
    expect(consoleError.mock.calls).toEqual([["ConsentExperience: the lifecycle returned a malformed snapshot, so analytics is not allowed."]]);
  });
});
