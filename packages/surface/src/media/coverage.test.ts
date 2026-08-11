import { describe, expect, it } from "vitest";
import { checkAssetCoverage } from "./coverage.js";
import type { AssetRecord } from "./types.js";

const record: AssetRecord = {
  id: "acme-app",
  entries: [
    {
      id: "marketing.hero-banner",
      src: "/images/hero-banner.png",
      width: 1600,
      height: 900,
      alt: "Illustration of a laptop showing a dashboard",
    },
    {
      id: "marketing.footer-logo",
      src: "/images/logo.svg",
      width: 200,
      height: 50,
      alt: "Acme logo",
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
