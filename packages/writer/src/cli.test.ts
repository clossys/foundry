import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main, mainAddressabilityCheck } from "./cli.js";

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

/** Wraps fixture copy as a CopyRegistry — writer-check now requires the render store shape. */
function toRegistryFixture(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  if (obj.locale !== undefined) return value;
  const entries = Array.isArray(obj.entries) ? obj.entries : [];
  return {
    id: obj.id ?? "test-record",
    locale: "en",
    revision: "rev-1",
    source: { kind: "consumer", reference: "test-fixture" },
    entries: entries.map((entry) => {
      if (typeof entry === "object" && entry !== null && !("status" in entry)) {
        return { ...entry, status: "approved" };
      }
      return entry;
    }),
  };
}

function writeRecord(value: unknown): string {
  const path = join(recordDir, "copy.json");
  writeFileSync(path, JSON.stringify(toRegistryFixture(value)));
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

describe("main — render registry and treatment budgets", () => {
  it("returns 2 when record-file is only a CopyRecord, not a CopyRegistry", () => {
    const path = join(recordDir, "plain.json");
    writeFileSync(path, JSON.stringify(validRecord));
    writeFileSync(join(scanDir, "Widget.tsx"), 'const x = "registered text";\n');
    expect(main([path, scanDir])).toBe(2);
  });

  it("returns 2 when --render-registry points at a different file than record-file", () => {
    const primary = writeRecord(validRecord);
    const other = join(recordDir, "other.json");
    writeFileSync(other, JSON.stringify(toRegistryFixture({ id: "other", entries: validRecord.entries })));
    writeFileSync(join(scanDir, "Widget.tsx"), 'const x = "No results";\n');
    expect(main([primary, scanDir, "--render-registry", other])).toBe(2);
  });

  it("returns 1 when an approved treatment entry exceeds its word budget", () => {
    const recordFile = writeRecord({
      id: "t",
      entries: [
        {
          id: "hero.title",
          text: "one two three four five six seven eight nine ten eleven",
          context: "Hero",
          treatment: "button",
        },
      ],
    });
    writeFileSync(join(scanDir, "Widget.tsx"), 'const x = "No results";\n');
    expect(main([recordFile, scanDir])).toBe(1);
  });
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
// Issue #753: a `//`/`/* */` JSX comment between an element's attributes
// used to be unclassifiable (see scan.test.ts's own "issue #753" describe
// block for the unit-level repro/fix). These are the CLI-level
// regressions: (1) the previously-broken construct now runs to a real
// 0/1 verdict instead of the indeterminate 2 it used to force; (2) real
// findings produced alongside a DIFFERENT, genuinely-unclassifiable
// construct are no longer silently discarded — `--format json` carries
// them even though the run is still, correctly, exit 2; and (3) a
// genuinely unclassifiable construct is STILL reported as indeterminate,
// never silently dropped or read as clean, in both text and json modes —
// this fix narrows what counts as unclassifiable, it does not widen what
// counts as valid JSX.
// -----------------------------------------------------------------------
describe("main — JSX comment trivia between attributes (issue #753)", () => {
  const faqWithCommentBetweenAttrs = (childText: string): string =>
    "export function Page() {\n" +
    "  return (\n" +
    "    <div>\n" +
    "      <Faq\n" +
    "        // TODO: verify copy before ship\n" +
    "        items={data}\n" +
    "      >\n" +
    `        <span>${childText}</span>\n` +
    "      </Faq>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n";

  it("the previously-unclassifiable construct no longer forces exit 2 — a registered child now returns a real 0", () => {
    const recordFile = writeRecord({
      id: "t",
      entries: [{ id: "faq.hello", text: "Hello world", context: "Faq" }],
    });
    writeFileSync(join(scanDir, "Page.tsx"), faqWithCommentBetweenAttrs("Hello world"));
    expect(main([recordFile, scanDir])).toBe(0);
  });

  it("the previously-unclassifiable construct now surfaces its child copy as a real finding (1), not an indeterminate 2", () => {
    const recordFile = writeRecord({ id: "t", entries: [] });
    writeFileSync(join(scanDir, "Page.tsx"), faqWithCommentBetweenAttrs("Totally unregistered copy"));
    const logSpy = vi.spyOn(console, "log");
    expect(main([recordFile, scanDir])).toBe(1);
    const printed = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/Totally unregistered copy/);
    expect(printed).not.toMatch(/unrecognized-jsx-child/);
  });

  it("findings are no longer discarded when a DIFFERENT construct in the same scan is genuinely unclassifiable — --format json still carries every finding under exit 2", () => {
    const recordFile = writeRecord({ id: "t", entries: [] });
    // Clean file: real, traceable findings the old behavior's exit code
    // alone would make unreachable to a machine consumer.
    writeFileSync(
      join(scanDir, "About.tsx"),
      'export const About = () => <p>First unregistered finding</p>;\nexport const Sub = () => <p>Second unregistered finding</p>;\n',
    );
    // A genuinely unclassifiable construct — unrelated to comments,
    // untouched by this fix — an unclosed attribute expression. A
    // single-line, top-level (non-nested) element on purpose: it fails
    // BEFORE any child text is ever reached, so it contributes zero
    // incidental candidates of its own — the only two findings below are
    // the real ones from About.tsx.
    writeFileSync(join(scanDir, "Broken.tsx"), "export const Broken = () => <div attr={oops>Text</div>;\n");

    const logSpy = vi.spyOn(console, "log");
    const exitCode = main([recordFile, scanDir, "--format", "json"]);
    expect(exitCode).toBe(2); // unchecked still wins — an indeterminate result must never read as clean

    expect(logSpy.mock.calls).toHaveLength(1); // exactly one JSON object, nothing else, on stdout
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
    // The two real findings from About.tsx survive in the structured
    // report even though the overall run is indeterminate — this is the
    // exact discard #753 reported (292 findings lost to one unchecked
    // construct), reproduced here at n=2 and proven fixed.
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f: { message: string }) => f.message).join("\n")).toMatch(/First unregistered finding/);
    expect(report.findings.map((f: { message: string }) => f.message).join("\n")).toMatch(/Second unregistered finding/);
    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0].kind).toBe("malformed-jsx-tag");
  });

  it("a genuinely unclassifiable construct (no comments involved) is STILL reported as indeterminate — never silently dropped, never counted clean, in --format json exactly as in text mode", () => {
    const recordFile = writeRecord({ id: "t", entries: [] });
    writeFileSync(join(scanDir, "Broken.tsx"), "export const Broken = () => <div attr={oops>Text</div>;\n");

    const logSpy = vi.spyOn(console, "log");
    const exitCode = main([recordFile, scanDir, "--format", "json"]);
    expect(exitCode).toBe(2);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.verdict).toBe("indeterminate"); // never "clean" — zero findings must not be conflated with "nothing wrong"
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toHaveLength(1);
  });

  it("--format json on a genuinely clean run reports verdict \"clean\", not merely a bare 0", () => {
    const recordFile = writeRecord(validRecord);
    writeFileSync(join(scanDir, "about.ts"), 'const rangeSummary = "No results";\n');
    const logSpy = vi.spyOn(console, "log");
    expect(main([recordFile, scanDir, "--format", "json"])).toBe(0);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.verdict).toBe("clean");
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([]);
  });

  it("--format json on a record-load failure still reports indeterminate with a reason, and prints nothing else", () => {
    const recordFile = join(recordDir, "copy.json");
    writeFileSync(recordFile, "{ not json");
    writeFileSync(join(scanDir, "about.ts"), 'const x = "irrelevant";\n');
    const logSpy = vi.spyOn(console, "log");
    expect(main([recordFile, scanDir, "--format", "json"])).toBe(2);
    expect(logSpy.mock.calls).toHaveLength(1);
    const report = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(report.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
    expect(typeof report.reason).toBe("string");
    expect(report.reason.length).toBeGreaterThan(0);
  });

  it("--format bogus is rejected as a CliInputError, exactly like an unknown flag", () => {
    const recordFile = writeRecord(validRecord);
    expect(() => main([recordFile, scanDir, "--format", "bogus"])).toThrow(CliInputError);
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

describe("main — live-copy trees", () => {
  const voiceRecord = {
    id: "acme-app",
    rules: {
      person: { description: "second-person", forbiddenPronouns: [] },
      tense: { description: "present", forbiddenMarkers: [] },
      formality: "neutral",
      tone: [],
    },
    glossary: [],
    claims: [{ id: "growth", text: "placeholder claim", matchPhrases: [], requiresSupport: true }],
  };

  function writeVoiceRecord(): string {
    const path = join(recordDir, "voice.json");
    writeFileSync(path, JSON.stringify(voiceRecord));
    return path;
  }

  it("returns 2 when a declared live tree is missing", () => {
    const recordFile = writeRecord(validRecord);
    const voiceFile = writeVoiceRecord();
    writeFileSync(join(scanDir, "page.ts"), 'const title = "No results";\n');
    expect(main([recordFile, scanDir, "--live", join(scanDir, "missing-live"), "--voice-record", voiceFile])).toBe(2);
  });

  it("returns 1 when live copy contains unmarked magnitude", () => {
    const recordFile = writeRecord(validRecord);
    const voiceFile = writeVoiceRecord();
    const liveDir = mkdtempSync(join(tmpdir(), "copy-cli-live-"));
    writeFileSync(join(liveDir, "hero.tsx"), 'export const tag = "Save 50% today";\n');
    writeFileSync(join(scanDir, "registry.ts"), 'const title = "No results";\n');
    expect(main([recordFile, scanDir, "--live", liveDir, "--voice-record", voiceFile])).toBe(1);
    rmSync(liveDir, { recursive: true, force: true });
  });

  it("returns 1 when live copy contains fold wallpaper", () => {
    const recordFile = writeRecord(validRecord);
    const voiceFile = writeVoiceRecord();
    const liveDir = mkdtempSync(join(tmpdir(), "copy-cli-live-"));
    writeFileSync(join(liveDir, "hero.tsx"), 'export const headline = "AI intelligence for your workflow";\n');
    writeFileSync(join(scanDir, "registry.ts"), 'const title = "No results";\n');
    expect(main([recordFile, scanDir, "--live", liveDir, "--voice-record", voiceFile])).toBe(1);
    rmSync(liveDir, { recursive: true, force: true });
  });

  it("returns 0 on live copy without wallpaper when registry scan is clean", () => {
    const recordFile = writeRecord(validRecord);
    const voiceFile = writeVoiceRecord();
    const liveDir = mkdtempSync(join(tmpdir(), "copy-cli-live-"));
    writeFileSync(join(liveDir, "hero.tsx"), 'export const headline = "Ship the release you approved";\n');
    writeFileSync(join(scanDir, "registry.ts"), 'const title = "No results";\n');
    expect(main([recordFile, scanDir, "--live", liveDir, "--voice-record", voiceFile])).toBe(0);
    rmSync(liveDir, { recursive: true, force: true });
  });
});

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
// locale-coverage — the third subcommand. Same hermetic-mkdtemp discipline
// as the sections above: real files on disk, `main(argv)` called directly,
// nothing spawned. `registriesFile` is a plain JSON object mapping each
// locale to its CopyRegistry, matching `checkLocaleCoverage`'s own
// `Readonly<Record<CopyLocale, unknown>>` signature.
// -----------------------------------------------------------------------

// A deliberately KNOWN-GOOD pair of locale registries — "en" (source) and
// "fr" (target) cover the exact same two entry ids, with real, correct
// translations. Obviously-fictional fixtures only, matching
// locale-coverage.test.ts's own "Acme" convention. Never real copy.
function validRegistries(): Record<string, unknown> {
  return {
    en: {
      id: "acme-app",
      locale: "en",
      revision: "2026-08-01",
      source: { kind: "consumer", reference: "editorial/revisions/1" },
      entries: [
        { id: "pagination.no-results", text: "No results found.", context: "search results page", status: "approved" },
        { id: "dashboard.welcome", text: "Welcome back.", context: "dashboard header", status: "approved" },
      ],
    },
    fr: {
      id: "acme-app",
      locale: "fr",
      revision: "2026-08-01",
      source: { kind: "consumer", reference: "editorial/revisions/1" },
      entries: [
        { id: "pagination.no-results", text: "Aucun résultat trouvé.", context: "search results page", status: "approved" },
        { id: "dashboard.welcome", text: "Content de vous revoir.", context: "dashboard header", status: "approved" },
      ],
    },
  };
}

function writeRegistries(value: unknown): string {
  const path = join(recordDir, "registries.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("main — locale-coverage — argument handling", () => {
  it("--help returns 0 without touching either path", () => {
    expect(main(["locale-coverage", "--help"])).toBe(0);
  });

  it("throws CliInputError when registries-file is missing", () => {
    expect(() => main(["locale-coverage"])).toThrow(CliInputError);
  });

  it("throws CliInputError when source-locale is missing", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(() => main(["locale-coverage", registriesFile])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(() => main(["locale-coverage", registriesFile, "en", "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError when registries-file does not exist", () => {
    expect(() => main(["locale-coverage", join(recordDir, "nope.json"), "en"])).toThrow(CliInputError);
  });
});

describe("main — locale-coverage — the third state: could not run", () => {
  it("returns 2 when registries-file does not parse as JSON (never a silent pass)", () => {
    const registriesFile = join(recordDir, "registries.json");
    writeFileSync(registriesFile, "{ not json");
    expect(main(["locale-coverage", registriesFile, "en"])).toBe(2);
  });

  it("returns 2 when registries-file is a JSON array, not an object", () => {
    const registriesFile = writeRegistries(["en", "fr"]);
    expect(main(["locale-coverage", registriesFile, "en"])).toBe(2);
  });

  it("returns 2 when registries-file is a JSON primitive, not an object", () => {
    const registriesFile = writeRegistries("en");
    expect(main(["locale-coverage", registriesFile, "en"])).toBe(2);
  });

  it("returns 2 when zero declared locales result (empty registries-file, no explicit declared-locale args) — checked nothing must never be 0", () => {
    const registriesFile = writeRegistries({});
    expect(main(["locale-coverage", registriesFile, "en"])).toBe(2);
  });

  it("returns 2 when source-locale is not among the (defaulted) declared locales at all", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(main(["locale-coverage", registriesFile, "de"])).toBe(2);
  });

  it("returns 2 when an explicitly declared locale has no registry in registries-file — a declared-but-entirely-absent target locale", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(main(["locale-coverage", registriesFile, "en", "en", "fr", "de"])).toBe(2);
  });
});

describe("main — locale-coverage — real runs", () => {
  it("returns 0 on a genuinely clean pass across matching locales (declared-locale defaults to the registries-file's own keys)", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(main(["locale-coverage", registriesFile, "en"])).toBe(0);
  });

  it("returns 0 with explicit declared-locale args naming exactly the same set", () => {
    const registriesFile = writeRegistries(validRegistries());
    expect(main(["locale-coverage", registriesFile, "en", "en", "fr"])).toBe(0);
  });

  // CONSTRUCTED POSITIVE CONTROL. Start from the same known-good fixture the
  // "returns 0" case above proves is genuinely clean, then perturb it in
  // exactly one way — delete one entry from the TARGET locale ("fr") that
  // the SOURCE locale ("en") still has — and assert the gate reports that
  // SPECIFIC finding kind (`locale-coverage:missing-entry`, naming the
  // exact entry id and locale), not merely "exit code is nonzero." This is
  // what distinguishes the gate actually detecting the perturbation from
  // the test harness itself being broken (e.g. a registries-file that never
  // parsed at all would also exit nonzero, for an entirely different
  // reason).
  it("a constructed missing-entry perturbation is reported by name, and drives exit 1", () => {
    const registries = validRegistries();
    const fr = registries.fr as { entries: Array<{ id: string }> };
    fr.entries = fr.entries.filter((e) => e.id !== "dashboard.welcome");
    const registriesFile = writeRegistries(registries);

    const logSpy = vi.spyOn(console, "log");
    const status = main(["locale-coverage", registriesFile, "en"]);
    expect(status).toBe(1);

    const printed = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/locale-coverage:missing-entry/);
    expect(printed).toMatch(/dashboard\.welcome/);
    expect(printed).toMatch(/fr/);
  });

  it("an orphaned-entry-only perturbation (warning severity) still returns 0 — a warning alone is not an error-severity finding", () => {
    const registries = validRegistries();
    const fr = registries.fr as { entries: Array<{ id: string; text: string; context: string; status: string }> };
    fr.entries = [...fr.entries, { id: "legacy.retired-banner", text: "Bannière retirée.", context: "old banner", status: "approved" }];
    const registriesFile = writeRegistries(registries);

    const status = main(["locale-coverage", registriesFile, "en"]);
    expect(status).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Direct-path reachability: spawn the REAL compiled dist/cli.js, not the
// exported main() this whole file otherwise calls directly.
//
// Every test above calls `main(argv)` in-process — that proves the argv-
// to-exit-code CONTRACT, but it never proves the compiled binary this
// package actually SHIPS (`bin.writer-check` -> `dist/cli.js`) reaches the
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

  it(
    "locale-coverage: real exit 0 on a genuinely clean pass",
    () => {
      const registriesFile = writeRegistries(validRegistries());
      const result = runCompiledCli(["locale-coverage", registriesFile, "en"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Source locale "en"/);
    },
    20_000,
  );

  it(
    "locale-coverage: real exit 1 on the same constructed missing-entry perturbation the in-process suite proves",
    () => {
      const registries = validRegistries();
      const fr = registries.fr as { entries: Array<{ id: string }> };
      fr.entries = fr.entries.filter((e) => e.id !== "dashboard.welcome");
      const registriesFile = writeRegistries(registries);

      const result = runCompiledCli(["locale-coverage", registriesFile, "en"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/locale-coverage:missing-entry/);
      expect(result.stdout).toMatch(/dashboard\.welcome/);
    },
    20_000,
  );

  it(
    "locale-coverage: real exit 2 when registries-file is empty and nothing was declared — checked nothing must never be 0",
    () => {
      const registriesFile = writeRegistries({});
      const result = runCompiledCli(["locale-coverage", registriesFile, "en"]);
      expect(result.status).toBe(2);
    },
    20_000,
  );
});

describe("mainAddressabilityCheck — argument handling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "copy-addressability-cli-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("--help returns 0 and documents --extensions", () => {
    expect(mainAddressabilityCheck(["--help"])).toBe(0);
    const printed = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("--extensions");
  });

  it("throws CliInputError when --extensions has no value", () => {
    expect(() => mainAddressabilityCheck(["--extensions"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --extensions omits the leading dot", () => {
    expect(() => mainAddressabilityCheck(["--extensions", "mjs"])).toThrow(CliInputError);
  });

  it("does not scan .mjs by default; --extensions .mjs scans inline user-facing prose", () => {
    writeFileSync(
      join(dir, "Widget.mjs"),
      'export const Widget = () => <input aria-label="Search products" />;\n',
    );
    expect(mainAddressabilityCheck([dir])).toBe(2);
    expect(mainAddressabilityCheck([dir, "--extensions", ".mjs"])).toBe(1);
  });

  it("--extensions accepts a comma-separated list in one flag", () => {
    writeFileSync(
      join(dir, "Widget.mjs"),
      'export const Widget = () => <input aria-label="Search products" />;\n',
    );
    expect(mainAddressabilityCheck([dir, "--extensions", ".cjs,.mjs"])).toBe(1);
  });

  it("--extensions unions repeated flags and comma-separated values", () => {
    writeFileSync(
      join(dir, "Widget.mjs"),
      'export const Widget = () => <input aria-label="Search products" />;\n',
    );
    writeFileSync(
      join(dir, "Other.cjs"),
      'export const Other = () => <input aria-label="Filter results" />;\n',
    );
    expect(
      mainAddressabilityCheck([dir, "--extensions", ".mjs", "--extensions", ".cjs,.jsx"]),
    ).toBe(1);
  });

  it("throws CliInputError (never a vacuous default-set fallback) when --extensions resolves to an empty set", () => {
    expect(() => mainAddressabilityCheck([dir, "--extensions", ","])).toThrow(CliInputError);
    expect(() => mainAddressabilityCheck([dir, "--extensions", ""])).toThrow(CliInputError);
    expect(() => mainAddressabilityCheck([dir, "--extensions", ".mjs,,.cjs"])).toThrow(CliInputError);
  });
});
