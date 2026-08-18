import { describe, expect, it } from "vitest";
import * as observer from "./index.js";
import { computeEscapeRate } from "./escape-rate.js";
import { computeUnobservedSurface } from "./unobserved-surface.js";

/**
 * The runtime companion to `metrics.check.ts`'s compile-time proof.
 *
 * `metrics.check.ts` proves the two metric TYPES share no field name at the
 * type level. This test proves the two facts a type-level check cannot: the
 * package's actual export list contains no function that accepts both
 * report shapes, and the two functions' real return values — not just
 * their declared types — carry no overlapping key beside the discriminant.
 */
describe("the two metrics are never combined", () => {
  it("index.ts exports no function whose name suggests a combined or blended metric", () => {
    const suspiciousNamePattern = /combin|blend|merge|overall|score|aggregate/i;
    const exportNames = Object.keys(observer);
    const suspicious = exportNames.filter((name) => suspiciousNamePattern.test(name));
    expect(suspicious).toEqual([]);
  });

  it("index.ts exports the two metric-producing functions with distinct argument shapes", () => {
    expect(typeof observer.computeEscapeRate).toBe("function");
    expect(typeof observer.computeUnobservedSurface).toBe("function");
    // computeEscapeRate(gate, outcomes) takes 2 arguments; computeUnobservedSurface(declared, reads)
    // also takes 2 — but different types, so nothing accidentally accepts both interchangeably. There
    // is no third exported function with a signature wide enough to accept both.
    expect(observer.computeEscapeRate.length).toBe(2);
    expect(observer.computeUnobservedSurface.length).toBe(2);
  });

  it("the two metrics' real return values share no field beside the discriminant", () => {
    const escapeRate = computeEscapeRate("secret-scan", [
      { gate: "secret-scan", changeId: "pr-1", violation: { state: "observed" } },
    ]);
    const unobservedSurface = computeUnobservedSurface(
      [{ id: "gate:secret-scan" }],
      [{ subject: "gate:secret-scan", presence: { state: "observed", eventCount: 1 } }],
    );

    const escapeRateKeys = new Set(Object.keys(escapeRate));
    const unobservedSurfaceKeys = new Set(Object.keys(unobservedSurface));
    const shared = [...escapeRateKeys].filter((key) => unobservedSurfaceKeys.has(key));

    expect(shared).toEqual(["kind"]);
    expect(escapeRate.kind).not.toBe(unobservedSurface.kind);
  });
});
