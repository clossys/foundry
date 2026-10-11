/**
 * P-5: regime (prompt, notice, missing) x GPC (on, off) x record (none,
 * granted, granted with override, denied, expired, older policy, corrupt,
 * unreadable). Covers C-5, C-7, C-8, C-9, C-37.
 */

import { describe, expect, it } from "vitest";
import { effectiveChoice, isAllowed, shouldPromptAutomatically } from "./decision.js";
import { DAY, GPC_OFF, GPC_ON, POLICY, T0, at, decidedAt, harness, plusMs } from "./fixtures.test.js";
import { normalizeRegime, parseStoredChoice, type ConsentPolicy, type EffectiveChoice, type StoredInput } from "./record.js";

const OVERRIDABLE: ConsentPolicy = { ...POLICY, gpcOverridable: true };
const NOW = at(T0);

const records: Record<string, StoredInput | string> = {
  none: null,
  granted: decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE),
  "granted with override": decidedAt("granted", plusMs(T0, -DAY), OVERRIDABLE, GPC_ON),
  denied: decidedAt("denied", plusMs(T0, -DAY), OVERRIDABLE),
  expired: decidedAt("granted", "2025-01-01T00:00:00.000Z", OVERRIDABLE),
  "older policy": decidedAt("granted", plusMs(T0, -DAY), { ...OVERRIDABLE, version: "policy-1" }),
  corrupt: '{"status":"granted","decidedAt":',
  unreadable: "unreadable",
};

/** The expected effective choice, written out by hand from C-7, C-8 and C-37. */
const expectedEffective: Record<string, { off: EffectiveChoice; on: EffectiveChoice }> = {
  none: { off: "none", on: "denied" },
  granted: { off: "granted", on: "denied" },
  "granted with override": { off: "granted", on: "granted" },
  denied: { off: "denied", on: "denied" },
  expired: { off: "none", on: "denied" },
  "older policy": { off: "none", on: "denied" },
  corrupt: { off: "none", on: "denied" },
  unreadable: { off: "unknown", on: "denied" },
};

const regimes: { label: string; value: unknown; normalized: "prompt" | "notice" }[] = [
  { label: "prompt", value: "prompt", normalized: "prompt" },
  { label: "notice", value: "notice", normalized: "notice" },
  { label: "missing", value: undefined, normalized: "prompt" },
];

function asInput(record: StoredInput | string): StoredInput {
  if (record === "unreadable" || record === null) return record;
  // A raw value reaches the decision rules as whatever parsing made of it.
  return typeof record === "string" ? parseStoredChoice(record, OVERRIDABLE) : record;
}

describe("decision matrix (P-5)", () => {
  for (const regime of regimes) {
    for (const gpc of [false, true]) {
      for (const [name, record] of Object.entries(records)) {
        it(`regime ${regime.label}, GPC ${gpc ? "on" : "off"}, record ${name}`, () => {
          const signals = gpc ? GPC_ON : GPC_OFF;
          const input = asInput(record);
          const effective = expectedEffective[name]![gpc ? "on" : "off"];
          expect(effectiveChoice(input, signals, OVERRIDABLE, NOW)).toBe(effective);
          const allowed = effective === "granted" || (effective === "none" && regime.normalized === "notice");
          expect(isAllowed(input, signals, regime.value, OVERRIDABLE, NOW)).toBe(allowed);
          expect(shouldPromptAutomatically(input, signals, regime.value, OVERRIDABLE, NOW)).toBe(
            effective === "none" && regime.normalized === "prompt",
          );
          if (gpc) expect(["none", "unknown"]).not.toContain(effective);
          if (effective === "denied") expect(allowed).toBe(false);
        });
      }
    }
  }

  it("the matrix holds through a mounted lifecycle reading the raw stored values", () => {
    for (const regime of regimes) {
      for (const gpc of [false, true]) {
        for (const [name, record] of Object.entries(records)) {
          const signals = gpc ? GPC_ON : GPC_OFF;
          const h = harness({
            regime: regime.value,
            signals,
            policy: OVERRIDABLE,
            initial: record === null || record === "unreadable" ? undefined : record,
            beforeMount: (storage) => {
              storage.modes.readUnavailable = record === "unreadable";
            },
          });
          const effective = expectedEffective[name]![gpc ? "on" : "off"];
          const snapshot = h.snap();
          expect({ name, regime: regime.label, gpc, effective: snapshot.effective }).toEqual({
            name,
            regime: regime.label,
            gpc,
            effective,
          });
          expect(snapshot.regime).toBe(regime.normalized);
          expect(snapshot.allowed).toBe(effective === "granted" || (effective === "none" && regime.normalized === "notice"));
          expect(snapshot.storage).toBe(record === "unreadable" ? "unreadable" : "readable");
          expect(h.storage.writes).toEqual([]);
        }
      }
    }
  });
});

describe("regime normalisation (C-5)", () => {
  it("is notice only for the exact string", () => {
    expect(normalizeRegime("notice")).toBe("notice");
    for (const value of [undefined, null, "", "prompt", "Notice", " notice", "notice ", 1, {}, ["notice"]]) {
      expect(normalizeRegime(value)).toBe("prompt");
    }
  });
});

describe("unreadable storage (C-37)", () => {
  it("is neither a choice nor permission under either regime, and never opens by itself", () => {
    for (const regime of ["prompt", "notice", undefined]) {
      expect(effectiveChoice("unreadable", GPC_OFF, POLICY, NOW)).toBe("unknown");
      expect(isAllowed("unreadable", GPC_OFF, regime, POLICY, NOW)).toBe(false);
      expect(shouldPromptAutomatically("unreadable", GPC_OFF, regime, POLICY, NOW)).toBe(false);
    }
  });

  it("a choice made while storage is unreadable holds in memory for the visit", () => {
    const h = harness({
      regime: "notice",
      beforeMount: (storage) => {
        storage.modes.readUnavailable = true;
        storage.modes.writeFails = true;
      },
    });
    expect(h.snap()).toMatchObject({ effective: "unknown", allowed: false, promptAutomatically: false, storage: "unreadable", persistence: "none" });
    h.lifecycle.refuse();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
    h.lifecycle.refresh();
    expect(h.snap()).toMatchObject({ effective: "denied", allowed: false, persistence: "memory" });
  });
});

describe("policy version (C-7)", () => {
  it("a denial survives a version bump only when the policy keeps denials", () => {
    const oldDenial = decidedAt("denied", plusMs(T0, -DAY), { ...POLICY, version: "policy-1" });
    expect(effectiveChoice(oldDenial, GPC_OFF, { ...POLICY, invalidateDenialOnPolicyBump: false }, NOW)).toBe("denied");
    expect(effectiveChoice(oldDenial, GPC_OFF, { ...POLICY, invalidateDenialOnPolicyBump: true }, NOW)).toBe("none");
    const oldGrant = decidedAt("granted", plusMs(T0, -DAY), { ...POLICY, version: "policy-1" });
    expect(effectiveChoice(oldGrant, GPC_OFF, { ...POLICY, invalidateDenialOnPolicyBump: false }, NOW)).toBe("none");
  });

  it("the end instant is outside the window", () => {
    const grant = decidedAt("granted", T0);
    expect(effectiveChoice(grant, GPC_OFF, POLICY, new Date(Date.parse(grant.expiresAt) - 1))).toBe("granted");
    expect(effectiveChoice(grant, GPC_OFF, POLICY, at(grant.expiresAt))).toBe("none");
  });
});
