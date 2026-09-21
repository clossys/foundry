import { describe, expect, it } from "vitest";
import { checkFoldMeasurement, parseFoldMeasurement } from "./check-fold.js";

const green = {
  viewport: { width: 1440, height: 900 },
  h1Clipped: false,
  overlayIntersectingFold: [],
  primaryCtaCount: 1,
  heroMediaKind: "product-surface",
};

describe("parseFoldMeasurement", () => {
  it("accepts a valid measurement", () => {
    const result = parseFoldMeasurement(green);
    expect(result.ok).toBe(true);
  });

  it("rejects stock-metaphor heroMediaKind", () => {
    const result = parseFoldMeasurement({ ...green, heroMediaKind: "stock-metaphor" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("invalid-hero-media-kind");
  });
});

describe("checkFoldMeasurement", () => {
  it("returns no findings for a green fixture", () => {
    const parsed = parseFoldMeasurement(green);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkFoldMeasurement(parsed.measurement)).toEqual([]);
  });

  it("flags clipped H1", () => {
    const parsed = parseFoldMeasurement({ ...green, h1Clipped: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkFoldMeasurement(parsed.measurement).some((f) => f.rule === "fold:h1-clipped")).toBe(true);
  });

  it("flags overlays on the fold", () => {
    const parsed = parseFoldMeasurement({
      ...green,
      overlayIntersectingFold: ["[data-consent-banner]"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = checkFoldMeasurement(parsed.measurement);
    expect(findings.some((f) => f.rule === "fold:overlay-intersecting-fold")).toBe(true);
    expect(findings[0]?.message).toContain("[data-consent-banner]");
  });

  it("flags zero primary CTAs", () => {
    const parsed = parseFoldMeasurement({ ...green, primaryCtaCount: 0 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkFoldMeasurement(parsed.measurement).some((f) => f.rule === "fold:primary-cta-count")).toBe(true);
  });

  it("flags two primary CTAs", () => {
    const parsed = parseFoldMeasurement({ ...green, primaryCtaCount: 2 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(checkFoldMeasurement(parsed.measurement).some((f) => f.rule === "fold:primary-cta-count")).toBe(true);
  });
});
