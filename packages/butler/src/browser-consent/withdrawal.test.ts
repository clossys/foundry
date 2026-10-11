/**
 * P-6: a refusal from a grant, and from no choice under `notice`, is a
 * withdrawal; `allowed: false` is published before the write; write and
 * removal both failing with a grant still readable is `failed`; under
 * `notice`, a failed write with a successful removal is `failed`; an
 * unreadable read-back is `failed`; after a failed withdrawal, `refresh()`
 * keeps `allowed: false` and `withdrawal: "failed"`; a second refusal while
 * the read-back still shows the grant stays `failed`; `failed` returns to
 * `idle` only once a read-back is `not allowed`; after a failed withdrawal
 * with the clock moved back, a future-dated grant in storage never replaces
 * the in-memory denial on `visibilitychange`, `pageshow` or a cross-tab
 * re-read, and `withdrawal` stays `failed`; a newer denial another tab
 * wrote under a different `policy.version` never replaces the in-memory
 * denial; the records a failed withdrawal read at the call and on
 * read-back, and anything decided at or before them, never replace the
 * denial once the clock is corrected (the watermark only moves forward,
 * and an empty or unreadable read-back still bars the record read at the
 * call); the visitor's own grant clears the watermark; a grant dated after
 * now counts as allowed at the call and on read-back; a second refusal
 * after a failed withdrawal is a withdrawal even when storage is
 * unreadable at the call. Covers P-32, C-7, C-13, C-15, C-40, C-54, C-57.
 *
 * `visibilitychange` and `pageshow` are modelled as the assembly wires
 * them: listeners that call `refresh()` (C-46).
 */

import { describe, expect, it } from "vitest";
import { DAY, HOUR, POLICY, T0, decidedAt, flush, futureDated, harness, plusMs, type Harness } from "./fixtures.test.js";

const grantAt = (iso: string = plusMs(T0, -DAY)) => decidedAt("granted", iso);

function documentTriggers(h: Harness): { dispatch(type: "visibilitychange" | "pageshow"): void } {
  const target = new EventTarget();
  target.addEventListener("visibilitychange", () => h.lifecycle.refresh());
  target.addEventListener("pageshow", () => h.lifecycle.refresh());
  return { dispatch: (type) => target.dispatchEvent(new Event(type)) };
}

/** Storage that keeps returning the grant whatever is written or removed. */
function stuckGrant(h: Harness, grant = grantAt()): void {
  h.storage.modes.writeFails = true;
  h.storage.modes.removeFails = true;
  h.storage.modes.staleRead = grant;
}

describe("what counts as a withdrawal (C-13)", () => {
  it("a refusal from a stored grant is a withdrawal that completes on read-back", () => {
    const h = harness({ initial: grantAt() });
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true });
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", withdrawal: "idle" });
    expect(h.storage.writes.map((write) => write.status)).toEqual(["denied"]);
    expect(h.storage.reads.length).toBeGreaterThanOrEqual(3); // mount, at the call, and the read-back
  });

  it("a refusal from no choice under notice is a withdrawal: removal alone never completes it", () => {
    const h = harness({ regime: "notice" });
    expect(h.snap()).toMatchObject({ effective: "none", allowed: true });
    h.storage.modes.writeFails = true;
    const snapshot = h.lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "ok" }]);
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("a refusal from no choice under notice is a withdrawal even when storage turned unreadable at the call", () => {
    const h = harness({ regime: "notice" });
    expect(h.snap().allowed).toBe(true);
    h.storage.modes.readUnavailable = true;
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed", persistence: "memory" });
  });

  it("a read-back taken at the call makes a refusal a withdrawal even when the snapshot was not allowed", () => {
    const h = harness();
    expect(h.snap()).toMatchObject({ effective: "none", allowed: false });
    // Another tab granted without this lifecycle hearing about it, and storage now refuses to change.
    stuckGrant(h, grantAt(plusMs(T0, -HOUR)));
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed", persistence: "memory" });
  });

  it("a refusal from no choice under prompt is a plain refusal", () => {
    const h = harness();
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", persistence: "stored", withdrawal: "idle" });
    expect(h.storage.removes).toEqual([]);
  });
});

describe("publishing order (C-13)", () => {
  it("allowed: false reaches subscribers before the denial is written", () => {
    const h = harness({ initial: grantAt() });
    const seen: { allowed: boolean; writes: number; removes: number }[] = [];
    h.lifecycle.subscribe(() => {
      seen.push({ allowed: h.snap().allowed, writes: h.storage.writes.length, removes: h.storage.removes.length });
    });
    h.lifecycle.refuse();
    expect(seen[0]).toEqual({ allowed: false, writes: 0, removes: 0 });
  });
});

describe("failed withdrawals (C-13)", () => {
  it("write and removal both failing with the grant still readable is failed", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    expect(h.storage.removes).toEqual([{ kind: "unavailable" }]);
  });

  it("under notice, a failed write with a successful removal is failed", () => {
    const h = harness({ regime: "notice", initial: grantAt() });
    h.storage.modes.writeFails = true;
    const snapshot = h.lifecycle.refuse();
    expect(h.storage.value).toBeUndefined();
    expect(snapshot).toMatchObject({ allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("under prompt, a failed write with a successful removal completes as a memory denial", () => {
    const h = harness({ initial: grantAt() });
    h.storage.modes.writeFails = true;
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "idle", evidence: "none" });
  });

  it("an unreadable read-back is failed, even when the write reported ok", () => {
    const h = harness({ initial: grantAt() });
    h.storage.modes.readUnavailable = true;
    const snapshot = h.lifecycle.refuse();
    expect(h.storage.writes.map((write) => write.status)).toEqual(["denied"]);
    expect(snapshot).toMatchObject({ allowed: false, persistence: "memory", withdrawal: "failed", storage: "unreadable" });
  });

  it("a write that reports ok while the grant stays readable is failed", () => {
    const h = harness({ initial: grantAt() });
    h.storage.modes.staleRead = grantAt();
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ allowed: false, persistence: "memory", withdrawal: "failed", evidence: "none" });
    expect(h.evidence.calls.map((call) => call.choice.status)).toEqual([]);
  });

  it("after a failed withdrawal, refresh() keeps allowed: false and withdrawal: failed", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ allowed: false, withdrawal: "failed" });
  });

  it("a second refusal while the read-back still shows the grant stays failed", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    const second = h.lifecycle.refuse();
    expect(second).toMatchObject({ allowed: false, persistence: "memory", withdrawal: "failed" });
    expect(h.storage.writes.length).toBe(2);
  });

  it("failed returns to idle only once a read-back is not allowed", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.storage.modes.staleRead = undefined;
    h.storage.modes.readUnavailable = true;
    h.lifecycle.refresh();
    expect(h.snap().withdrawal).toBe("failed");
    h.storage.modes.readUnavailable = false;
    h.storage.modes.staleRead = grantAt();
    h.lifecycle.refresh();
    expect(h.snap().withdrawal).toBe("failed");
    // Storage recovers: the grant is gone and no record remains (prompt), so the read-back is not allowed.
    h.storage.modes.staleRead = undefined;
    h.storage.setExternally(undefined);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ withdrawal: "idle", effective: "denied", allowed: false, persistence: "memory" });
  });

  it("a later refusal clears failed once storage records it", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.storage.modes.writeFails = false;
    h.storage.modes.removeFails = false;
    h.storage.modes.staleRead = undefined;
    h.time.advance(HOUR);
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ withdrawal: "idle", effective: "denied", persistence: "stored" });
  });

  it("a grant clears failed", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    expect(h.lifecycle.grant()).toMatchObject({ withdrawal: "idle", effective: "granted" });
  });
});

describe("re-reads after a failed withdrawal (C-54)", () => {
  const triggers: [string, (h: Harness) => void][] = [
    ["visibilitychange", (h) => documentTriggers(h).dispatch("visibilitychange")],
    ["pageshow", (h) => documentTriggers(h).dispatch("pageshow")],
    ["a cross-tab change", (h) => h.storage.emitExternalChange()],
  ];

  for (const [name, reread] of triggers) {
    it(`with the clock moved back, a future-dated grant never replaces the in-memory denial on ${name}`, () => {
      const h = harness({ regime: "notice", initial: grantAt() });
      stuckGrant(h, futureDated("granted", T0, 2 * HOUR));
      h.time.advance(HOUR);
      h.lifecycle.refuse();
      expect(h.snap()).toMatchObject({ allowed: false, withdrawal: "failed" });
      h.time.set(plusMs(T0, -DAY));
      reread(h);
      expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    });

    it(`a newer denial written under another policy version never replaces the in-memory denial on ${name}`, () => {
      const h = harness({ regime: "notice", initial: grantAt() });
      h.storage.modes.writeFails = true;
      h.lifecycle.refuse();
      expect(h.snap()).toMatchObject({ allowed: false, withdrawal: "failed" });
      h.time.advance(2 * HOUR);
      h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR), { ...POLICY, version: "policy-3" }));
      reread(h);
      expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    });
  }

  it("a live, newer record from another tab replaces the in-memory denial and returns withdrawal to idle", () => {
    const h = harness({ initial: grantAt() });
    stuckGrant(h);
    h.lifecycle.refuse();
    h.time.advance(2 * HOUR);
    h.storage.modes.staleRead = decidedAt("denied", plusMs(T0, HOUR));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "denied", persistence: "stored", withdrawal: "idle" });
  });
});

describe("withdrawal is never harder than granting (C-15)", () => {
  it("refuse() acts while a grant's evidence is pending, and shares grant()'s call shape", async () => {
    const h = harness();
    expect(h.lifecycle.grant.length).toBe(h.lifecycle.refuse.length);
    h.lifecycle.grant();
    expect(h.snap().evidence).toBe("pending");
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ effective: "denied", allowed: false, withdrawal: "idle", persistence: "stored" });
    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false });
  });
});

describe("the watermark of a failed withdrawal (P-32, C-13, C-40, C-54, C-57)", () => {
  it("grant at T0, clock back a day, refusal fails write and removal, clock to T0+2h: refresh keeps the denial and failed", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.set(plusMs(T0, -DAY));
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.time.set(plusMs(T0, 2 * HOUR));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("a record decided after the refusal but at or before the stale record never replaces the denial either", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.set(plusMs(T0, -DAY));
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    h.time.set(plusMs(T0, 2 * HOUR));
    h.storage.setExternally(decidedAt("granted", plusMs(T0, -HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored", withdrawal: "idle" });
  });

  it("a grant dated after now counts as allowed at the call: the refusal is a withdrawal, fails, and the grant never replaces it later", () => {
    const h = harness({ initial: futureDated("granted", T0, DAY) });
    expect(h.snap()).toMatchObject({ effective: "none", allowed: false });
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    expect(h.storage.removes).toEqual([{ kind: "unavailable" }]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.time.set(plusMs(T0, DAY + HOUR));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  // Fail-closed beyond rev 6: the record read at the call also raises the watermark, so a read-back that saw none bars it too.
  it("a read-back that saw no record still bars the record read at the call, and a grant decided after it lifts the denial", () => {
    const h = harness({ regime: "notice", initial: futureDated("granted", T0, DAY) });
    h.storage.modes.writeFails = true;
    h.lifecycle.refuse();
    expect(h.storage.value).toBeUndefined();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
    h.time.set(plusMs(T0, 2 * DAY));
    h.storage.setExternally(futureDated("granted", T0, DAY));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.storage.setExternally(futureDated("granted", T0, DAY + HOUR));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored", withdrawal: "idle" });
  });

  it("an unreadable read-back still bars the record read at the call", () => {
    const grant = futureDated("granted", T0, DAY);
    const h = harness({ initial: grant });
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.storage.scriptedReads.push({ kind: "value", value: grant }, { kind: "unavailable" });
    h.lifecycle.refuse();
    expect(h.storage.reads.slice(-2).map((read) => read.kind)).toEqual(["value", "unavailable"]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
    h.time.set(plusMs(T0, 2 * DAY));
    h.lifecycle.refresh();
    expect(h.storage.value).toEqual(grant);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });

  it("the visitor's own grant clears the watermark: a later outside grant dated before it applies after the visitor refuses again", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.set(plusMs(T0, -DAY));
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
    h.storage.modes.writeFails = false;
    h.storage.modes.removeFails = false;
    expect(h.lifecycle.grant()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored", withdrawal: "idle" });
    h.time.advance(HOUR);
    expect(h.lifecycle.refuse()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", withdrawal: "idle" });
    h.time.set(plusMs(T0, -HOUR));
    h.storage.setExternally(decidedAt("granted", plusMs(T0, -2 * HOUR)));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, persistence: "stored", withdrawal: "idle" });
  });

  it("across repeated failed withdrawals the watermark only moves forward", () => {
    const h = harness();
    stuckGrant(h, futureDated("granted", T0, 2 * DAY));
    h.lifecycle.refuse();
    expect(h.snap().withdrawal).toBe("failed");
    h.storage.modes.staleRead = futureDated("granted", T0, DAY);
    h.lifecycle.refuse();
    expect(h.snap().withdrawal).toBe("failed");
    h.time.set(plusMs(T0, 3 * DAY));
    h.storage.modes.staleRead = futureDated("granted", T0, DAY + DAY / 2);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });
});

describe("a refusal after a failed withdrawal is a withdrawal (C-13)", () => {
  it("even when storage is unreadable at the call and the write reports ok, a stale grant read back keeps it failed", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    stuckGrant(h, decidedAt("granted", T0));
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ allowed: false, withdrawal: "failed" });
    h.time.advance(HOUR);
    h.storage.modes.writeFails = false;
    h.storage.scriptedReads.push({ kind: "unavailable" });
    const second = h.lifecycle.refuse();
    expect(second).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed", evidence: "none" });
    expect(h.evidence.calls.map((call) => call.choice.status)).toEqual(["granted"]);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, withdrawal: "failed" });
  });
});

describe("the failed-withdrawal re-check counts a grant dated after now as allowed (P-32, C-13, C-40, C-57)", () => {
  it("prompt: with the clock still moved back, a re-read keeps withdrawal failed", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.set(plusMs(T0, -DAY));
    h.storage.modes.writeFails = true;
    h.storage.modes.removeFails = true;
    h.lifecycle.refuse();
    expect(h.snap().withdrawal).toBe("failed");
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory", withdrawal: "failed" });
  });
});
