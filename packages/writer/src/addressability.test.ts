import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAddressability,
  extractAddressabilityCandidates,
  scanAddressabilitySources,
  type AddressabilityGateResult,
  type AddressabilityScanResult,
} from "./addressability.js";
import { mainAddressabilityCheck } from "./cli.js";

const DIST_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

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

  // 3b (issue #407). A violation found ALONGSIDE unclassified positions in
  // the SAME scan must report the violation — "violated" wins over
  // "indeterminate" when both are true, the opposite of case 3 above (which
  // has zero violations and is correctly indeterminate). Before #407 this
  // was folded into "indeterminate", making "violated" unreachable on any
  // real tree, since real trees always have some unclassified positions.
  it("a real violation alongside unclassified positions is violated, not indeterminate (#407)", () => {
    const src =
      'export const Banner = () => <p>Welcome to the dashboard</p>;\n' +
      'const greeting = `Welcome, ${name}`;\n';
    const result = checkSource(src, "Banner.tsx");
    expect(result.violations).toHaveLength(1);
    expect(result.unchecked.length).toBeGreaterThan(0);
    expect(result.verdict).toBe("violated");
    expect(result.verdict).not.toBe("indeterminate");
    // The coverage gap is not hidden by the "violated" verdict — reasons
    // still names it, and the caller (cli.ts) still prints `unchecked`
    // unconditionally regardless of verdict.
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("string position(s) could not be confidently classified")]),
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

// ============================================================================
// Regression coverage for issue #383's two precision defects.
// ============================================================================

describe("defect 1 (issue #383) — a destructuring default is misread as a JSX attribute, INVERTING the verdict on a correct construct", () => {
  // CONSTRUCTED POSITIVE CONTROL, exactly as issue #383 demands: the SAME
  // default value ("Pagination"), first as a correctly-overridable
  // destructuring default (must NOT be flagged), then inlined directly
  // onto the JSX element (must BE flagged) — proving this is a real
  // discrimination between two different constructs, not merely "stopped
  // detecting aria-label at all". Mirrors the real, previously-misread
  // line verbatim: `blocks/Pagination.tsx:96`'s
  // `"aria-label": ariaLabel = "Pagination",`.
  it("a renamed destructuring default for aria-label is addressable — NOT flagged — while the identical value inlined onto the element IS", () => {
    const addressable =
      "export function Pagination({\n" +
      "  page,\n" +
      "  pageCount,\n" +
      '  "aria-label": ariaLabel = "Pagination",\n' +
      "  ...rest\n" +
      "}: PaginationProps) {\n" +
      "  return <nav aria-label={ariaLabel} {...rest}>{page}/{pageCount}</nav>;\n" +
      "}\n";
    const addressableResult = checkSource(addressable, "Pagination.tsx");
    expect(addressableResult.verdict).toBe("satisfied");
    expect(addressableResult.violations).toEqual([]);

    const inlined =
      "export function Pagination({ page, pageCount, ...rest }: PaginationProps) {\n" +
      '  return <nav aria-label="Pagination" {...rest}>{page}/{pageCount}</nav>;\n' +
      "}\n";
    const inlinedResult = checkSource(inlined, "Pagination.tsx");
    expect(inlinedResult.verdict).toBe("violated");
    expect(inlinedResult.violations).toEqual([
      expect.objectContaining({ position: "user-facing-attribute", attribute: "aria-label", raw: '"Pagination"' }),
    ]);
  });

  // Same positive control, direct (non-renamed) key — `{ label = "Save" }`
  // — proving the fix is not narrowly keyed to the renamed-string-key
  // shape alone.
  it("a direct (non-renamed) destructuring default is addressable — NOT flagged — while the identical value inlined onto the element IS", () => {
    const addressable =
      "export function Btn({ label = \"Save\" }: { label?: string }) {\n" +
      "  return <button>{label}</button>;\n" +
      "}\n";
    expect(checkSource(addressable, "Btn.tsx").violations).toEqual([]);
  });

  // "Find every construct in that class, not just the one named" — the
  // SAME misreading applies to placeholder/alt/title, not only aria-label
  // (position 2b's own lookup shares attributeNameFor with position 2a's,
  // and had the identical bug for all three).
  it.each([
    ["placeholder", "Search"],
    ["alt", "A golden retriever"],
    ["title", "Cover photo"],
  ] as const)("a destructuring default for %s is addressable — NOT flagged — while the identical value inlined IS", (attr, value) => {
    const addressable =
      `export function Field({ ${attr} = "${value}" }: { ${attr}?: string }) {\n` +
      `  return <input ${attr}={${attr}} />;\n` +
      "}\n";
    const addressableResult = checkSource(addressable, "Field.tsx");
    expect(addressableResult.violations).toEqual([]);

    const inlined = `export const Field = () => <input ${attr}="${value}" />;\n`;
    const inlinedResult = checkSource(inlined, "Field.tsx");
    expect(inlinedResult.violations).toEqual([
      expect.objectContaining({ position: "user-facing-attribute", attribute: attr, raw: `"${value}"` }),
    ]);
  });

  // A plain (non-destructured) parameter default — `function f(ariaLabel =
  // "...")` — the other half of "every construct in that class": not a
  // destructuring pattern at all, but the same `identifier = "..."`
  // shape `attributeNameFor` cannot tell from a JSX attribute on its own.
  it("a plain (non-destructured) parameter default is addressable — NOT flagged", () => {
    const src = 'function describe(ariaLabel = "Pagination") {\n  return ariaLabel;\n}\n';
    const { violations } = extractAddressabilityCandidates(src, "describe.ts");
    expect(violations).toEqual([]);
  });

  // Every OTHER aria-*/data-* attribute still stays out of this gate's
  // scope even for a destructuring default with an aria-shaped local
  // binding name that ISN'T aria-label itself — guards against the fix
  // accidentally widening scope rather than narrowing false positives.
  it("a destructuring default whose local binding merely starts with 'aria' but isn't aria-label stays out of scope", () => {
    const src = 'export function Row({ "aria-hidden": ariaHidden = "true" }: RowProps) {\n  return <tr aria-hidden={ariaHidden} />;\n}\n';
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Row.tsx");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([]);
  });
});

describe("defect 2 (issue #383) — a className-shaped string outside attribute position inflates unclassifiable past what is genuinely ambiguous", () => {
  // The two exact fixtures cited in issue #383.
  it("a Tailwind class list assigned to a variable is not prose — excluded, not unchecked", () => {
    const src = 'const baseStyles = "border-t border-line-base pt-xs";\n';
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Faq.ts");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("a Tailwind class list sitting in an object-literal value is not prose — excluded, not unchecked", () => {
    const src = 'const grid = { base: "grid-cols-1 tablet:grid-cols-2" };\n';
    const { violations, unchecked } = extractAddressabilityCandidates(src, "FieldGroup.ts");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("a variant-map object literal of class lists (the shape @vespeneventures/ui's Button/Badge/Banner use) is fully excluded", () => {
    const src =
      "const VARIANT_CLASSES: Record<string, string> = {\n" +
      '  danger: "border-status-danger bg-status-danger-tint text-status-danger-text",\n' +
      '  success: "border-status-success bg-status-success-tint text-status-success-text",\n' +
      "};\n";
    const { violations, unchecked } = extractAddressabilityCandidates(src, "Banner.tsx");
    expect(violations).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  // Negative controls — proves the heuristic is conservative, not merely
  // "any multi-word string assigned to a variable is now clean". Real
  // prose, and a class list containing even ONE separator-free bare
  // utility token, must both remain unchecked (never silently rounded
  // down to a pass).
  it("ordinary prose assigned to a variable is NOT swept in as a class list — stays unchecked", () => {
    const src = 'const confirmMessage = "Are you sure you want to continue";\n';
    const { unchecked } = extractAddressabilityCandidates(src, "confirm.ts");
    expect(unchecked).toEqual([expect.objectContaining({ kind: "unclassified-string-position" })]);
  });

  it("short lowercase prose with no hyphenation is NOT swept in as a class list — stays unchecked", () => {
    const src = 'const status = "low stock";\n';
    const { unchecked } = extractAddressabilityCandidates(src, "status.ts");
    expect(unchecked).toEqual([expect.objectContaining({ kind: "unclassified-string-position" })]);
  });

  it("a class list containing even one separator-free bare utility token stays unchecked — a stated, deliberate under-classification", () => {
    const src = 'const baseStyles = "flex items-center gap-md";\n';
    const { unchecked } = extractAddressabilityCandidates(src, "styles.ts");
    expect(unchecked).toEqual([expect.objectContaining({ kind: "unclassified-string-position" })]);
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

  // #407: a violation found alongside unclassified positions returns 1, not
  // 2 — the exit code CI actually branches on must not fold a real finding
  // into a coverage-gap outage.
  it("returns 1, not 2, when a violation is found alongside unclassified positions (#407)", () => {
    writeFileSync(join(dir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    writeFileSync(join(dir, "labels.ts"), "const greeting = `Welcome, ${name}`;\n");
    expect(mainAddressabilityCheck([dir])).toBe(1);
    expect(mainAddressabilityCheck([dir])).not.toBe(2);
  });
});

// REGRESSION. Every test above invokes either `mainAddressabilityCheck`
// (the exported function directly) or, indirectly, whatever bin name it
// happened to be wired to — neither can observe how this repository's own
// root package.json actually invokes every gate: BY COMPILED PATH
// (`node packages/ui/dist/tokens/contrast-cli.js`,
// `node packages/controller/dist/cli.js`, ...), never through `npx` or an
// installed `bin` name. A prior version of this file dispatched on
// `basename(process.argv[1])`, which is exactly invisible to that
// invocation style — `node dist/cli.js <dir>` silently ran writer-check's
// DEFAULT command instead of addressability, with no error at all. This
// spawns the REAL compiled `dist/cli.js` as a subprocess, exactly the way
// this repository's own CI would, and asserts the exit code directly —
// the one thing "did not throw" cannot prove, since Node's own
// uncaught-exception default exit code is also non-zero.
describe("dist/cli.js — reachable by direct compiled-path invocation, this repository's own real invocation pattern", () => {
  let dir: string;

  beforeEach(() => {
    if (!existsSync(DIST_CLI)) {
      throw new Error(
        `${DIST_CLI} does not exist — run "npm run build" in packages/copy before running this test file. ` +
          `This suite proves the gate is reachable the way this repository's own CI invokes it (by compiled path), which is only meaningful against the real compiled output, never a mock of it.`,
      );
    }
    dir = mkdtempSync(join(tmpdir(), "copy-addressability-distcli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runDistCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [DIST_CLI, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status: number | null; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("`node dist/cli.js addressability <empty-dir>` exits 2 — the exact invocation the wiring bug made silently run the wrong command", () => {
    const result = runDistCli(["addressability", dir]);
    expect(result.status).toBe(2);
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBe(1);
    // Proves the ADDRESSABILITY gate specifically ran, not writer-check's
    // default command falling through silently (which would instead
    // print "record-file ... is not a file" and never mention
    // addressability at all — see this describe block's own comment).
    expect(result.stdout).toContain("[addressability]");
  });

  it("`node dist/cli.js addressability <dir>` finds a real violation and exits 1", () => {
    writeFileSync(join(dir, "Widget.tsx"), "export const Widget = () => <p>No results found</p>;\n");
    const result = runDistCli(["addressability", dir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("[addressability]");
    expect(result.stdout).toContain("No results found");
  });

  it("`node dist/cli.js addressability <clean-dir>` exits 0", () => {
    writeFileSync(
      join(dir, "Cta.tsx"),
      "export function Cta({ resolve, id }: { resolve: (id: string) => string; id: string }) {\n" +
        "  return <button aria-label={resolve(id)}>{resolve(id)}</button>;\n" +
        "}\n",
    );
    const result = runDistCli(["addressability", dir]);
    expect(result.status).toBe(0);
  });

  it("`node dist/cli.js <bad-record-file>` (no subcommand) still runs the DEFAULT writer-check command, unaffected by the subcommand existing", () => {
    const result = runDistCli([dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("record-file");
    expect(result.stdout).not.toContain("[addressability]");
  });
});
