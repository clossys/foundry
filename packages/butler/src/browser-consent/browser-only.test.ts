/**
 * P-7: with no evidence port (browser-only mode), a grant-and-refuse cycle
 * makes zero `fetch` or `sendBeacon` calls and evidence is never `saved`.
 * Covers C-14.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY, GPC_OFF, HOUR, POLICY, T0, decidedAt, fixedClock, flush, harness, memoryStorage, plusMs } from "./fixtures.test.js";
import { createConsentLifecycle, type ConsentSnapshot } from "./lifecycle.js";

const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in browser-only mode")));
const beaconSpy = vi.fn(() => false);

beforeEach(() => {
  fetchSpy.mockClear();
  beaconSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("navigator", { sendBeacon: beaconSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-only mode makes no network request (C-14)", () => {
  for (const [name, evidence] of [
    ["evidence: false", false],
    ["no evidence option", undefined],
  ] as const) {
    it(`a full grant-and-refuse cycle with ${name}`, async () => {
      const storage = memoryStorage();
      const time = fixedClock();
      const lifecycle = createConsentLifecycle({
        storage: storage.port,
        ...(evidence === undefined ? {} : { evidence }),
        policy: POLICY,
        regime: "notice",
        signals: GPC_OFF,
        clock: time.clock,
      });
      const seen: ConsentSnapshot[] = [lifecycle.getSnapshot()];
      lifecycle.subscribe(() => seen.push(lifecycle.getSnapshot()));
      seen.push(lifecycle.grant());
      time.advance(HOUR);
      seen.push(lifecycle.refuse());
      time.advance(HOUR);
      seen.push(lifecycle.grant());
      time.advance(HOUR);
      seen.push(lifecycle.refuse());
      seen.push(lifecycle.refresh());
      await flush();
      seen.push(lifecycle.getSnapshot());

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
      expect(seen.map((snapshot) => snapshot.evidence)).not.toContain("saved");
      expect(seen.every((snapshot) => snapshot.evidence === "none")).toBe(true);
      expect(storage.writes.map((write) => write.status)).toEqual(["granted", "denied", "granted", "denied"]);
      expect(lifecycle.getSnapshot()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
    });
  }

  it("gating follows the local record and never waits for evidence", () => {
    const h = harness({ evidence: false, initial: decidedAt("granted", plusMs(T0, -DAY)) });
    expect(h.snap()).toMatchObject({ effective: "granted", allowed: true, evidence: "none" });
    expect(h.lifecycle.refuse()).toMatchObject({ allowed: false, evidence: "none" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });
});
