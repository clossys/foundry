/**
 * P-25: a simulated lifecycle reports `allowed: false` after a grant and
 * never calls an evidence port (C-42). Also a smoke check of the option
 * types C-53 relies on: a reference host factory maps a structural factory
 * input onto `createConsentLifecycle` with no cast. It is not C-53's gate,
 * which belongs to the assembly's own test (P-31).
 */

import { describe, expect, it } from "vitest";
import { GPC_OFF, POLICY, T0, decidedAt, deferredEvidence, fixedClock, flush, harness, memoryStorage } from "./fixtures.test.js";
import {
  createConsentLifecycle,
  type ConsentEvidencePort,
  type ConsentLifecycle,
  type ConsentStoragePort,
} from "./lifecycle.js";

describe("a simulated lifecycle never allows (C-42)", () => {
  it("reports allowed: false after a grant and never calls the evidence port", async () => {
    const h = harness({ simulated: true });
    const snapshot = h.lifecycle.grant();
    expect(snapshot).toMatchObject({ simulated: true, allowed: false, effective: "granted", persistence: "stored", evidence: "none" });
    await flush();
    expect(h.evidence.calls).toEqual([]);
  });

  it("reports allowed: false for a stored grant and for no choice under notice", () => {
    expect(harness({ simulated: true, initial: decidedAt("granted", T0) }).snap()).toMatchObject({
      simulated: true,
      effective: "granted",
      allowed: false,
    });
    expect(harness({ simulated: true, regime: "notice" }).snap()).toMatchObject({ simulated: true, effective: "none", allowed: false });
  });

  it("a refusal after a seeded grant is a withdrawal through the read-back, and calls no port", async () => {
    const h = harness({ simulated: true });
    h.lifecycle.grant();
    const snapshot = h.lifecycle.refuse();
    expect(snapshot).toMatchObject({ simulated: true, effective: "denied", persistence: "stored", withdrawal: "idle", allowed: false });
    expect(h.storage.writes.map((write) => write.status)).toEqual(["granted", "denied"]);
    await flush();
    expect(h.evidence.calls).toEqual([]);
  });

  it("a live lifecycle over the same state does allow", () => {
    const h = harness();
    expect(h.lifecycle.grant()).toMatchObject({ simulated: false, allowed: true });
  });
});

/** Publisher's factory input, mirrored structurally here as a host would see it. */
interface StructuralLifecycleInput {
  signals: { gpc: boolean };
  storage?: ConsentStoragePort;
  evidence?: false;
  simulated?: true;
}

describe("reference host factory (C-53)", () => {
  const hostStorage = memoryStorage();
  const hostEvidence = deferredEvidence();
  const hostOptions = { policy: POLICY, regime: "prompt", clock: fixedClock().clock };
  const realEvidence: ConsentEvidencePort = hostEvidence.port;
  const realStorage: ConsentStoragePort = hostStorage.port;

  const factory = (input: StructuralLifecycleInput): ConsentLifecycle =>
    createConsentLifecycle({
      ...hostOptions,
      signals: input.signals,
      storage: input.storage ?? realStorage,
      evidence: input.evidence ?? realEvidence,
      simulated: input.simulated,
    });

  it("passes the seam's port, no evidence and simulated through", async () => {
    const seamStorage = memoryStorage();
    const lifecycle = factory({ signals: GPC_OFF, storage: seamStorage.port, evidence: false, simulated: true });
    expect(lifecycle.getSnapshot().simulated).toBe(true);
    expect(seamStorage.reads.length).toBe(1);
    lifecycle.grant();
    await flush();
    expect(seamStorage.writes.length).toBe(1);
    expect(hostStorage.writes).toEqual([]);
    expect(hostEvidence.calls).toEqual([]);
  });

  it("uses the host's own ports when the input carries none", () => {
    const lifecycle = factory({ signals: GPC_OFF });
    expect(lifecycle.getSnapshot().simulated).toBe(false);
    lifecycle.grant();
    expect(hostStorage.writes.length).toBe(1);
    expect(hostEvidence.calls.length).toBe(1);
  });
});
