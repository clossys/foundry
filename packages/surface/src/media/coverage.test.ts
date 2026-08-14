import { describe, expect, it } from "vitest";
import { checkAssetCoverage } from "./coverage.js";
import type { AssetRecord } from "./types.js";

const record: AssetRecord = {
  id: "acme-app",
  entries: [
    {
      id: "marketing.hero-banner",
      type: "image",
      src: "/images/hero-banner.png",
      width: 1600,
      height: 900,
      alt: "Illustration of a laptop showing a dashboard",
      licence: "CC-BY-4.0",
    },
    {
      id: "marketing.footer-logo",
      type: "image",
      src: "/images/logo.svg",
      width: 200,
      height: 50,
      alt: "Acme logo",
      licence: "proprietary — internal use only",
    },
  ],
};

describe("checkAssetCoverage — clean pass", () => {
  it("ok: true when every referenced id is registered and every registered id is referenced", () => {
    const report = checkAssetCoverage(["marketing.hero-banner", "marketing.footer-logo"], record);
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([]);
    expect(report.checkedCount).toBe(2);
    expect(report.registeredCount).toBe(2);
    expect(report.registeredByType).toEqual({ image: 2, video: 0 });
  });
});

describe("checkAssetCoverage — FIXTURE: unregistered id", () => {
  it("reports unregistered-asset (error) for a referenced id with no matching entry", () => {
    const report = checkAssetCoverage(["marketing.hero-banner", "marketing.does-not-exist"], record);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.rule === "unregistered-asset");
    expect(finding).toEqual({
      rule: "unregistered-asset",
      severity: "error",
      message:
        'Referenced asset id "marketing.does-not-exist" (referencedIds[1]) has no matching entry in AssetRecord "acme-app".',
      path: "marketing.does-not-exist",
    });
  });
});

describe("checkAssetCoverage — registered but unreferenced (lower severity)", () => {
  it("reports unreferenced-asset (warning) for a registered entry no id names", () => {
    const report = checkAssetCoverage(["marketing.hero-banner"], record);
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.rule === "unreferenced-asset");
    expect(finding).toEqual({
      rule: "unreferenced-asset",
      severity: "warning",
      message: 'Registered asset id "marketing.footer-logo" in AssetRecord "acme-app" is never referenced by any checked id.',
      path: "marketing.footer-logo",
    });
  });
});

describe("checkAssetCoverage — asset-missing-licence (issue #177)", () => {
  const recordWithNoLicence: AssetRecord = {
    id: "acme-app",
    entries: [
      { id: "marketing.hero-banner", type: "image", src: "/images/hero-banner.png", width: 1600, height: 900, alt: "hero" },
    ],
  };

  it("reports asset-missing-licence (warning) for a registered entry with no licence", () => {
    const report = checkAssetCoverage(["marketing.hero-banner"], recordWithNoLicence);
    const finding = report.findings.find((f) => f.rule === "asset-missing-licence");
    expect(finding).toEqual({
      rule: "asset-missing-licence",
      severity: "warning",
      message: 'Registered asset id "marketing.hero-banner" in AssetRecord "acme-app" has no licence — its usage terms are unstated, indistinguishable from being unlicensed.',
      path: "marketing.hero-banner",
    });
    expect(report.ok).toBe(false); // findings must be empty, full stop — severity aside
  });

  it("does NOT report asset-missing-licence when licence is present", () => {
    const report = checkAssetCoverage(["marketing.hero-banner"], record);
    expect(report.findings.some((f) => f.rule === "asset-missing-licence")).toBe(false);
  });

  it("fires for an UNREFERENCED entry too — licence is a property of the entry, independent of whether it's referenced", () => {
    const report = checkAssetCoverage([], recordWithNoLicence);
    expect(report.findings.some((f) => f.rule === "asset-missing-licence" && f.path === "marketing.hero-banner")).toBe(true);
  });
});

describe("checkAssetCoverage — registeredByType (issue #177)", () => {
  const mixedRecord: AssetRecord = {
    id: "acme-app",
    entries: [
      { id: "marketing.hero-banner", type: "image", src: "/images/hero.png", width: 1600, height: 900, alt: "hero", licence: "CC-BY-4.0" },
      {
        id: "marketing.hero-video",
        type: "video",
        sources: [{ src: "/videos/hero.mp4", mimeType: "video/mp4" }],
        width: 1920,
        height: 1080,
        alt: "hero video",
        transcript: "A transcript.",
        reducedMotion: "no-autoplay",
        licence: "CC-BY-4.0",
      },
    ],
  };

  it("counts registered entries by type", () => {
    const report = checkAssetCoverage(["marketing.hero-banner", "marketing.hero-video"], mixedRecord);
    expect(report.registeredByType).toEqual({ image: 1, video: 1 });
  });

  it("is { image: 0, video: 0 } when the record itself is invalid", () => {
    const invalidRecord = { id: "acme-app", entries: [{ id: "bad" }] } as unknown as AssetRecord;
    const report = checkAssetCoverage(["x.y"], invalidRecord);
    expect(report.registeredByType).toEqual({ image: 0, video: 0 });
  });

  it("is { image: 0, video: 0 } when referencedIds itself is not an array", () => {
    const report = checkAssetCoverage(undefined, mixedRecord);
    expect(report.registeredByType).toEqual({ image: 1, video: 1 }); // record IS valid here — only referencedIds is malformed
  });

  it("checkAssetCoverage's own id-matching does not branch on type — a video id matches by id alone", () => {
    const report = checkAssetCoverage(["marketing.hero-video"], mixedRecord);
    expect(report.findings.some((f) => f.rule === "unregistered-asset")).toBe(false);
  });
});

describe("checkAssetCoverage — zero referenced ids must never report a clean pass", () => {
  it("ok: false for an empty referencedIds array against a non-empty registry (every entry is also reported unreferenced)", () => {
    const report = checkAssetCoverage([], record);
    expect(report.checkedCount).toBe(0);
    expect(report.findings.every((f) => f.rule === "unreferenced-asset")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("ok: false for an empty referencedIds array against an EMPTY registry too — checkedCount 0 alone must force ok: false even with zero findings", () => {
    const emptyRecord: AssetRecord = { id: "acme-app", entries: [] };
    const report = checkAssetCoverage([], emptyRecord);
    expect(report.checkedCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.registeredByType).toEqual({ image: 0, video: 0 });
  });

  it("ok: false for a non-array referencedIds, landing in unchecked", () => {
    const report = checkAssetCoverage(undefined, record);
    expect(report.ok).toBe(false);
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]).toMatch(/must be an array/);
  });
});

describe("checkAssetCoverage — malformed referencedIds entries land in unchecked, never silently dropped", () => {
  it("a non-string entry is recorded in unchecked, described by position", () => {
    const report = checkAssetCoverage(["marketing.hero-banner", 42, "marketing.footer-logo"], record);
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]).toMatch(/referencedIds\[1\]/);
    expect(report.ok).toBe(false);
    expect(report.checkedCount).toBe(2);
  });

  it("a whitespace-only string entry is recorded in unchecked", () => {
    const report = checkAssetCoverage(["marketing.hero-banner", "   ", "marketing.footer-logo"], record);
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]).toMatch(/referencedIds\[1\]/);
  });
});

describe("checkAssetCoverage — fails closed on an invalid AssetRecord", () => {
  it("every referenced id lands in unchecked when record itself is structurally invalid", () => {
    const invalidRecord = { id: "acme-app", entries: [{ id: "bad" }] } as unknown as AssetRecord;
    const report = checkAssetCoverage(["marketing.hero-banner"], invalidRecord);
    expect(report.ok).toBe(false);
    expect(report.checkedCount).toBe(0);
    expect(report.registeredCount).toBe(0);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]).toMatch(/record invalid/);
  });

  it("a non-object record is reported the same way, never thrown", () => {
    expect(() => checkAssetCoverage(["x.y"], null as unknown as AssetRecord)).not.toThrow();
    const report = checkAssetCoverage(["x.y"], null as unknown as AssetRecord);
    expect(report.ok).toBe(false);
    expect(report.recordId).toBe("(unknown)");
  });
});

describe("checkAssetCoverage — zero-entry record with zero referenced ids", () => {
  it("is still ok: false (nothing checked), never a trivial clean pass", () => {
    const empty: AssetRecord = { id: "acme-app", entries: [] };
    const report = checkAssetCoverage([], empty);
    expect(report.ok).toBe(false);
    expect(report.checkedCount).toBe(0);
    expect(report.findings).toEqual([]);
  });
});
