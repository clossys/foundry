/**
 * P-4: expiry is fixed at decision and not renewed by reads or reopenings;
 * every explicit choice writes a fresh record; expired reads as no choice;
 * reading caps expiry; a future-dated denial stays live and a future-dated
 * grant does not; the current shape takes only ISO 8601 UTC instants; a
 * date whose expiry falls outside the Date range reads as no choice without
 * throwing. Covers C-6, C-38, C-40.
 */

import { describe, expect, it } from "vitest";
import { effectiveChoice, isLiveChoice } from "./decision.js";
import { DAY, GPC_OFF, HOUR, POLICY, T0, at, decidedAt, futureDated, harness, plusMs } from "./fixtures.test.js";
import { BrowserConsentError, decideChoice, parseStoredChoice, type ConsentPolicy } from "./record.js";

describe("expiry fixed at decision (C-6)", () => {
  it("is the calendar-month end of the decision instant", () => {
    const choice = decideChoice("granted", at("2026-08-31T10:00:00.000Z"), POLICY, GPC_OFF);
    expect(choice).toEqual({
      status: "granted",
      decidedAt: "2026-08-31T10:00:00.000Z",
      expiresAt: "2027-02-28T10:00:00.000Z",
      policyVersion: POLICY.version,
    });
  });

  it("throws a typed error for an expiry that is not a whole number of at least 1", () => {
    for (const expiryMonths of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const call = () => decideChoice("denied", at(T0), { ...POLICY, expiryMonths }, GPC_OFF);
      expect(call).toThrow(BrowserConsentError);
      try {
        call();
      } catch (error) {
        expect((error as BrowserConsentError).code).toBe("invalid-expiry-months");
      }
    }
  });

  it("reads, re-reads and reopenings never renew or rewrite it", () => {
    const grant = decidedAt("granted", T0);
    const h = harness({ initial: grant });
    expect(h.snap()).toMatchObject({ effective: "granted", persistence: "stored" });
    for (const step of [DAY, 30 * DAY, 60 * DAY]) {
      h.time.advance(step);
      h.lifecycle.refresh();
      h.storage.emitExternalChange();
    }
    expect(h.storage.writes).toEqual([]);
    expect(h.storage.value).toEqual(grant);
    h.time.set(plusMs(grant.expiresAt, -1));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true });
    h.time.set(grant.expiresAt);
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "none", allowed: false, persistence: "none", promptAutomatically: true });
    expect(h.storage.writes).toEqual([]);
  });

  it("a grant read near its end is not live at its stored end, whatever the read time", () => {
    const grant = decidedAt("granted", T0);
    expect(isLiveChoice(grant, POLICY, new Date(Date.parse(grant.expiresAt) - 1))).toBe(true);
    expect(isLiveChoice(grant, POLICY, at(grant.expiresAt))).toBe(false);
    expect(isLiveChoice(grant, POLICY, new Date(Date.parse(grant.expiresAt) + DAY))).toBe(false);
  });
});

describe("every explicit choice writes a fresh record (C-38)", () => {
  it("grant over a live grant and refuse over a live denial each write a new decidedAt and expiresAt", () => {
    const h = harness();
    h.lifecycle.grant();
    h.time.advance(DAY);
    h.lifecycle.grant();
    h.time.advance(DAY);
    h.lifecycle.refuse();
    h.time.advance(DAY);
    h.lifecycle.refuse();
    const decided = h.storage.writes.map((write) => write.decidedAt);
    expect(h.storage.writes.map((write) => write.status)).toEqual(["granted", "granted", "denied", "denied"]);
    expect(decided).toEqual([T0, plusMs(T0, DAY), plusMs(T0, 2 * DAY), plusMs(T0, 3 * DAY)]);
    expect(new Set(h.storage.writes.map((write) => write.expiresAt)).size).toBe(4);
    for (const write of h.storage.writes) {
      expect(write).toEqual(decideChoice(write.status, at(write.decidedAt), POLICY, GPC_OFF));
    }
  });
});

describe("expired reads as no choice (C-7)", () => {
  it("an expired grant or denial is no choice, with no expired state", () => {
    for (const status of ["granted", "denied"] as const) {
      const record = decidedAt(status, "2025-01-01T00:00:00.000Z");
      const h = harness({ initial: record });
      expect(h.snap()).toMatchObject({ effective: "none", persistence: "none", promptAutomatically: true });
      expect(Object.values(h.snap())).not.toContain("expired");
    }
  });
});

describe("reading caps expiry (C-40)", () => {
  it("replaces a longer stored expiry with the policy's length from decidedAt", () => {
    const longLived = { ...decidedAt("granted", T0), expiresAt: "2030-01-01T00:00:00.000Z" };
    const parsed = parseStoredChoice(longLived, POLICY);
    expect(parsed?.expiresAt).toBe(decidedAt("granted", T0).expiresAt);
    const h = harness({ initial: longLived });
    h.time.set(plusMs(decidedAt("granted", T0).expiresAt, HOUR));
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "none", allowed: false });
  });

  it("keeps a shorter stored expiry", () => {
    const shortLived = { ...decidedAt("granted", T0), expiresAt: plusMs(T0, DAY) };
    expect(parseStoredChoice(shortLived, POLICY)?.expiresAt).toBe(plusMs(T0, DAY));
  });

  it("treats a record decided after its own expiry as corrupt", () => {
    const backwards = { ...decidedAt("denied", T0), expiresAt: plusMs(T0, -1) };
    expect(parseStoredChoice(backwards, POLICY)).toBeNull();
  });
});

describe("future-dated records (C-40)", () => {
  it("a denial dated after now stays live until its capped expiry", () => {
    const denial = futureDated("denied", T0, 2 * DAY);
    expect(isLiveChoice(denial, POLICY, at(T0))).toBe(true);
    expect(effectiveChoice(denial, GPC_OFF, POLICY, at(T0))).toBe("denied");
    const h = harness({ regime: "notice", initial: denial });
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
  });

  it("a grant dated after now is not live", () => {
    const grant = futureDated("granted", T0, 2 * DAY);
    expect(isLiveChoice(grant, POLICY, at(T0))).toBe(false);
    expect(effectiveChoice(grant, GPC_OFF, POLICY, at(T0))).toBe("none");
    const h = harness({ initial: grant });
    expect(h.snap()).toMatchObject({ effective: "none", allowed: false, persistence: "none" });
  });
});

describe("reading the current shape's dates (P-8, C-40, C-60)", () => {
  it("accepts only ISO 8601 UTC instants for decidedAt and expiresAt", () => {
    const record = decidedAt("granted", T0);
    expect(parseStoredChoice(record, POLICY)).toEqual(record);
    expect(parseStoredChoice({ ...record, decidedAt: "2026-03-10T12:00:00Z" }, POLICY)?.decidedAt).toBe(T0);
    for (const date of [
      "March 10, 2026",
      "2026-03-10",
      "2026-03-10T12:00:00.000+01:00",
      "2026-03-10T12:00:00.000+00:00",
      "2026-02-30T00:00:00.000Z",
      " " + T0,
    ]) {
      expect(parseStoredChoice({ ...record, decidedAt: date }, POLICY), date).toBeNull();
    }
    // Each names an instant after decidedAt, so only the format rejects it.
    for (const date of [
      "September 10, 2026",
      "2026-09-10",
      "2026-09-10T12:00:00.000+01:00",
      "2026-03-10T12:00:00.000+00:00",
      "2026-04-31T00:00:00.000Z",
    ]) {
      expect(parseStoredChoice({ ...record, expiresAt: date }, POLICY), date).toBeNull();
    }
  });

  it("an instant whose expiry falls outside the Date range reads as no choice and never throws", () => {
    const policy: ConsentPolicy = { ...POLICY, legacy: { accept: true, assumedPolicyVersion: POLICY.version } };
    const edge = { status: "denied", decidedAt: 8.64e15 };
    expect(() => parseStoredChoice(edge, policy)).not.toThrow();
    expect(parseStoredChoice(edge, policy)).toBeNull();
    const h = harness({ policy, initial: edge });
    expect(h.snap()).toMatchObject({ effective: "none", persistence: "none" });
  });
});
