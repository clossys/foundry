import { afterEach, describe, expect, it, vi } from "vitest";
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
