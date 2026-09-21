import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPreAuthMarketingSurface } from "./check-pre-auth-marketing-surface.js";

const fixturePath = fileURLToPath(new URL("./fixtures/pre-auth-marketing.surface.json", import.meta.url));

describe("checkPreAuthMarketingSurface", () => {
  it("accepts the shipped pre-auth marketing fixture", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(checkPreAuthMarketingSurface(doc)).toEqual({ ok: true, findings: [] });
  });

  it("refuses SectionedView as the pre-auth template", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    doc.template = "SectionedView";
    const report = checkPreAuthMarketingSurface(doc);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "sectioned-view-not-pre-auth")).toBe(true);
  });

  it("refuses a MarketingView document missing heroActions", () => {
    const doc = JSON.parse(readFileSync(fixturePath, "utf8"));
    doc.bindings = doc.bindings.filter((b: { slot: string }) => b.slot !== "heroActions");
    const report = checkPreAuthMarketingSurface(doc);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "hero-actions-missing")).toBe(true);
  });
});
