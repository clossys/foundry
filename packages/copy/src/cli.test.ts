import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  // REGRESSION (#256). The check above only ever fired when EVERY file
  // failed, because it keys off `filesScanned === 0`. A single unparseable
  // file alongside clean ones left `filesScanned > 0` and dropped out of
  // the exit-code decision entirely: the run reported on what it could read
  // and returned 0, as though the file it never opened had been checked and
  // found clean. The unparseable file could contain any amount of
  // unregistered copy; nobody knows, which is the definition of
  // indeterminate.
  it("returns 2 when SOME matched files fail to parse, even though others scanned cleanly", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "No results";\n');
    writeFileSync(join(scanDir, "broken.ts"), 'const broken = "never closed\nconst x = 1;\n');
    expect(main([recordFile, scanDir])).toBe(2);
  });

  it("a partial parse failure outranks a real finding — 2, not the 1 the readable file alone would give", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "about.ts"), 'const headline = "Totally unregistered copy";\n');
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

// -----------------------------------------------------------------------
// voice-derivation-coverage — the second subcommand. Same hermetic-mkdtemp
// discipline as the tests above: real files on disk, `main(argv)` called
// directly, nothing spawned.
//
// Both files are plain JSON arrays of non-empty strings — obligations and
// brandDerivedRuleIds — matching `checkVoiceDerivationCoverage`'s own
// signature. This CLI does not read a VoiceRecord at all any more: see
// `derivation-coverage.ts`'s top-of-file doc comment for why the package
// cannot derive a brand-derived rule-id list from a record itself.
// -----------------------------------------------------------------------

function writeObligations(value: unknown): string {
  const path = join(recordDir, "obligations.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function writeBrandDerivedRuleIds(value: unknown): string {
  const path = join(recordDir, "brand-derived-rule-ids.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("main — voice-derivation-coverage — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["voice-derivation-coverage", "--help"])).toBe(0);
  });

  it("throws CliInputError when obligations-file is missing", () => {
    expect(() => main(["voice-derivation-coverage"])).toThrow(CliInputError);
  });

  it("throws CliInputError when brand-derived-rule-ids-file is missing", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    expect(() => main(["voice-derivation-coverage", obligationsFile])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(() =>
      main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile, "--bogus"]),
    ).toThrow(CliInputError);
  });

  it("throws CliInputError when obligations-file does not exist", () => {
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(() =>
      main(["voice-derivation-coverage", join(recordDir, "nope.json"), brandDerivedRuleIdsFile]),
    ).toThrow(CliInputError);
  });

  it("throws CliInputError when brand-derived-rule-ids-file does not exist", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    expect(() =>
      main(["voice-derivation-coverage", obligationsFile, join(recordDir, "nope.json")]),
    ).toThrow(CliInputError);
  });
});

describe("main — voice-derivation-coverage — the third state: could not run", () => {
  it("returns 2 when obligations-file does not parse as JSON", () => {
    const obligationsFile = join(recordDir, "obligations.json");
    writeFileSync(obligationsFile, "{ not json");
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });

  it("returns 2 when obligations-file is not an array of strings", () => {
    const obligationsFile = writeObligations({ not: "an array" });
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });

  it("returns 2 when brand-derived-rule-ids-file does not parse as JSON", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    const brandDerivedRuleIdsFile = join(recordDir, "brand-derived-rule-ids.json");
    writeFileSync(brandDerivedRuleIdsFile, "{ not json");
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });

  it("returns 2 when brand-derived-rule-ids-file is not an array of strings", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds({ not: "an array" });
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });

  it("returns 2 when zero obligations are supplied, even against real brand-derived rule ids — never a silent pass", () => {
    const obligationsFile = writeObligations([]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });

  it("returns 2 for an empty brand-derived-rule-ids-file, even against real obligations", () => {
    const obligationsFile = writeObligations(["plainspoken"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds([]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(2);
  });
});

describe("main — voice-derivation-coverage — real runs", () => {
  it("returns 0 when every obligation resolves and every brand-derived rule id is obliged", () => {
    const obligationsFile = writeObligations(["revolutionary", "fast-sync"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(0);
  });

  it("returns 1 when an obligation names a rule id not in the supplied brand-derived list", () => {
    const obligationsFile = writeObligations(["revolutionary", "fast-sync", "plainspoken"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(1);
  });

  it("returns 1 when a supplied brand-derived rule id is reached by no obligation (direction 2)", () => {
    const obligationsFile = writeObligations(["revolutionary"]);
    const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
    expect(main(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile])).toBe(1);
  });
});

// -----------------------------------------------------------------------
// Direct-path reachability: spawn the REAL compiled dist/cli.js, not the
// exported main() this whole file otherwise calls directly.
//
// Every test above calls `main(argv)` in-process — that proves the argv-
// to-exit-code CONTRACT, but it never proves the compiled binary this
// package actually SHIPS (`bin.copy-check` -> `dist/cli.js`) reaches the
// same code path. `detectMainModule()` (cli.ts) gates `run()` on a
// real-path comparison between `process.argv[1]` and this module's own
// compiled location — that comparison, and the `argv[0] ===
// "voice-derivation-coverage"` dispatch above it, only ever run for real
// when this file is invoked exactly the way it ships: `node
// <installed-path>/dist/cli.js <args>`, where `process.argv[1]`'s basename
// is always literally `cli.js`. A name-dispatch design keyed off
// `basename(process.argv[1])` would therefore be unreachable in exactly
// this shipped form and would silently run the wrong command — which is
// why this package dispatches on `argv[0]` instead, and why this is the
// one place in this test file that proves it by actually shipping and
// running the binary, not merely calling the function it wraps.
//
// "Did not throw" would prove nothing here: Node's own uncaught-exception
// default also exits 1, the identical code a real coverage violation uses.
// Every assertion below reads the real, captured exit `status` from a
// real child process — never through a pipe (`cmd | tail` reports the
// pipe's own exit status, not the spawned command's).
// -----------------------------------------------------------------------

describe("main — direct-path reachability (real compiled dist/cli.js)", () => {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let cliPath: string;

  beforeAll(() => {
    // Build once for this whole describe block — a real `tsc` compile of
    // this package, not a mock. Slower than the in-process tests above by
    // design: this block exists specifically to exercise the artifact this
    // package ships, not a faster proxy for it.
    execFileSync("npm", ["run", "build"], { cwd: packageDir, stdio: "pipe" });
    cliPath = join(packageDir, "dist", "cli.js");
  }, 120_000);

  /**
   * Runs the real compiled CLI as a child process and returns its actual
   * exit code, never inferring one from whether `execFileSync` threw.
   * `execFileSync` throws on any non-zero exit, so a bare try/catch would
   * conflate "exited 1" and "exited 2" and "the child process itself
   * crashed before ever calling `process.exit`" into the same caught
   * branch — this instead reads `error.status`, the real code the child
   * process exited with, straight off the thrown error.
   */
  function runCompiledCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status: number | null; stdout?: string; stderr?: string };
      return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it(
    "voice-derivation-coverage: real exit 0 on a satisfied run",
    () => {
      const obligationsFile = writeObligations(["revolutionary", "fast-sync"]);
      const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
      const result = runCompiledCli(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/satisfied/);
    },
    20_000,
  );

  it(
    "voice-derivation-coverage: real exit 1 on a genuine coverage gap (direction 2)",
    () => {
      const obligationsFile = writeObligations(["revolutionary"]);
      const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds(["revolutionary", "fast-sync"]);
      const result = runCompiledCli(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile]);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/violated/);
    },
    20_000,
  );

  it(
    "voice-derivation-coverage: real exit 2 when brand-derived-rule-ids-file is empty (indeterminate, never a vacuous pass)",
    () => {
      const obligationsFile = writeObligations(["revolutionary"]);
      const brandDerivedRuleIdsFile = writeBrandDerivedRuleIds([]);
      const result = runCompiledCli(["voice-derivation-coverage", obligationsFile, brandDerivedRuleIdsFile]);
      expect(result.status).toBe(2);
      expect(result.stdout).toMatch(/indeterminate/);
    },
    20_000,
  );

  it(
    "no-subcommand path still runs the existing copy check unchanged: real exit 0 on a clean pass",
    () => {
      const recordFile = writeRecord(validRecord);
      writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "No results";\n');
      const result = runCompiledCli([recordFile, scanDir]);
      expect(result.status).toBe(0);
    },
    20_000,
  );

  it(
    "no-subcommand path still runs the existing copy check unchanged: real exit 1 on a real finding",
    () => {
      const recordFile = writeRecord(validRecord);
      writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "Totally unregistered copy";\n');
      const result = runCompiledCli([recordFile, scanDir]);
      expect(result.status).toBe(1);
    },
    20_000,
  );
});
