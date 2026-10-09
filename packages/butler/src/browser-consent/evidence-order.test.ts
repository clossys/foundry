/**
 * P-24: every evidence call carries an increasing `sequence`; a conflict
 * never upgrades to `granted`; `shouldApplyEvidence` applies a denial over
 * a stored grant with a later `decidedAt` (a clock moved back) and refuses
 * a grant with the same `decidedAt` and a lower or equal `sequence`; a
 * delayed, older denial applies over a newer stored grant; evidence for a
 * choice is sent only while that choice is still the latest, so a choice
 * made inside a subscriber never sends out of order, and a choice shows
 * `pending` only once its call is sent; a choice made during a
 * withdrawal's publish never settles the denial's evidence; a re-read or a
 * conflict that switches to another tab's record resets evidence to none
 * and ignores the replaced choice's late result. Covers C-12, C-40, C-41.
 */

import { describe, expect, it } from "vitest";
import { shouldApplyEvidence, type SequencedChoice } from "./decision.js";
import { DAY, HOUR, T0, decidedAt, flush, futureDated, harness, plusMs } from "./fixtures.test.js";
import type { ConsentLifecycle } from "./lifecycle.js";

const sequenced = (status: "granted" | "denied", iso: string, sequence: number): SequencedChoice => ({
  choice: decidedAt(status, iso),
  sequence,
});

describe("evidence calls carry an increasing sequence (C-41)", () => {
  it("across grants, a withdrawal and a plain refusal", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.lifecycle.refuse();
    h.time.advance(HOUR);
    h.lifecycle.refuse();
    const sequences = h.evidence.sequences();
    expect(sequences).toHaveLength(5);
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]!).toBeGreaterThan(sequences[i - 1]!);
    }
    expect(sequences[sequences.length - 1]).toBe(h.snap().sequence);
  });

  it("each call carries the choice that was written", () => {
    const h = harness();
    h.lifecycle.grant();
    expect(h.evidence.calls[0]?.choice).toEqual(h.storage.writes[0]);
  });
});

describe("a conflict never upgrades to granted", () => {
  it("a denial's conflict re-reads the local record but never adopts a grant found there", async () => {
    const h = harness();
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", evidence: "pending" });
    h.time.advance(HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR / 2)));
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "conflict" });
  });

  it("a denial's conflict under notice never becomes allowed when the record has gone", async () => {
    const h = harness({ regime: "notice", initial: decidedAt("denied", plusMs(T0, -DAY)) });
    h.lifecycle.refuse();
    h.storage.setExternally(undefined);
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "conflict" });
  });

  it("a grant's conflict keeps the local grant and reports conflict", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "granted", evidence: "conflict", persistence: "stored" });
  });

  it("a grant's conflict picks up a denial another tab stored, and the switch wins: evidence is none", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR / 2)));
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", evidence: "none" });
  });
});

describe("shouldApplyEvidence ordering is asymmetric (C-41)", () => {
  it("a denial applies over a stored grant with a later decidedAt (a clock moved back)", () => {
    expect(shouldApplyEvidence(sequenced("denied", T0, 1), sequenced("granted", plusMs(T0, DAY), 9))).toBe(true);
  });

  it("a delayed, older denial applies over a newer stored grant", () => {
    expect(shouldApplyEvidence(sequenced("denied", T0, 1), sequenced("granted", plusMs(T0, HOUR), 2))).toBe(true);
  });

  it("a denial applies over an equal or newer stored denial too", () => {
    expect(shouldApplyEvidence(sequenced("denied", T0, 1), sequenced("denied", T0, 5))).toBe(true);
  });

  it("a grant with the same decidedAt applies only with a strictly higher sequence", () => {
    expect(shouldApplyEvidence(sequenced("granted", T0, 2), sequenced("granted", T0, 3))).toBe(false);
    expect(shouldApplyEvidence(sequenced("granted", T0, 3), sequenced("granted", T0, 3))).toBe(false);
    expect(shouldApplyEvidence(sequenced("granted", T0, 4), sequenced("granted", T0, 3))).toBe(true);
    expect(shouldApplyEvidence(sequenced("granted", T0, 2), sequenced("denied", T0, 3))).toBe(false);
  });

  it("a grant applies when its decidedAt is later, whatever the sequence, and never when earlier", () => {
    expect(shouldApplyEvidence(sequenced("granted", plusMs(T0, 1), 1), sequenced("denied", T0, 9))).toBe(true);
    expect(shouldApplyEvidence(sequenced("granted", T0, 9), sequenced("denied", plusMs(T0, 1), 1))).toBe(false);
  });

  it("anything applies over nothing", () => {
    expect(shouldApplyEvidence(sequenced("granted", T0, 1), null)).toBe(true);
    expect(shouldApplyEvidence(sequenced("denied", T0, 1), null)).toBe(true);
  });
});

describe("evidence is sent only for the latest choice (C-41)", () => {
  /** Calls `act` once, from inside the first publish that matches `when`. */
  function once(lifecycle: ConsentLifecycle, when: () => boolean, act: () => void): void {
    let done = false;
    lifecycle.subscribe(() => {
      if (done || !when()) return;
      done = true;
      act();
    });
  }

  it("a refusal made by a subscriber inside grant()'s publish sends only the denial, and no subscriber sees the grant pending", () => {
    const h = harness();
    const seen: { effective: string; evidence: string }[] = [];
    h.lifecycle.subscribe(() => seen.push({ effective: h.snap().effective, evidence: h.snap().evidence }));
    once(h.lifecycle, () => h.snap().effective === "granted", () => h.lifecycle.refuse());
    h.lifecycle.grant();
    expect(h.evidence.calls.map((call) => call.choice.status)).toEqual(["denied"]);
    expect(h.evidence.calls.map((call) => [call.choice.status, call.sequence])).toEqual([["denied", 2]]);
    expect(seen).toContainEqual({ effective: "granted", evidence: "none" });
    expect(seen.filter((entry) => entry.effective === "granted" && entry.evidence === "pending")).toEqual([]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", evidence: "pending" });
  });

  it("a grant made by a subscriber inside a withdrawal's publish never settles the denial's evidence", async () => {
    const h = harness({ initial: futureDated("granted", T0, DAY) });
    once(
      h.lifecycle,
      () => h.snap().effective === "denied" && h.snap().persistence === "memory",
      () => h.lifecycle.grant(),
    );
    h.lifecycle.refuse();
    expect(h.evidence.calls.map((call) => call.choice.status)).toEqual(["granted", "denied"]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", evidence: "pending" });
    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored", evidence: "pending" });
    h.evidence.calls[1]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", evidence: "saved" });
  });

  it("a grant made by a subscriber inside a plain refusal's publish sends only the grant", () => {
    const h = harness();
    once(h.lifecycle, () => h.snap().effective === "denied", () => h.lifecycle.grant());
    h.lifecycle.refuse();
    expect(h.evidence.calls.map((call) => [call.choice.status, call.sequence])).toEqual([["granted", 2]]);
  });

  it("a refusal made by a subscriber inside a verified withdrawal's publish sends only the newer denial", () => {
    const h = harness();
    h.lifecycle.grant();
    let fired = false;
    h.lifecycle.subscribe(() => {
      if (fired || h.snap().persistence !== "stored" || h.snap().effective !== "denied") return;
      fired = true;
      h.time.advance(HOUR);
      h.lifecycle.refuse();
    });
    h.lifecycle.refuse();
    expect(h.evidence.calls.map((call) => [call.choice.status, call.sequence])).toEqual([
      ["granted", 1],
      ["denied", 3],
    ]);
  });
});

describe("a re-read that switches records resets evidence (C-41, C-54)", () => {
  it("another tab's record on a cross-tab re-read resets evidence to none, and the old result is ignored", async () => {
    const h = harness();
    h.lifecycle.grant();
    expect(h.snap().evidence).toBe("pending");
    h.time.advance(2 * HOUR);
    h.storage.setExternally(decidedAt("granted", plusMs(T0, HOUR)));
    h.storage.emitExternalChange();
    expect(h.snap()).toMatchObject({ effective: "granted", persistence: "stored", evidence: "none" });
    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap().evidence).toBe("none");
  });

  it("a re-read that finds this choice's own record keeps its evidence", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.lifecycle.refresh();
    expect(h.snap().evidence).toBe("pending");
    h.evidence.calls[0]?.resolve({ kind: "saved" });
    await flush();
    expect(h.snap().evidence).toBe("saved");
  });
});
