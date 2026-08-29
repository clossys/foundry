import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv)` directly rather than
// spawning the real CLI process -- the same discipline
// @example/ledger's and @example/strategy's cli.test.ts use.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "integrator-supersession-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeManifest(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function writeMap(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

const cleanMap = { version: 1, supersededBy: { "legacy-a": { replacement: "replacement-a", since: "1.0.0" } } };

describe("main — argument handling", () => {
  it("--help returns 0 without touching either file", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when manifest-file is missing", () => {
    expect(() => main([])).toThrow(CliInputError);
  });

  it("throws CliInputError when supersession-map-file is missing", () => {
    const manifestPath = writeManifest("package.json", { dependencies: {} });
    expect(() => main([manifestPath])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => main(["--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when manifest-file does not exist", () => {
    const mapPath = writeMap("map.json", cleanMap);
    expect(() => main([join(dir, "missing.json"), mapPath])).toThrow(CliInputError);
  });
});

describe("main — report-only by default", () => {
  it("exits 0 for a genuine conflict when --block is NOT passed", () => {
    const manifestPath = writeManifest("package.json", { dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } });
    const mapPath = writeMap("map.json", cleanMap);
    expect(main([manifestPath, mapPath])).toBe(0);
  });

  it("exits 0 for an indeterminate input (malformed map) when --block is NOT passed", () => {
    const manifestPath = writeManifest("package.json", { dependencies: {} });
    const mapPath = writeMap("map.json", "{ not json");
    expect(main([manifestPath, mapPath])).toBe(0);
  });

  it("still prints the full report (verdict and pair detail) in report-only mode", () => {
    const logSpy = vi.spyOn(console, "log");
    const manifestPath = writeManifest("package.json", { dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } });
    const mapPath = writeMap("map.json", cleanMap);
    main([manifestPath, mapPath]);
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("1 conflicting pair");
    expect(printed).toContain("legacy-a");
    expect(printed).toContain("report-only");
  });
});

describe("main — --block enforces the real result", () => {
  it("exits 0 when no declared pair is installed together", () => {
    const manifestPath = writeManifest("package.json", { dependencies: { "replacement-a": "1.0.0" } });
    const mapPath = writeMap("map.json", cleanMap);
    expect(main([manifestPath, mapPath, "--block"])).toBe(0);
  });

  it("exits 1 when a declared pair is installed together", () => {
    const manifestPath = writeManifest("package.json", { dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } });
    const mapPath = writeMap("map.json", cleanMap);
    expect(main([manifestPath, mapPath, "--block"])).toBe(1);
  });

  it("exits 2 when the manifest is not valid JSON (never a silent clean pass)", () => {
    const manifestPath = writeManifest("package.json", "{ not json");
    const mapPath = writeMap("map.json", cleanMap);
    expect(main([manifestPath, mapPath, "--block"])).toBe(2);
  });

  it("exits 2 when the supersession map is syntactically valid but empty", () => {
    const manifestPath = writeManifest("package.json", { dependencies: {} });
    const mapPath = writeMap("map.json", { version: 1, supersededBy: {} });
    expect(main([manifestPath, mapPath, "--block"])).toBe(2);
  });

  it("flag order does not matter -- --block before the positional arguments still enforces", () => {
    const manifestPath = writeManifest("package.json", { dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } });
    const mapPath = writeMap("map.json", cleanMap);
    expect(main(["--block", manifestPath, mapPath])).toBe(1);
  });
});
