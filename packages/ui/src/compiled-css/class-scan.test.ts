import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanClassCandidates } from "./class-scan.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ui-class-scan-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scanClassCandidates", () => {
  it("extracts class-shaped tokens from string literals", () => {
    writeFileSync(
      join(dir, "Widget.tsx"),
      `const BASE = "inline-flex items-center rounded-control bg-accent hover:bg-accent-hover";\n` +
        `const SIZE = { sm: "px-sm py-xs", md: "px-md py-sm" };\n`,
    );
    const result = scanClassCandidates(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.candidates).toContain("bg-accent");
    expect(result.candidates).toContain("hover:bg-accent-hover");
    expect(result.candidates).toContain("rounded-control");
    expect(result.candidates).toContain("px-sm");
  });

  it("returns a sorted, deduplicated list", () => {
    writeFileSync(join(dir, "A.tsx"), `"bg-accent bg-accent"`);
    writeFileSync(join(dir, "B.tsx"), `"bg-accent"`);
    const result = scanClassCandidates(dir);
    const occurrences = result.candidates.filter((c) => c === "bg-accent");
    expect(occurrences.length).toBe(1);
    expect(result.candidates).toEqual([...result.candidates].sort());
  });

  it("is over-inclusive but bounded: rejects tokens with disqualifying punctuation, keeps class-shaped ones", () => {
    writeFileSync(
      join(dir, "Widget.tsx"),
      `const s = "var(--ui-ring-focus, 0 0 0 2px)";\n` + // parens/commas — never emitted as a candidate
        `const label = "We'll never share this.";\n` + // prose — "We'll" etc. mostly filtered by shape, "never" and "share" WOULD pass shape (harmless)
        `const real = "text-body";\n`,
    );
    const result = scanClassCandidates(dir);
    expect(result.candidates).toContain("text-body");
    expect(result.candidates.some((c) => c.includes("("))).toBe(false);
    expect(result.candidates.some((c) => c.includes(","))).toBe(false);
  });

  it("skips test, spec, check, and declaration files", () => {
    writeFileSync(join(dir, "Widget.test.tsx"), `"bg-accent"`);
    writeFileSync(join(dir, "Widget.check.tsx"), `"bg-accent"`);
    writeFileSync(join(dir, "Widget.d.ts"), `"bg-accent"`);
    writeFileSync(join(dir, "Real.tsx"), `"text-body"`);
    const result = scanClassCandidates(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.skippedByDesign.map((s) => s.file).sort()).toEqual(["Widget.check.tsx", "Widget.d.ts", "Widget.test.tsx"]);
    expect(result.candidates).not.toContain("bg-accent");
  });

  it("skips an `internal/` subdirectory by default", () => {
    mkdirSync(join(dir, "internal"));
    writeFileSync(join(dir, "internal", "vars.ts"), `"z-index-should-not-appear"`);
    writeFileSync(join(dir, "Real.tsx"), `"text-body"`);
    const result = scanClassCandidates(dir);
    expect(result.candidates).not.toContain("z-index-should-not-appear");
    expect(result.candidates).toContain("text-body");
  });

  it("ignores non-matching extensions", () => {
    writeFileSync(join(dir, "data.json"), `{"class": "bg-accent"}`);
    const result = scanClassCandidates(dir);
    expect(result.filesScanned).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it("fails closed (throws) on an unreadable root directory", () => {
    expect(() => scanClassCandidates(join(dir, "does-not-exist"))).toThrow();
  });
});
