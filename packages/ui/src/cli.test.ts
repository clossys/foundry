import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

// Hermetic: every test operates on its own `mkdtemp` scan directory,
// removed afterward, and calls the exported `main(argv)` directly rather
// than spawning the real CLI process — matching @vespeneventures/copy's
// own `cli.test.ts`. Nothing here touches this repository's own source or
// the network. Unlike copy-check, there is no record-file argument: the
// token registry comes from the real `@vespeneventures/tokens` import
// (see cli.ts's own header for why), so every test here scans a real
// temp directory only.

let scanDir: string;

beforeEach(() => {
  scanDir = mkdtempSync(join(tmpdir(), "ui-token-check-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(scanDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without scanning anything", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => main([scanDir, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when scan-dir does not exist", () => {
    expect(() => main([join(scanDir, "nope")])).toThrow(CliInputError);
  });

  it("throws CliInputError on more than one positional argument", () => {
    expect(() => main([scanDir, "extra"])).toThrow(CliInputError);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when zero files match the scan (never reported as a clean pass)", () => {
    writeFileSync(join(scanDir, "data.json"), '{"color":"#3b82f6"}'); // .json is not a scanned extension
    expect(main([scanDir])).toBe(2);
  });

  it("returns 2 when an unchecked construct is present, even with zero findings", () => {
    writeFileSync(join(scanDir, "about.tsx"), "<div className=\"content-['/']\" />;\n");
    expect(main([scanDir])).toBe(2);
  });

  it("returns 2 when an unchecked construct is present ALONGSIDE real findings — unchecked still wins", () => {
    writeFileSync(
      join(scanDir, "about.tsx"),
      "<div className=\"bg-[#3b82f6] content-['/']\" />;\n",
    );
    expect(main([scanDir])).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 0 on a clean pass (only legitimate Tailwind token classes)", () => {
    writeFileSync(join(scanDir, "about.tsx"), '<div className="text-ink-primary bg-surface-base p-4 z-10" />;\n');
    expect(main([scanDir])).toBe(0);
  });

  it("returns 1 when a finding is present (a raw hex color)", () => {
    writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#3b82f6";\n');
    expect(main([scanDir])).toBe(1);
  });

  it("returns 1 when a finding is present (a Tailwind arbitrary-value class)", () => {
    writeFileSync(join(scanDir, "about.tsx"), '<div className="bg-[#3b82f6]" />;\n');
    expect(main([scanDir])).toBe(1);
  });

  it("a token-gate:ignore marker keeps a would-be finding from failing the run", () => {
    writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#3b82f6"; // token-gate:ignore deliberate\n');
    expect(main([scanDir])).toBe(0);
  });

  it("defaults scan-dir to the current working directory when omitted", () => {
    const cwd = process.cwd();
    try {
      process.chdir(scanDir);
      writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#3b82f6";\n');
      expect(main([])).toBe(1);
    } finally {
      process.chdir(cwd);
    }
  });
});
