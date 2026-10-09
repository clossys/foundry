/**
 * P-2: a stale grant cannot override a withdrawal (C-12), plus the mount
 * rows of the transition table, the snapshot's identity contract, and a
 * clock that gives no valid instant after mount: a refusal publishes
 * `allowed: false` before it reads the clock and is held undated, which no
 * re-read lifts and the visitor's next dated choice replaces; it is
 * `stored` only while storage holds a denial; without a clock any grant,
 * or no record under `notice`, reads back as allowed, and a failed
 * withdrawal ends only on a read-back that is not; a grant is a no-op.
 * Covers C-61.
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

describe("a clock with no valid instant after mount (C-13, C-15)", () => {
  function brokenClockHarness(options: Parameters<typeof harness>[0] = {}) {
    const h = harness(options);
    let broken = false;
    const value = h.time.clock;
    const clock = (): Date => (broken ? new Date(Number.NaN) : value());
    const lifecycle = createConsentLifecycle({
      storage: h.storage.port,
      evidence: h.evidence.port,
      policy: options.policy ?? POLICY,
      regime: options.regime,
      signals: GPC_OFF,
      clock,
    });
    return { ...h, lifecycle, snap: () => lifecycle.getSnapshot(), breakClock: (on: boolean) => (broken = on) };
  }

  it("a refusal publishes allowed: false first, never throws, and writes nothing undated", () => {
    const h = brokenClockHarness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
    const seen: boolean[] = [];
    h.lifecycle.subscribe(() => seen.push(h.snap().allowed));
    h.breakClock(true);
    expect(() => h.lifecycle.refuse()).not.toThrow();
    expect(seen[0]).toBe(false);
    expect(h.storage.writes).toEqual([]);
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "idle", evidence: "none" });
  });

  it("a refusal publishes allowed: false before it reads the clock, valid or not (C-61)", () => {
    for (const broken of [false, true]) {
      const h = harness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
      const heard: boolean[] = [];
      let refusing = false;
      let heardWhenClockRead: boolean[] | undefined;
      const lifecycle = createConsentLifecycle({
        storage: h.storage.port,
        policy: POLICY,
        regime: "prompt",
        signals: GPC_OFF,
        clock: () => {
          if (refusing && heardWhenClockRead === undefined) heardWhenClockRead = [...heard];
          return refusing && broken ? new Date(Number.NaN) : h.time.clock();
        },
      });
      lifecycle.subscribe(() => heard.push(lifecycle.getSnapshot().allowed));
      expect(lifecycle.getSnapshot().allowed).toBe(true);
      refusing = true;
      lifecycle.refuse();
      expect(heardWhenClockRead).toEqual([false]);
      expect(lifecycle.getSnapshot()).toMatchObject({ effective: "denied", allowed: false });
    }
  });

  it("a clock that throws behaves the same", () => {
    const h = harness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
    let calls = 0;
    const lifecycle = createConsentLifecycle({
      storage: h.storage.port,
      policy: POLICY,
      regime: "prompt",
      signals: GPC_OFF,
      clock: () => {
        calls += 1;
        if (calls > 1) throw new Error("clock unavailable");
        return new Date(T0);
      },
    });
    expect(() => lifecycle.refuse()).not.toThrow();
    expect(lifecycle.getSnapshot()).toMatchObject({ effective: "denied", allowed: false });
  });

  it("a grant is a no-op that never throws", () => {
    const h = brokenClockHarness();
    h.breakClock(true);
    const before = h.snap();
    expect(() => h.lifecycle.grant()).not.toThrow();
    expect(h.snap()).toBe(before);
    expect(h.storage.writes).toEqual([]);
  });

  it("with the grant still readable the withdrawal fails; no re-read lifts the undated denial, and failed ends only on a read-back not allowed", () => {
    const grant = decidedAt("granted", plusMs(T0, -DAY));
    const h = brokenClockHarness({ initial: grant });
    h.storage.modes.removeFails = true;
    h.breakClock(true);
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.breakClock(false);
    h.time.advance(HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR / 2)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR / 2)));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", withdrawal: "idle" });
    expect(h.lifecycle.grant()).toMatchObject({ effective: "granted", allowed: true, withdrawal: "idle" });
  });

  it("while the clock stays invalid a re-read judges the failed withdrawal under the no-clock rule", () => {
    const h = brokenClockHarness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
    h.storage.modes.removeFails = true;
    h.breakClock(true);
    h.lifecycle.refuse();
    expect(h.snap().withdrawal).toBe("failed");
    // A grant of any date, even one the policy no longer accepts, still reads back as allowed without a clock.
    h.storage.setExternally({ ...decidedAt("granted", plusMs(T0, -DAY)), policyVersion: "policy-0" });
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "idle" });
  });

  it("without a clock any stored grant makes a refusal a withdrawal, even one a signal bars", () => {
    const h = harness({ initial: decidedAt("granted", plusMs(T0, -DAY)) });
    let broken = false;
    const lifecycle = createConsentLifecycle({
      storage: h.storage.port,
      policy: POLICY,
      regime: "prompt",
      signals: GPC_ON,
      clock: () => (broken ? new Date(Number.NaN) : h.time.clock()),
    });
    expect(lifecycle.getSnapshot()).toMatchObject({ effective: "denied", allowed: false });
    broken = true;
    lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(lifecycle.getSnapshot()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "idle" });
  });

  it("any refusal is a withdrawal while storage holds a grant, and under notice no record reads back as allowed", () => {
    const h = brokenClockHarness();
    expect(h.snap().allowed).toBe(false);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, -HOUR)));
    h.breakClock(true);
    h.lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(h.snap()).toMatchObject({ withdrawal: "idle", allowed: false });

    const notice = brokenClockHarness({ regime: "notice" });
    notice.breakClock(true);
    notice.lifecycle.refuse();
    expect(notice.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
  });
});

describe("the undated denial (C-13)", () => {
  function brokenClock(initial?: unknown) {
    const h = harness({ initial });
    let broken = false;
    const lifecycle = createConsentLifecycle({
      storage: h.storage.port,
      evidence: h.evidence.port,
      policy: POLICY,
      regime: "prompt",
      signals: GPC_OFF,
      clock: () => (broken ? new Date(Number.NaN) : h.time.clock()),
    });
    return { ...h, lifecycle, snap: () => lifecycle.getSnapshot(), breakClock: (on: boolean) => (broken = on) };
  }

  it("advances seq, and is stored only while storage holds a denial", () => {
    const h = brokenClock(decidedAt("denied", plusMs(T0, -DAY)));
    expect(h.snap().sequence).toBe(0);
    h.breakClock(true);
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", sequence: 1 });
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("a later refusal with a valid clock dates it and replaces it", () => {
    const h = brokenClock();
    h.breakClock(true);
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", persistence: "memory" });
    h.breakClock(false);
    h.time.advance(HOUR);
    h.lifecycle.refuse();
    expect(h.storage.writes.map((write) => write.decidedAt)).toEqual([plusMs(T0, HOUR)]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", sequence: 2 });
    // Now an ordinary dated floor: a live grant decided after it lifts it on a re-read.
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, 2 * HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored" });
  });
});
