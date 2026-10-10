/**
 * P-23: a grant under a non-overridable signal writes nothing and calls no
 * evidence port; a grant under an overridable signal records
 * `gpcOverride`; a grant without it never overrides a signal that is on;
 * any truthy signal counts as on. Covers C-8, C-39.
 */

import { describe, expect, it, vi } from "vitest";
import { effectiveChoice, isAllowed, shouldPromptAutomatically } from "./decision.js";
import { DAY, GPC_OFF, GPC_ON, POLICY, T0, at, decidedAt, flush, harness, plusMs } from "./fixtures.test.js";
import { BrowserConsentError, decideChoice } from "./record.js";

const OVERRIDABLE = { ...POLICY, gpcOverridable: true };

describe("accept under a non-overridable signal is a no-op (C-39)", () => {
  for (const policy of [POLICY, { ...POLICY, gpcOverridable: false }]) {
    it(`writes nothing, calls no evidence port and changes no state (gpcOverridable ${String(policy.gpcOverridable)})`, async () => {
      const h = harness({ signals: GPC_ON, policy });
      const listener = vi.fn();
      h.lifecycle.subscribe(listener);
      const before = h.snap();
      expect(before).toMatchObject({ effective: "denied", allowed: false, gpcInForce: true });
      const after = h.lifecycle.grant();
      await flush();
      expect(after).toBe(before);
      expect(h.snap()).toBe(before);
      expect(h.storage.writes).toEqual([]);
      expect(h.evidence.calls).toEqual([]);
      expect(listener).not.toHaveBeenCalled();
    });
  }

  it("decideChoice refuses to produce such a grant", () => {
    expect(() => decideChoice("granted", at(T0), POLICY, GPC_ON)).toThrow(BrowserConsentError);
    expect(() => decideChoice("granted", at(T0), POLICY, GPC_ON)).toThrow(/Global Privacy Control/);
  });

  it("a refusal under the signal still writes", () => {
    const h = harness({ signals: GPC_ON });
    expect(h.lifecycle.refuse()).toMatchObject({ effective: "denied", persistence: "stored" });
    expect(h.storage.writes.map((write) => write.status)).toEqual(["denied"]);
  });
});

describe("a grant under an overridable signal (C-39)", () => {
  it("records gpcOverride and is allowed", () => {
    const h = harness({ signals: GPC_ON, policy: OVERRIDABLE });
    expect(h.snap()).toMatchObject({ effective: "denied", gpcInForce: false });
    const snapshot = h.lifecycle.grant();
    expect(h.storage.writes).toEqual([{ ...decidedAt("granted", T0, OVERRIDABLE, GPC_ON), gpcOverride: true }]);
    expect(snapshot).toMatchObject({ effective: "granted", allowed: true, persistence: "stored" });
  });

  it("decideChoice marks only a grant decided while the signal was on", () => {
    expect(decideChoice("granted", at(T0), OVERRIDABLE, GPC_ON).gpcOverride).toBe(true);
    expect(decideChoice("granted", at(T0), OVERRIDABLE, GPC_OFF)).not.toHaveProperty("gpcOverride");
    expect(decideChoice("denied", at(T0), OVERRIDABLE, GPC_ON)).not.toHaveProperty("gpcOverride");
  });
});

describe("a grant without gpcOverride never overrides a signal that is on (C-8)", () => {
  it("even when the policy is overridable", () => {
    const plainGrant = decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE, GPC_OFF);
    expect(effectiveChoice(plainGrant, GPC_ON, OVERRIDABLE, at(T0))).toBe("denied");
    expect(isAllowed(plainGrant, GPC_ON, "notice", OVERRIDABLE, at(T0))).toBe(false);
    const h = harness({ signals: GPC_ON, policy: OVERRIDABLE, initial: plainGrant });
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "stored" });
  });

  it("an override grant stops overriding when the policy no longer allows overrides", () => {
    const overrideGrant = decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE, GPC_ON);
    expect(effectiveChoice(overrideGrant, GPC_ON, OVERRIDABLE, at(T0))).toBe("granted");
    expect(effectiveChoice(overrideGrant, GPC_ON, POLICY, at(T0))).toBe("denied");
  });
});

describe("any truthy signal counts as on, fail-closed (C-8, C-59)", () => {
  const truthy = { gpc: 1 } as unknown as typeof GPC_ON;

  it("the lifecycle treats gpc: 1 as on: in force, and a grant is a no-op", () => {
    const h = harness({ signals: truthy });
    expect(h.snap()).toMatchObject({ gpcInForce: true, effective: "denied", allowed: false });
    h.lifecycle.grant();
    expect(h.storage.writes).toEqual([]);
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false });
  });

  it("the decision rules and decideChoice treat gpc: 1 as on", () => {
    expect(effectiveChoice("unreadable", truthy, POLICY, at(T0))).toBe("denied");
    expect(effectiveChoice(decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE), truthy, OVERRIDABLE, at(T0))).toBe("denied");
    expect(() => decideChoice("granted", at(T0), POLICY, truthy)).toThrow(BrowserConsentError);
    expect(decideChoice("granted", at(T0), OVERRIDABLE, truthy).gpcOverride).toBe(true);
  });

  for (const value of [1, "1"]) {
    const signals = { gpc: value } as unknown as typeof GPC_ON;

    it(`isAllowed and shouldPromptAutomatically treat gpc: ${JSON.stringify(value)} as on`, () => {
      const grant = decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE);
      // No choice under notice would allow, and under prompt would prompt, with the signal off.
      expect(isAllowed(null, GPC_OFF, "notice", POLICY, at(T0))).toBe(true);
      expect(isAllowed(null, signals, "notice", POLICY, at(T0))).toBe(false);
      expect(shouldPromptAutomatically(null, GPC_OFF, "prompt", POLICY, at(T0))).toBe(true);
      expect(shouldPromptAutomatically(null, signals, "prompt", POLICY, at(T0))).toBe(false);
      // A grant without an override allows only while the signal is off.
      expect(isAllowed(grant, GPC_OFF, "prompt", OVERRIDABLE, at(T0))).toBe(true);
      expect(isAllowed(grant, signals, "prompt", OVERRIDABLE, at(T0))).toBe(false);
      expect(isAllowed("unreadable", signals, "notice", POLICY, at(T0))).toBe(false);
    });

    it(`the lifecycle treats gpc: ${JSON.stringify(value)} as on`, () => {
      const h = harness({ signals, regime: "notice" });
      expect(h.snap()).toMatchObject({ gpcInForce: true, effective: "denied", allowed: false, promptAutomatically: false });
      h.lifecycle.grant();
      expect(h.storage.writes).toEqual([]);
    });
  }
});
