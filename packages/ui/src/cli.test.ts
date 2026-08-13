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
// token registry comes from the real local token-layer import
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

// Reproduces the reported defect directly: without --tokens, a literal is
// unconditionally CLASSIFIED against this package's OWN registry — every
// legitimate, consumer-token-backed literal is reported as
// raw-value-no-token-backing (an unbacked literal) rather than
// hardcodes-token-value (a literal that duplicates a REAL token's value)
// with no way to tell the gate which registry actually governs it.
//
// A bare literal is never a CLEAN pass in this gate's design — even one
// that matches a real token's value is still an error, "read it via var()
// instead of the literal" — so --tokens cannot flip these to exit 0. What
// it changes is WHICH finding fires and what its message says, which is
// exactly what #150 (registryLabel) makes visible: these assert on the
// actual logged message, not just the exit code, via the console.log spy
// installed in beforeEach.
describe("main — --tokens (a consumer's own registry, not this package's)", () => {
  function loggedText(): string {
    return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join("\n");
  }

  it("without --tokens: an arbitrary literal is raw-value-no-token-backing against this package's own registry", () => {
    writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#123456";\n');
    expect(main([scanDir])).toBe(1);
    expect(loggedText()).toContain('no matching entry in the "@vespeneventures/ui/tokens" TOKENS registry');
  });

  it("...but is hardcodes-token-value, attributed to the SUPPLIED registry, once --tokens actually backs that value", () => {
    writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#123456";\n');
    const tokensPath = join(scanDir, "consumer-tokens.json");
    writeFileSync(
      tokensPath,
      JSON.stringify({
        "--consumer-brand": { property: "--consumer-brand", family: "color", value: "#123456" },
      }),
    );
    expect(main([scanDir, "--tokens", tokensPath])).toBe(1); // still a finding — a bare literal always is
    const out = loggedText();
    expect(out).toContain("hardcodes-token-value");
    expect(out).toContain("--consumer-brand"); // matched against the SUPPLIED registry's token, not this package's
  });

  it("--tokens REPLACES the default registry rather than merging with it — a value this package's own TOKENS would back is reported as UNBACKED once a consumer-only registry is supplied instead", () => {
    // A real value from this package's own registry (spacing-lg's 16px, per
    // token-gate.ts's own doc comments): if --tokens merged instead of
    // replacing, this would still resolve via this package's own TOKENS and
    // report "hardcodes-token-value" against "--spacing-lg" — the bug this
    // test exists to catch. Correct (replace) behavior reports it as
    // unbacked against the consumer-only registry instead.
    writeFileSync(join(scanDir, "about.ts"), 'export const GAP = "16px";\n');
    const tokensPath = join(scanDir, "consumer-tokens.json");
    writeFileSync(
      tokensPath,
      JSON.stringify({ "--consumer-only": { property: "--consumer-only", family: "spacing", value: "9px" } }),
    );
    expect(main([scanDir, "--tokens", tokensPath])).toBe(1);
    const out = loggedText();
    expect(out).toContain("raw-value-no-token-backing");
    expect(out).not.toContain("--spacing-lg");
  });

  it("--tokens requires a path argument", () => {
    expect(() => main([scanDir, "--tokens"])).toThrow(CliInputError);
  });

  it("throws CliInputError when the --tokens file does not exist", () => {
    expect(() => main([scanDir, "--tokens", join(scanDir, "nope.json")])).toThrow(CliInputError);
  });

  it("throws CliInputError when the --tokens file is not valid JSON", () => {
    const tokensPath = join(scanDir, "bad.json");
    writeFileSync(tokensPath, "{ not json");
    expect(() => main([scanDir, "--tokens", tokensPath])).toThrow(CliInputError);
  });

  it("throws CliInputError when a --tokens entry is missing required fields — fails closed rather than scanning against a partial registry", () => {
    const tokensPath = join(scanDir, "bad-entry.json");
    writeFileSync(tokensPath, JSON.stringify({ "--broken": { property: "--broken" /* no value */ } }));
    writeFileSync(join(scanDir, "about.ts"), 'export const BRAND = "#123456";\n');
    expect(() => main([scanDir, "--tokens", tokensPath])).toThrow(CliInputError);
  });
});
