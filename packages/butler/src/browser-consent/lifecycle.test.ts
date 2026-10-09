/**
 * P-2: a stale grant cannot override a withdrawal (C-12), plus the mount
 * rows of the transition table and the snapshot's identity contract.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DAY,
  GPC_OFF,
  GPC_ON,
  HOUR,
  POLICY,
  T0,
  decidedAt,
  fixedClock,
  flush,
  harness,
  memoryStorage,
  plusMs,
} from "./fixtures.test.js";
import { NO_DECISION_SNAPSHOT, createConsentLifecycle } from "./lifecycle.js";

describe("stale grant cannot override withdrawal (P-2, C-12)", () => {
  it("a grant's durable acknowledgement that arrives after a refusal changes nothing", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "pending", sequence: 2 });
    expect(h.evidence.sequences()).toEqual([1, 2]);

    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "pending", sequence: 2 });

    h.evidence.calls[1]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "saved" });
  });

  it("a stale conflict or failure for an older sequence is ignored", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.lifecycle.grant();
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    h.evidence.calls[0]?.reject(new Error("late"));
    await flush();
    expect(h.snap()).toMatchObject({ effective: "granted", evidence: "pending", sequence: 2 });
  });

  it("a withdrawal aborts the in-flight acknowledgement", () => {
    const h = harness();
    h.lifecycle.grant();
    const signal = h.evidence.calls[0]?.signal;
    expect(signal?.aborted).toBe(false);
    h.lifecycle.refuse();
    expect(signal?.aborted).toBe(true);
  });
});

describe("evidence outcomes", () => {
  it("unavailable, or a throw, keeps the local choice", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.evidence.calls[0]?.reject(new Error("offline"));
    await flush();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored", evidence: "unavailable" });
    h.time.advance(HOUR);
    h.lifecycle.grant();
    h.evidence.calls[1]?.resolve({ kind: "unavailable" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "granted", evidence: "unavailable" });
  });

  it("a port that throws synchronously reports unavailable", async () => {
    const storage = memoryStorage();
    const lifecycleWithThrowingPort = createConsentLifecycle({
      storage: storage.port,
      evidence: {
        save() {
          throw new Error("sync failure");
        },
      },
      policy: POLICY,
      regime: "prompt",
      signals: GPC_OFF,
      clock: fixedClock().clock,
    });
    expect(lifecycleWithThrowingPort.grant().evidence).toBe("pending");
    await flush();
    expect(lifecycleWithThrowingPort.getSnapshot()).toMatchObject({ effective: "granted", evidence: "unavailable" });
  });
});

describe("mount (transition table)", () => {
  it("unreadable storage: nothing written, unknown, not allowed, no automatic prompt", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.readUnavailable = true) });
    expect(h.snap()).toMatchObject({
      effective: "unknown",
      allowed: false,
      promptAutomatically: false,
      storage: "unreadable",
      persistence: "none",
    });
    expect(h.storage.writes).toEqual([]);
  });

  it("unreadable storage with GPC on is denied", () => {
    const h = harness({ signals: GPC_ON, beforeMount: (storage) => (storage.modes.readUnavailable = true) });
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, gpcInForce: true });
  });

  it("a throwing read is unreadable", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.readThrows = true) });
    expect(h.snap()).toMatchObject({ effective: "unknown", storage: "unreadable" });
  });

  it("an empty read, or a value that parses to no choice, is none and nothing is rewritten", () => {
    for (const initial of [undefined, "not json", { status: "maybe" }, decidedAt("granted", "2024-01-01T00:00:00.000Z")]) {
      const h = harness({ initial });
      expect(h.snap()).toMatchObject({ effective: "none", persistence: "none", promptAutomatically: true });
      expect(h.storage.writes).toEqual([]);
      expect(h.storage.removes).toEqual([]);
    }
  });

  it("a live record is the record's status, stored", () => {
    const h = harness({ initial: decidedAt("denied", plusMs(T0, -DAY)) });
    expect(h.snap()).toMatchObject({ effective: "denied", persistence: "stored", allowed: false, sequence: 0 });
  });

  it("the regime in the snapshot is normalised", () => {
    expect(harness({ regime: "notice" }).snap().regime).toBe("notice");
    expect(harness({ regime: "NOTICE" }).snap().regime).toBe("prompt");
    expect(harness().snap().regime).toBe("prompt");
  });
});

describe("snapshot identity and subscription", () => {
  it("getSnapshot keeps its identity until a change, and listeners hear only changes", () => {
    const h = harness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
    const listener = vi.fn();
    h.lifecycle.subscribe(listener);
    const first = h.snap();
    expect(h.snap()).toBe(first);
    h.lifecycle.refresh();
    expect(h.snap()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    h.lifecycle.refuse();
    expect(h.snap()).not.toBe(first);
    expect(listener).toHaveBeenCalled();
  });

  it("dispose stops listeners, cross-tab subscriptions and late evidence", async () => {
    const h = harness();
    const listener = vi.fn();
    h.lifecycle.subscribe(listener);
    h.lifecycle.grant();
    expect(h.storage.subscriberCount()).toBe(1);
    listener.mockClear();
    const before = h.snap();
    h.lifecycle.dispose();
    expect(h.storage.subscriberCount()).toBe(0);
    expect(h.evidence.calls[0]?.signal.aborted).toBe(true);
    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.lifecycle.refuse()).toBe(before);
    expect(h.storage.writes.length).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("NO_DECISION_SNAPSHOT is the specified server snapshot", () => {
    expect(NO_DECISION_SNAPSHOT).toEqual({
      regime: "prompt",
      effective: "none",
      allowed: false,
      promptAutomatically: false,
      persistence: "none",
      storage: "readable",
      evidence: "none",
      withdrawal: "idle",
      gpcInForce: false,
      simulated: false,
      sequence: 0,
    });
    expect(Object.isFrozen(NO_DECISION_SNAPSHOT)).toBe(true);
  });

  it("a cross-tab change re-reads storage", () => {
    const h = harness();
    h.storage.setExternally(decidedAt("granted", T0));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "granted", persistence: "stored" });
  });
});
