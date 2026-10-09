/**
 * P-3: a failed save never reports a stored choice; a memory-only choice
 * never reaches the evidence port; a memory-only grant and a memory-only
 * denial both survive `refresh()` and a cross-tab event carrying an older
 * record, and are replaced only by a live, newer record not dated after
 * now; with the clock moved back, a future-dated grant in storage never
 * replaces a refusal held in memory after a failed write, on `refresh()`,
 * `visibilitychange`, `pageshow` or a cross-tab re-read; a newer denial
 * written under another `policy.version` never replaces an in-memory
 * denial. Covers C-7, C-11, C-40, C-41, C-54.
 */

import { describe, expect, it } from "vitest";
import { DAY, HOUR, POLICY, T0, decidedAt, flush, futureDated, harness, plusMs, type Harness } from "./fixtures.test.js";

/** The assembly's re-read triggers, modelled as events that call `refresh()` (C-46). */
function documentTriggers(h: Harness): { dispatch(type: "visibilitychange" | "pageshow"): void } {
  const target = new EventTarget();
  target.addEventListener("visibilitychange", () => h.lifecycle.refresh());
  target.addEventListener("pageshow", () => h.lifecycle.refresh());
  return { dispatch: (type) => target.dispatchEvent(new Event(type)) };
}

type Reread = (h: Harness) => void;

const rereads: [string, Reread][] = [
  ["refresh()", (h) => h.lifecycle.refresh()],
  ["visibilitychange", (h) => documentTriggers(h).dispatch("visibilitychange")],
  ["pageshow", (h) => documentTriggers(h).dispatch("pageshow")],
  ["a cross-tab change", (h) => h.storage.emitExternalChange()],
];

describe("a failed save never reports a stored choice (C-11)", () => {
  it("a grant whose write fails is memory-only, never stored and never saved", async () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    const snapshot = h.lifecycle.grant();
    expect(snapshot).toMatchObject({ effective: "granted", allowed: true, persistence: "memory", evidence: "none" });
    await flush();
    expect(h.snap().evidence).toBe("none");
  });

  it("a refusal whose write fails is memory-only, never stored and never saved", async () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", evidence: "none" });
    await flush();
    expect(h.snap().evidence).toBe("none");
  });
});

describe("a memory-only choice never reaches the evidence port (C-41)", () => {
  it("neither a failed grant, a failed refusal nor a failed withdrawal calls the port", async () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    h.lifecycle.grant();
    h.lifecycle.refuse();
    h.lifecycle.grant();
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    await flush();
    expect(h.evidence.calls).toEqual([]);
  });

  it("the port is called once the same choice is written successfully", () => {
    const h = harness();
    h.lifecycle.grant();
    expect(h.evidence.calls.map((call) => call.choice.status)).toEqual(["granted"]);
  });
});

describe("memory-only choices survive re-reads of older records (C-54)", () => {
  for (const status of ["granted", "denied"] as const) {
    for (const [name, reread] of rereads) {
      it(`a memory-only ${status === "granted" ? "grant" : "denial"} survives ${name} carrying an older record`, () => {
        const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
        if (status === "granted") h.lifecycle.grant();
        else h.lifecycle.refuse();
        const opposite = status === "granted" ? "denied" : "granted";
        h.storage.setExternally(decidedAt(opposite, plusMs(T0, -HOUR)));
        h.time.advance(HOUR);
        reread(h);
        expect(h.snap()).toMatchObject({ effective: status, allowed: status === "granted", persistence: "memory" });
      });
    }
  }

  for (const status of ["granted", "denied"] as const) {
    it(`a memory-only ${status === "granted" ? "grant" : "denial"} is replaced by a live, newer record not dated after now`, () => {
      const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
      if (status === "granted") h.lifecycle.grant();
      else h.lifecycle.refuse();
      const opposite = status === "granted" ? "denied" : "granted";
      h.time.advance(2 * HOUR);
      h.storage.setExternally(decidedAt(opposite, plusMs(T0, HOUR)));
      h.storage.emitExternalChange();
      expect(h.snap()).toMatchObject({ effective: opposite, allowed: opposite === "granted", persistence: "stored" });
    });
  }

  it("a memory-only grant is not replaced by a record dated exactly at its own decision", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    h.lifecycle.grant();
    h.storage.setExternally(decidedAt("denied", T0));
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", persistence: "memory" });
  });
});

describe("clock moved back (C-40, C-54)", () => {
  for (const [name, reread] of rereads) {
    it(`a future-dated grant never replaces a refusal held in memory after a failed write, on ${name}`, () => {
      const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
      h.lifecycle.refuse();
      expect(h.snap()).toMatchObject({ effective: "denied", persistence: "memory" });
      h.time.set(plusMs(T0, -DAY));
      h.storage.setExternally(futureDated("granted", T0, HOUR));
      reread(h);
      expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
    });
  }
});

describe("another policy version (C-7, C-54)", () => {
  for (const [name, reread] of rereads) {
    it(`a newer denial written under another policy version never replaces an in-memory denial, on ${name}`, () => {
      const h = harness({ regime: "notice", beforeMount: (storage) => (storage.modes.writeFails = true) });
      h.storage.modes.removeFails = true;
      h.lifecycle.refuse();
      expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
      h.time.advance(2 * HOUR);
      h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR), { ...POLICY, version: "policy-3" }));
      reread(h);
      expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
    });
  }
});
