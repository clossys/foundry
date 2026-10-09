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

  it("reads as a failed withdrawal after a throw from refuse(), and as no decision after any other throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = guardLifecycle(rawLifecycle(new Set(["refuse"])).lifecycle, () => {});
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
});
