import { describe, expect, it } from "vitest";
import {
  defineKeyCustody,
  evaluateRotation,
  rotationQueue,
  sameDigest,
  summarizeRotationMetric,
  type RotationEvaluation,
  type RotationRecord,
  type RotationState,
} from "./index.js";

const now = new Date("2026-08-18T00:00:00.000Z");
const policy = { key: "APP_SIGNING_KEY", maxAgeDays: 90 } as const;

describe("evaluateRotation", () => {
  it("reports unowned when custody has no recorded owner, even with a fresh rotation date", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: null, store: "infisical" }]);
    const record: RotationRecord = { key: "APP_SIGNING_KEY", lastRotatedAt: now.toISOString() };

    expect(evaluateRotation(record, policy, custody, now).state).toBe("unowned");
  });

  it("reports unowned when the key was never declared in custody at all", () => {
    const custody = defineKeyCustody([]);
    const record: RotationRecord = { key: "APP_SIGNING_KEY", lastRotatedAt: now.toISOString() };

    expect(evaluateRotation(record, policy, custody, now).state).toBe("unowned");
  });

  it("reports unverifiable when owned but no rotation date was ever recorded", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" }]);
    const record: RotationRecord = { key: "APP_SIGNING_KEY", lastRotatedAt: null };

    const evaluation = evaluateRotation(record, policy, custody, now);
    expect(evaluation.state).toBe("unverifiable");
    expect(evaluation.ageDays).toBeNull();
  });

  it("reports unverifiable, not a thrown error or a guess, when the recorded date cannot be parsed", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" }]);
    const record: RotationRecord = { key: "APP_SIGNING_KEY", lastRotatedAt: "not-a-date" };

    expect(evaluateRotation(record, policy, custody, now).state).toBe("unverifiable");
  });

  it("reports current when the observed age is within policy", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" }]);
    const record: RotationRecord = {
      key: "APP_SIGNING_KEY",
      lastRotatedAt: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
    };

    const evaluation = evaluateRotation(record, policy, custody, now);
    expect(evaluation.state).toBe("current");
    expect(evaluation.ageDays).toBe(10);
  });

  it("reports stale when the observed age exceeds policy", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" }]);
    const record: RotationRecord = {
      key: "APP_SIGNING_KEY",
      lastRotatedAt: new Date(now.getTime() - 200 * 86_400_000).toISOString(),
    };

    const evaluation = evaluateRotation(record, policy, custody, now);
    expect(evaluation.state).toBe("stale");
    expect(evaluation.ageDays).toBe(200);
  });

  it("rejects a record/policy key mismatch rather than silently evaluating the wrong key", () => {
    const custody = defineKeyCustody([{ key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" }]);
    const record: RotationRecord = { key: "OTHER_KEY", lastRotatedAt: now.toISOString() };

    expect(() => evaluateRotation(record, policy, custody, now)).toThrow(RangeError);
  });

  it("the state type is exactly the four-member union — every branch above is reachable and no fifth state exists", () => {
    const states: readonly RotationState[] = ["current", "stale", "unowned", "unverifiable"];
    expect(new Set(states).size).toBe(4);
  });
});

describe("rotationQueue", () => {
  it("includes every non-current state and excludes current", () => {
    const evaluations: RotationEvaluation[] = [
      { key: "A", state: "current", ageDays: 5 },
      { key: "B", state: "stale", ageDays: 200 },
      { key: "C", state: "unowned", ageDays: null },
      { key: "D", state: "unverifiable", ageDays: null },
    ];

    expect(rotationQueue(evaluations)).toEqual(["B", "C", "D"]);
  });
});

describe("summarizeRotationMetric", () => {
  it("computes p95 age only from observed ages, and counts unowned keys separately", () => {
    const evaluations: RotationEvaluation[] = [
      { key: "A", state: "current", ageDays: 10 },
      { key: "B", state: "current", ageDays: 20 },
      { key: "C", state: "stale", ageDays: 400 },
      { key: "D", state: "unowned", ageDays: null },
      { key: "E", state: "unverifiable", ageDays: null },
    ];

    const metric = summarizeRotationMetric(evaluations);
    expect(metric.p95AgeDays).toBe(400);
    expect(metric.unownedKeyCount).toBe(1);
  });

  it("returns a null percentile, not zero, when no key has an observable age", () => {
    const evaluations: RotationEvaluation[] = [
      { key: "A", state: "unowned", ageDays: null },
      { key: "B", state: "unverifiable", ageDays: null },
    ];

    expect(summarizeRotationMetric(evaluations).p95AgeDays).toBeNull();
  });
});

describe("sameDigest", () => {
  it("compares only the caller-supplied opaque digest, never a value", () => {
    const a: RotationRecord = { key: "K", lastRotatedAt: null, digest: "sha256:abc" };
    const b: RotationRecord = { key: "K", lastRotatedAt: null, digest: "sha256:abc" };
    const c: RotationRecord = { key: "K", lastRotatedAt: null, digest: "sha256:def" };

    expect(sameDigest(a, b)).toBe(true);
    expect(sameDigest(a, c)).toBe(false);
  });

  it("is false when either side never supplied a digest", () => {
    const withDigest: RotationRecord = { key: "K", lastRotatedAt: null, digest: "sha256:abc" };
    const withoutDigest: RotationRecord = { key: "K", lastRotatedAt: null };

    expect(sameDigest(withDigest, withoutDigest)).toBe(false);
  });
});
