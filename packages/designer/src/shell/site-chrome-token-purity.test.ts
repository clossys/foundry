import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanStyleSources, type StyleScanResult } from "../style-scan.js";
import { checkTokenPurity, type TokenGateResult } from "../token-gate.js";
import { TOKENS } from "../tokens/index.js";

const CHROME_FILES = ["SiteHeader.tsx", "SiteFooter.tsx", "NavShell.tsx"] as const;

describe("site chrome token-purity scan", () => {
  let dir = "";
  let scan: StyleScanResult;
  let gate: TokenGateResult;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "chrome-scan-"));
    for (const file of CHROME_FILES) {
      copyFileSync(join(import.meta.dirname, file), join(dir, file));
    }
    scan = scanStyleSources(dir);
    gate = checkTokenPurity(scan.candidates, TOKENS, scan.filesScanned, scan.unchecked);
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads all three chrome files", { timeout: 60_000 }, () => {
    expect(scan.filesScanned).toBe(CHROME_FILES.length);
  });

  it("reports zero unchecked lines", { timeout: 60_000 }, () => {
    expect(gate.unchecked).toEqual([]);
  });

  it("carries no waiver on any chrome line", { timeout: 60_000 }, () => {
    expect(gate.ignored).toEqual([]);
  });

  it("reports only the three known arbitrary-value findings", { timeout: 60_000 }, () => {
    // The drawer width and the legal row's tap target still need tokens (a token
    // unit's change). Any other finding here is a new hardcoded value in chrome.
    const found = gate.findings.map((f) => `${f.file}: ${f.snippet}`).sort();
    expect(found).toEqual([
      "NavShell.tsx: w-[min(20rem,85vw)]",
      "SiteFooter.tsx: min-h-[44px]",
      "SiteFooter.tsx: min-w-[44px]",
    ]);
  });
});
