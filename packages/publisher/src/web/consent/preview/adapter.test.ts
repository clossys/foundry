import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_DECISION_VIEW } from "../ports.js";
import type { ConsentSnapshotView } from "../ports.js";
import { createConsentPreview } from "./adapter.js";
import type { ConsentPreviewState } from "./adapter.js";

const NOW = "2026-01-01T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const row = (fields: Partial<ConsentSnapshotView>): ConsentSnapshotView => ({ ...NO_DECISION_VIEW, ...fields, simulated: true });
const PENDING_GRANT = { effective: "granted", allowed: true, persistence: "stored", evidence: "pending" } as const;

/** The preview table, restated independently of the adapter. */
const TABLE: Record<ConsentPreviewState, { snapshot: ConsentSnapshotView; required: boolean }> = {
  "fresh-prompt": { snapshot: row({ regime: "prompt", effective: "none", promptAutomatically: true }), required: true },
  "fresh-notice": { snapshot: row({ regime: "notice", effective: "none", allowed: true }), required: true },
  "remembered-granted": { snapshot: row({ effective: "granted", allowed: true, persistence: "stored" }), required: true },
  "remembered-refused": { snapshot: row({ effective: "denied", persistence: "stored" }), required: true },
  withdrawn: { snapshot: row({ effective: "denied", persistence: "stored", sequence: 1 }), required: true },
  expired: { snapshot: row({ regime: "prompt", effective: "none", promptAutomatically: true }), required: true },
  gpc: { snapshot: row({ effective: "denied", gpcInForce: true }), required: true },
  "not-required": { snapshot: row({}), required: false },
  "pending-grant": { snapshot: row(PENDING_GRANT), required: true },
  "simulated-saved": { snapshot: row({ ...PENDING_GRANT, evidence: "simulated-saved" }), required: true },
  conflict: { snapshot: row({ ...PENDING_GRANT, evidence: "conflict" }), required: true },
  unavailable: { snapshot: row({ ...PENDING_GRANT, evidence: "unavailable" }), required: true },
  "pending-withdrawal": { snapshot: row({ effective: "denied", persistence: "stored", evidence: "pending", sequence: 1 }), required: true },
  "withdrawal-failed": { snapshot: row({ effective: "denied", persistence: "memory", withdrawal: "failed" }), required: true },
  "reopen-unreadable": { snapshot: row({ effective: "unknown", storage: "unreadable" }), required: true },
};
const STATES = Object.keys(TABLE) as ConsentPreviewState[];

describe("preview/adapter (P-21)", () => {
  it("covers exactly fifteen states", () => {
    expect(STATES).toHaveLength(15);
  });

  it.each(STATES)("produces the table row for %s", (state) => {
    const preview = createConsentPreview({ state, now: NOW, environment: "development" });
    expect(preview.lifecycle.getSnapshot()).toStrictEqual(TABLE[state].snapshot);
    expect(preview.required).toBe(TABLE[state].required);
    preview.dispose();
  });

  it("makes expired byte-identical to fresh-prompt", () => {
    const expired = createConsentPreview({ state: "expired", now: NOW, environment: "development" }).lifecycle.getSnapshot();
    const fresh = createConsentPreview({ state: "fresh-prompt", now: NOW, environment: "development" }).lifecycle.getSnapshot();
    expect(JSON.stringify(expired)).toBe(JSON.stringify(fresh));
  });

  it("does no I/O, sets no timer and reads no clock in any state or operation, and never produces saved", async () => {
    vi.useFakeTimers();
    const io = vi.fn();
    const trap = new Proxy({}, { get: () => io });
    vi.stubGlobal("fetch", io);
    vi.stubGlobal("localStorage", trap);
    vi.stubGlobal("sessionStorage", trap);
    vi.stubGlobal("navigator", { sendBeacon: io });
    vi.stubGlobal("XMLHttpRequest", io);
    vi.stubGlobal("WebSocket", io);
    const dateNow = vi.spyOn(Date, "now");
    const performanceNow = vi.spyOn(performance, "now");
    const seen = new Set<string>();
    for (const state of STATES) {
      for (const result of ["simulated-saved", "conflict", "unavailable"] as const) {
        const preview = createConsentPreview({ state, now: NOW, environment: "preview" });
        const listener = vi.fn();
        preview.lifecycle.subscribe(listener);
        for (const step of [
          () => preview.lifecycle.grant(),
          () => preview.settle(result),
          () => preview.lifecycle.refuse(),
          () => preview.settle(result),
          () => preview.lifecycle.refresh(),
        ]) {
          step();
          seen.add(preview.lifecycle.getSnapshot().evidence);
          expect(preview.lifecycle.getSnapshot().simulated).toBe(true);
        }
        preview.dispose();
      }
    }
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
    expect(io).not.toHaveBeenCalled();
    expect(dateNow).not.toHaveBeenCalled();
    expect(performanceNow).not.toHaveBeenCalled();
    expect(seen.has("saved")).toBe(false);
    expect(seen.has("simulated-saved")).toBe(true);
  });

  it("settles only on an explicit settle()", async () => {
    const preview = createConsentPreview({ state: "fresh-prompt", now: NOW, environment: "development" });
    const listener = vi.fn();
    preview.lifecycle.subscribe(listener);
    const granted = preview.lifecycle.grant();
    expect(granted.evidence).toBe("pending");
    expect(granted.sequence).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(preview.lifecycle.getSnapshot().evidence).toBe("pending");
    expect(listener).toHaveBeenCalledTimes(1);
    preview.settle("simulated-saved");
    expect(preview.lifecycle.getSnapshot().evidence).toBe("simulated-saved");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => preview.settle("saved" as never)).toThrow(/settle/);
    expect(preview.lifecycle.getSnapshot().evidence).toBe("simulated-saved");
  });

  it("keeps a failed withdrawal through a repeated refusal and a re-read, and a grant under the signal is a no-op", () => {
    const failed = createConsentPreview({ state: "withdrawal-failed", now: NOW, environment: "development" });
    expect(failed.lifecycle.refuse().withdrawal).toBe("failed");
    expect(failed.lifecycle.refresh().withdrawal).toBe("failed");
    const gpc = createConsentPreview({ state: "gpc", now: NOW, environment: "development" });
    const before = gpc.lifecycle.getSnapshot();
    expect(gpc.lifecycle.grant()).toBe(before);
  });

  it("releases every listener on dispose", () => {
    const preview = createConsentPreview({ state: "pending-grant", now: NOW, environment: "development" });
    const listener = vi.fn();
    preview.lifecycle.subscribe(listener);
    preview.dispose();
    preview.settle("conflict");
    preview.lifecycle.refuse();
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses production, an unknown state and a missing instant", () => {
    expect(() => createConsentPreview({ state: "fresh-prompt", now: NOW, environment: "production" })).toThrow(/refused/);
    expect(() => createConsentPreview({ state: "nope" as ConsentPreviewState, now: NOW, environment: "development" })).toThrow();
    expect(() => createConsentPreview({ state: "fresh-prompt", now: "not a date", environment: "development" })).toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createConsentPreview({ state: "fresh-prompt", now: NOW, environment: "development" })).toThrow(/production build/);
  });
});
