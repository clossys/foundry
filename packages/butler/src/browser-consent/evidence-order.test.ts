/**
 * P-24: every evidence call carries an increasing `sequence`; a conflict
 * never upgrades to `granted`; `shouldApplyEvidence` applies a denial over
 * a stored grant with a later `decidedAt` (a clock moved back) and refuses
 * a grant with the same `decidedAt` and a lower or equal `sequence`; a
 * delayed, older denial applies over a newer stored grant. Covers C-12,
 * C-40, C-41.
 */

import { describe, expect, it } from "vitest";
import { shouldApplyEvidence, type SequencedChoice } from "./decision.js";
import { DAY, HOUR, T0, decidedAt, flush, harness, plusMs } from "./fixtures.test.js";

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

  it("a grant's conflict picks up a denial another tab stored", async () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(HOUR);
    h.storage.setExternally(decidedAt("denied", plusMs(T0, HOUR / 2)));
    h.evidence.calls[0]?.resolve({ kind: "conflict" });
    await flush();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, evidence: "conflict" });
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
