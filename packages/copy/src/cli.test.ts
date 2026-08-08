import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

// Hermetic: every test operates on its own pair of `mkdtemp` directories
// (a real record.json file's directory, plus a scan directory), removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process. Nothing here touches this repository's
// own source or the network.

let recordDir: string;
let scanDir: string;

const validRecord = {
  id: "test-record",
  entries: [{ id: "pagination.no-results", text: "No results", context: "Pagination — empty state" }],
};

function writeRecord(value: unknown): string {
  const path = join(recordDir, "copy.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

beforeEach(() => {
  recordDir = mkdtempSync(join(tmpdir(), "copy-cli-record-"));
  scanDir = mkdtempSync(join(tmpdir(), "copy-cli-scan-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(recordDir, { recursive: true, force: true });
  rmSync(scanDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when record-file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const recordFile = writeRecord(validRecord);
    expect(() => main([recordFile, scanDir, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when record-file does not exist", () => {
    expect(() => main([join(recordDir, "does-not-exist.json"), scanDir])).toThrow(CliInputError);
  });

  it("throws CliInputError when record-file is a directory, not a file", () => {
    expect(() => main([recordDir, scanDir])).toThrow(CliInputError);
  });

  it("throws CliInputError when scan-dir does not exist", () => {
    const recordFile = writeRecord(validRecord);
    expect(() => main([recordFile, join(scanDir, "nope")])).toThrow(CliInputError);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when the record file does not parse as JSON (never a silent pass)", () => {
    const recordFile = join(recordDir, "copy.json");
    writeFileSync(recordFile, "{ not json");
    writeFileSync(join(scanDir, "about.ts"), 'const x = "irrelevant";\n');
    expect(main([recordFile, scanDir])).toBe(2);
  });

  it("returns 2 when the record fails schema validation (e.g. missing required fields)", () => {
    const recordFile = writeRecord({ id: "test", entries: [{ text: "No id or context" }] });
    writeFileSync(join(scanDir, "about.ts"), 'const x = "irrelevant";\n');
    expect(main([recordFile, scanDir])).toBe(2);
  });

  it("returns 2 when zero files match the scan (never reported as a clean pass)", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "data.json"), "{}"); // .json is not a scanned extension
    expect(main([recordFile, scanDir])).toBe(2);
  });

  it("returns 2 when every matched file fails to parse (matched, but nothing was actually scanned)", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "broken.ts"), 'const broken = "never closed\nconst x = 1;\n');
    expect(main([recordFile, scanDir])).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 0 on a clean pass", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "No results";\n');
    expect(main([recordFile, scanDir])).toBe(0);
  });

  it("returns 1 when a finding is present", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "Totally unregistered copy";\n');
    expect(main([recordFile, scanDir])).toBe(1);
  });

  it("a registered entry plus an unregistered one still returns 1 (any finding fails the run)", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(
      join(scanDir, "about.ts"),
      'const a = "No results";\nconst b = "Not in the record";\n',
    );
    expect(main([recordFile, scanDir])).toBe(1);
  });

  it("a copy-gate:ignore marker keeps an unregistered candidate from failing the run", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(
      join(scanDir, "about.ts"),
      'const a = "No results";\nconst b = "Not yet registered"; // copy-gate:ignore\n',
    );
    expect(main([recordFile, scanDir])).toBe(0);
  });

  it("excluded literals (className, aria-label, import specifiers, ...) never leak into findings", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(
      join(scanDir, "about.ts"),
      [
        'import type { CSSProperties } from "react";',
        'const rangeSummary = "No results";',
        '<Button aria-label="Previous page" className="flex items-center" />;',
      ].join("\n"),
    );
    expect(main([recordFile, scanDir])).toBe(0);
  });
});

describe("main — JSX text nodes (issue #37)", () => {
  it("reproduces issue #37's exact repro: a .tsx file that is nothing but unregistered JSX text now returns 1, not a silent 0", () => {
    const recordFile = writeRecord({ id: "t", entries: [] });
    writeFileSync(join(scanDir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    expect(main([recordFile, scanDir])).toBe(1);
  });

  it("a registered JSX text node returns 0", () => {
    const recordFile = writeRecord({
      id: "t",
      entries: [{ id: "widget.no-results", text: "No results found", context: "Widget — empty state" }],
    });
    writeFileSync(join(scanDir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    expect(main([recordFile, scanDir])).toBe(0);
  });

  it("a copy:<id> citation traces a JSX text node exactly like a string literal", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(
      join(scanDir, "Widget.tsx"),
      "export const Widget = () => <p>Ad-hoc phrasing</p>; // copy:pagination.no-results\n",
    );
    expect(main([recordFile, scanDir])).toBe(0);
  });

  it("a non-empty `unchecked` list returns 2, even with zero traceability findings — 'could not check' is never a silent pass", () => {
    const recordFile = writeRecord(validRecord);
    // Unclosed JSX element — a real construct the scanner cannot fully
    // resolve, not a bad-input error.
    writeFileSync(join(scanDir, "Widget.tsx"), "export const Widget = () => <div>\n  <p>No results</p>\n");
    const errorSpy = vi.spyOn(console, "error");
    expect(main([recordFile, scanDir])).toBe(2);
    const printed = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/unclosed-jsx-element/);
  });

  it("unchecked wins over 0 even when the only real candidate traces cleanly", () => {
    const recordFile = writeRecord({
      id: "t",
      entries: [{ id: "widget.hello", text: "Hello", context: "Widget" }],
    });
    writeFileSync(join(scanDir, "Widget.tsx"), "export const Widget = () => <div>\n  <p>Hello</p>\n");
    expect(main([recordFile, scanDir])).toBe(2);
  });
});
