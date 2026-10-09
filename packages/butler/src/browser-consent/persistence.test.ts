/**
 * P-3: a failed save never reports a stored choice; a memory-only choice
 * never reaches the evidence port; a memory-only grant and a memory-only
 * denial both survive `refresh()` and a cross-tab event carrying an older
 * record, and are replaced only by a live, newer record not dated after
 * now; with the clock moved back, a future-dated grant in storage never
 * replaces a refusal held in memory after a failed write, on `refresh()`,
 * `visibilitychange`, `pageshow` or a cross-tab re-read; a newer denial
 * written under another `policy.version` never replaces an in-memory
 * denial; a refusal made this visit is a floor that only a live, newer
 * grant lifts, and a re-read that finds the stored refusal gone keeps it in
 * memory; the visitor's own grant ends the floor; a memory-only grant is
 * not replaced by a denial dated after now; on an unreadable re-read a
 * refusal and a memory-only grant hold while a stored grant drops to
 * `unknown`. Covers P-32, C-7, C-11, C-37, C-40, C-41, C-54, C-56, C-58.
 *
 * `visibilitychange` and `pageshow` are modelled as the assembly wires
 * them: listeners that call `refresh()` (C-46).
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

describe("a refusal made this visit is a floor (P-32, C-54, C-56)", () => {
  it("notice: a stored refusal, then another tab's denial under another policy version and a cross-tab event, stays refused", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR), { ...POLICY, version: "policy-3" }));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("notice: a stored refusal, then storage cleared elsewhere and refresh(), stays refused", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("notice: unreadable at mount, a refusal whose write reports ok but is lost, then refresh(), stays refused", () => {
    const h = harness({ regime: "notice", beforeMount: (storage) => (storage.modes.readUnavailable = true) });
    expect(h.snap()).toMatchObject({ effective: "unknown", allowed: false });
    h.storage.modes.readUnavailable = false;
    h.storage.scriptedReads.push({ kind: "unavailable" });
    h.storage.modes.writeLost = true;
    h.lifecycle.refuse();
    expect(h.storage.writes.map((write) => write.status)).toEqual(["denied"]);
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.storage.reads.at(-1)).toEqual({ kind: "empty" });
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("the visitor's own grant ends the floor: storage cleared elsewhere afterwards is no choice", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    expect(h.lifecycle.grant()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored" });
    h.time.advance(HOUR);
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "none", allowed: true });
  });

  it("a live grant decided after the refusal and not after now lifts the floor", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored" });
  });

  it("an older grant, or a grant dated after now, never lifts the floor", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, -HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
    h.storage.setExternally(futureDated("granted", T0, 2 * HOUR));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("one-sided: a re-read still moves a grant made this visit to another tab's newer denial, stored", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR)));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
  });

  /** Mounted on a stored denial under `notice`; another tab's grant makes the next refusal a withdrawal. */
  function withdrawalOverAnotherTabsGrant(): Harness {
    const h = harness({ regime: "notice", initial: decidedAt("denied", plusMs(T0, -DAY)) });
    h.storage.setExternally(decidedAt("granted", plusMs(T0, -HOUR)));
    return h;
  }

  /** Calls `act` once, from inside the withdrawal's first publish (its denial held in memory). */
  function duringFirstPublish(h: Harness, act: () => void): void {
    let done = false;
    h.lifecycle.subscribe(() => {
      if (done || h.snap().effective !== "denied" || h.snap().persistence !== "memory") return;
      done = true;
      act();
    });
  }

  it("notice: a grant made by a subscriber during a withdrawal's first publish never ends the withdrawal's floor", () => {
    const h = withdrawalOverAnotherTabsGrant();
    duringFirstPublish(h, () => h.lifecycle.grant());
    h.lifecycle.refuse();
    expect(h.storage.writes.map((write) => write.status)).toEqual(["granted", "denied"]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", withdrawal: "idle" });
    h.time.advance(HOUR);
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("notice: with that grant stored, a failed denial write and a successful removal still end refused", () => {
    const h = withdrawalOverAnotherTabsGrant();
    duringFirstPublish(h, () => {
      h.lifecycle.grant();
      h.storage.modes.writeFails = true;
    });
    h.lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("notice: a refusal a subscriber confirmed during that publish never leaves the withdrawal without its denial", () => {
    const h = withdrawalOverAnotherTabsGrant();
    duringFirstPublish(h, () => {
      h.lifecycle.refuse();
      h.storage.modes.writeFails = true;
    });
    h.lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("a later refusal a subscriber made during that publish keeps its later floor", () => {
    const h = withdrawalOverAnotherTabsGrant();
    duringFirstPublish(h, () => {
      h.time.advance(HOUR);
      h.lifecycle.refuse();
    });
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false });
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR / 2)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });

  it("another tab's live, newer denial that replaces an in-memory refusal is stored", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    h.lifecycle.refuse();
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
  });
});

describe("a memory-only grant against a denial dated after now (C-40, C-54)", () => {
  it("a live denial dated after now never replaces a memory-only grant", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.storage.setExternally(futureDated("denied", T0, DAY));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "memory" });
  });
});

describe("an unreadable re-read (C-37, C-11, C-54, C-58)", () => {
  it("a stored grant that can no longer be confirmed drops to unknown, not allowed", () => {
    const h = harness();
    h.lifecycle.grant();
    h.storage.modes.readUnavailable = true;
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "unknown", allowed: false, persistence: "none", storage: "unreadable" });
  });

  it("a memory-only grant holds for the visit", () => {
    const h = harness({ beforeMount: (storage) => (storage.modes.writeFails = true) });
    h.lifecycle.grant();
    h.storage.modes.readUnavailable = true;
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "memory", storage: "unreadable" });
  });

  it("a stored refusal holds in memory", () => {
    const h = harness({ regime: "notice" });
    h.lifecycle.refuse();
    h.storage.modes.readUnavailable = true;
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", storage: "unreadable" });
  });
});
