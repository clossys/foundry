import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAddressability,
  extractAddressabilityCandidates,
  scanAddressabilitySources,
  type AddressabilityGateResult,
  type AddressabilityScanResult,
} from "./addressability.js";
import { mainAddressabilityCheck } from "./cli.js";

// Hermetic: every test operates on its own in-memory source string (for
// extractAddressabilityCandidates, which does zero I/O) or its own
// mkdtemp directory (for scanAddressabilitySources/mainAddressabilityCheck).
// Nothing here scans this repository's own source.

/**
 * Wraps `extractAddressabilityCandidates`'s output into a full
 * `AddressabilityScanResult` (as if exactly one file were scanned) and
 * runs it through `checkAddressability` — the same two-step pipeline
 * `scanAddressabilitySources` performs for a whole tree, exercised here
 * against a single in-memory fixture.
 */
function checkSource(content: string, file = "Component.tsx"): AddressabilityGateResult {
  const extracted = extractAddressabilityCandidates(content, file);
  const scan: AddressabilityScanResult = {
    filesScanned: extracted.parseFailure ? 0 : 1,
    violations: extracted.violations,
    unchecked: extracted.unchecked,
    skippedByDesign: [],
    parseFailures: extracted.parseFailure ? [{ file, detail: extracted.parseFailure }] : [],
    excludedFiles: [],
    pathExclusionFindings: [],
  };
  return checkAddressability(scan);
}

describe("copy-addressability — the six acceptance cases", () => {
  // 1. Inline prose in a text node -> violated.
  it("inline prose in a markup text node is a violation", () => {
    const result = checkSource("export const Banner = () => <p>Welcome to the dashboard</p>;\n");
    expect(result.verdict).toBe("violated");
    expect(result.violations).toEqual([
      expect.objectContaining({ position: "markup-text", raw: "Welcome to the dashboard" }),
    ]);
    expect(result.unchecked).toEqual([]);
  });

  // 2. Prose in aria-label (and one more of placeholder/alt/title) -> violated.
  // A text-node-only scanner reports zero candidates for this fixture —
  // there is no JSX text node here at all, only attribute values — so this
  // is the test that proves attribute coverage, not just text-node coverage.
  it("inline prose in aria-label AND placeholder attributes is a violation for each", () => {
    const src =
      'export const Field = () => <input aria-label="Enter your full name" placeholder="e.g. Jane Doe" />;\n';
    const result = checkSource(src);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: "user-facing-attribute", attribute: "aria-label", raw: '"Enter your full name"' }),
        expect.objectContaining({ position: "user-facing-attribute", attribute: "placeholder", raw: '"e.g. Jane Doe"' }),
      ]),
    );
    expect(result.unchecked).toEqual([]);
  });

  it("inline prose in alt and title attributes is a violation for each", () => {
    const src = 'export const Card = () => <img alt="A golden retriever running on the beach" title="Cover photo" />;\n';
    const result = checkSource(src);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: "user-facing-attribute", attribute: "alt" }),
        expect.objectContaining({ position: "user-facing-attribute", attribute: "title" }),
      ]),
    );
  });

  // 3. Prose inside a template literal or object literal -> indeterminate
  // (unclassifiable), NOT satisfied and NOT silently clean.
  it("prose inside a template literal or an object literal value is indeterminate, not clean", () => {
    const src = 'const greeting = `Welcome, ${name}`;\nconst labels = { save: "Save changes" };\n';
    const result = checkSource(src, "labels.ts");
    expect(result.verdict).toBe("indeterminate");
    // Never silently rounded down to a violation OR a pass — both strings
    // are surfaced as unclassifiable positions, and nothing is reported as
    // a violation for either (this gate does not guess).
    expect(result.violations).toEqual([]);
    expect(result.unchecked).toHaveLength(2);
    expect(result.unchecked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "template-literal" }),
        expect.objectContaining({ kind: "unclassified-string-position" }),
      ]),
    );
  });

  // 4. Zero components scanned (empty dir) -> indeterminate, NOT satisfied.
  // Asserts the verdict AND the CLI's own exit code explicitly — a test
  // that only asserts "did not throw" proves nothing, since Node's
  // uncaught-exception default exit code is also 1, the same code a real
  // violation uses.
  describe("zero components scanned", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "copy-addressability-empty-"));
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("an empty directory is indeterminate, never satisfied", () => {
      const scan = scanAddressabilitySources(dir);
      expect(scan.filesScanned).toBe(0);
      const result = checkAddressability(scan);
      expect(result.verdict).toBe("indeterminate");
      expect(result.verdict).not.toBe("satisfied");
      expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("no components were scanned")]));
    });

    it("the CLI's own exit code for an empty directory is 2, explicitly — not merely 'did not throw'", () => {
      const exitCode = mainAddressabilityCheck([dir]);
      expect(exitCode).toBe(2);
      expect(exitCode).not.toBe(0);
      expect(exitCode).not.toBe(1);
    });
  });

  // 5. A component resolving all text through copy ids -> satisfied.
  it("a component resolving every string through a copy id is satisfied", () => {
    const src =
      "export function Cta({ resolve, id }: { resolve: (id: string) => string; id: string }) {\n" +
      "  return <button aria-label={resolve(id)}>{resolve(id)}</button>;\n" +
      "}\n";
    const result = checkSource(src);
    expect(result.verdict).toBe("satisfied");
    expect(result.violations).toEqual([]);
    expect(result.unchecked).toEqual([]);
  });

  // 6. Non-user-facing strings (className, data-*, import specifiers, test
  // ids) must never be flagged — a fixture proving false positives are
  // avoided, not merely that true positives are found.
  it("className, data-*, import specifiers, and test ids are never flagged", () => {
    const src =
      'import { Foo } from "./foo";\n' +
      "export const Widget = () => (\n" +
      '  <div className="flex items-center gap-md" data-testid="widget-root" data-analytics-id="widget">\n' +
      "    <Foo />\n" +
      "  </div>\n" +
      ");\n";
    const result = checkSource(src);
    expect(result.verdict).toBe("satisfied");
    expect(result.violations).toEqual([]);
    expect(result.unchecked).toEqual([]);
  });
});

describe("extractAddressabilityCandidates — supporting detail", () => {
  it("a JSX text node is always position 'markup-text', regardless of whether it happens to match some registered text elsewhere", () => {
    const { violations } = extractAddressabilityCandidates("export const P = () => <p>No results</p>;\n", "P.tsx");
    expect(violations).toEqual([{ file: "P.tsx", line: 1, position: "markup-text", raw: "No results" }]);
  });

  it("a different aria-*/data-* attribute (not aria-label) stays out of scope, exactly like scan.ts's own traceability gate", () => {
    const src = 'export const Row = () => <tr aria-hidden="true" data-index="42" />;\n';
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Row.tsx");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("a decorative, letterless aria-label value is not a violation", () => {
    const src = 'export const Icon = () => <span aria-label="—" />;\n';
    const { violations } = extractAddressabilityCandidates(src, "Icon.tsx");
    expect(violations).toEqual([]);
  });

  it("a template literal used as an aria-label value is indeterminate, not a violation — templates are never confidently classified, even in an attribute position", () => {
    const src = "export const Field = ({ name }: { name: string }) => <input aria-label={`Hi, ${name}`} />;\n";
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Field.tsx");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "template-literal" })]));
  });

  it("a plain string prop that is none of the four attributes is indeterminate, not clean", () => {
    const src = 'export const Btn = () => <button tooltip="Explain this action" />;\n';
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Btn.tsx");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([
      expect.objectContaining({ kind: "unclassified-string-position", line: 1 }),
    ]);
  });

  it("a malformed/unclosed JSX construct is passed through from scan.ts as unchecked, never silently dropped", () => {
    const src = "export const Broken = () => <p>No results\n";
    const { unchecked } = extractAddressabilityCandidates(src, "Broken.tsx");
    expect(unchecked.length).toBeGreaterThan(0);
    expect(unchecked[0]).toMatchObject({ kind: "unclosed-jsx-element" });
  });
});

describe("scanAddressabilitySources — directory walk", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "copy-addressability-scan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("walks a real directory, finds a markup-text violation, and reports it as 'violated'", () => {
    writeFileSync(join(dir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    const scan = scanAddressabilitySources(dir);
    expect(scan.filesScanned).toBe(1);
    const result = checkAddressability(scan);
    expect(result.verdict).toBe("violated");
  });

  it("skips test/spec/check files by design, matching scan.ts's own convention", () => {
    writeFileSync(join(dir, "Widget.test.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    const scan = scanAddressabilitySources(dir);
    expect(scan.filesScanned).toBe(0);
    expect(scan.skippedByDesign).toEqual([{ file: "Widget.test.tsx", reason: "test-or-check-file" }]);
  });

  it("throws (fail-closed) on an unreadable directory, mirroring scanCopySourceTree", () => {
    expect(() => scanAddressabilitySources(join(dir, "does-not-exist"))).toThrow();
  });
});

describe("mainAddressabilityCheck — CLI wiring", () => {
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

  it("returns 0 for a clean, fully-addressable component", () => {
    writeFileSync(
      join(dir, "Cta.tsx"),
      "export function Cta({ resolve, id }: { resolve: (id: string) => string; id: string }) {\n" +
        "  return <button aria-label={resolve(id)}>{resolve(id)}</button>;\n" +
        "}\n",
    );
    expect(mainAddressabilityCheck([dir])).toBe(0);
  });

  it("returns 1 for inline markup-text prose", () => {
    writeFileSync(join(dir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    expect(mainAddressabilityCheck([dir])).toBe(1);
  });

  it("returns 2 for an unclassifiable position (a template literal), even with zero violations", () => {
    writeFileSync(join(dir, "labels.ts"), "const greeting = `Welcome, ${name}`;\n");
    expect(mainAddressabilityCheck([dir])).toBe(2);
  });
});
