import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkBrandMark } from "./check-brand-mark.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturesDir = join(packageRoot, "templates", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("checkBrandMark", () => {
  it("passes the shipped complete fixture with all three variants", () => {
    const report = checkBrandMark("brand-mark-complete.tsx", fixture("brand-mark-complete.tsx"));
    expect(report.lockupAuthored).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("passes an unfilled template copy (wordmark still placeholder)", () => {
    const report = checkBrandMark("mark-template.tsx", fixture("../mark-template.tsx"));
    expect(report.lockupAuthored).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("fails when a lockup is authored but the inverse variant is omitted", () => {
    const report = checkBrandMark("brand-mark-missing-inverse.tsx", fixture("brand-mark-missing-inverse.tsx"));
    expect(report.lockupAuthored).toBe(true);
    expect(report.findings.some((f) => f.rule === "mark:missing-inverse-variant")).toBe(true);
  });

  it("fails when inverse export exists but drops inverse surface/ink tokens", () => {
    const source = fixture("brand-mark-complete.tsx").replace(
      "bg-surface-inverse",
      "bg-surface-base",
    );
    const report = checkBrandMark("stub.tsx", source);
    expect(report.findings.some((f) => f.rule === "mark:missing-inverse-variant")).toBe(true);
  });
});
