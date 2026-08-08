import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractCopyCandidates, PLACEHOLDER_SENTINEL, scanCopySourceTree } from "./scan.js";

// Hermetic: every test operates on its own `mkdtemp` directory (for the
// walker) or a plain in-memory string (for `extractCopyCandidates`, which
// does zero I/O). Nothing here reads any path outside a test's own temp
// directory, and nothing here scans this repository's own source.

describe("extractCopyCandidates — calibrated against real code in this repository", () => {
  // These fixtures are short, deliberately-reproduced excerpts of the
  // exact lines the task brief cites from packages/ui/src/blocks/
  // Pagination.tsx, packages/ui/src/atoms/Select.tsx, and
  // packages/ui/src/atoms/Table.tsx — never an import of `ui` itself (out
  // of scope, see this package's README) and never a modification of
  // those files.

  it("Pagination.tsx: a bare literal assignment with no surrounding syntax is copy", () => {
    const src = `let rangeSummary: string;\nrangeSummary = "No results";\n`;
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "string", raw: '"No results"', normalized: "No results", line: 2 });
  });

  it("Pagination.tsx: a ternary's true branch is copy, not an object key, even though it is followed by ':'", () => {
    const src =
      'rangeSummary = totalItems === 0 ? "No results" : `Showing ${start}–${end} of ${totalItems}`;\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ kind: "string", normalized: "No results" });
    expect(candidates[1]).toMatchObject({
      kind: "template",
      normalized: `Showing ${PLACEHOLDER_SENTINEL}–${PLACEHOLDER_SENTINEL} of ${PLACEHOLDER_SENTINEL}`,
      placeholderCount: 3,
    });
  });

  it("Pagination.tsx: a plain 'Page X of Y' template literal is copy", () => {
    const src = "rangeSummary = `Page ${page} of ${clampedCount}`;\n";
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "template",
      normalized: `Page ${PLACEHOLDER_SENTINEL} of ${PLACEHOLDER_SENTINEL}`,
      placeholderCount: 2,
    });
  });

  it("Pagination.tsx: aria-label='Previous page' is excluded — an accessibility label, not in-scope copy", () => {
    const src = '<Button variant="ghost" size="sm" aria-label="Previous page" isDisabled={isFirstPage}>\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(candidates).toEqual([]);
    const reasons = excluded.map((e) => e.reason);
    expect(reasons).toContain("aria-or-data-attribute-value"); // "Previous page"
    expect(reasons).toContain("denylisted-attribute-or-prop-value"); // variant="ghost", size="sm"
  });

  it("Pagination.tsx: className is never copy, whether a plain attribute value or a cx(...) argument", () => {
    const src =
      'className={cx("flex flex-wrap items-center justify-between gap-md", className)}\n' +
      '<span aria-hidden="true" className="px-xs text-ink-muted">\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(candidates).toEqual([]);
    const reasons = excluded.map((e) => e.reason);
    expect(reasons).toContain("classname-builder-argument"); // the cx(...) argument
    expect(reasons).toContain("denylisted-attribute-or-prop-value"); // className="px-xs..."
    expect(reasons).toContain("aria-or-data-attribute-value"); // aria-hidden="true"
  });

  it("Pagination.tsx: a ‹/› glyph written as a string literal has no letters and is not copy", () => {
    // The real ‹/› glyphs in Pagination.tsx are raw JSX text (`<Button>‹</Button>`),
    // which is out of scope for this scanner entirely — see this file's
    // "WHAT THIS DELIBERATELY DOES NOT CATCH" doc comment. This fixture
    // exercises the same no-letters exclusion for the one shape this
    // scanner DOES see: a decorative glyph written as a string/template
    // literal (e.g. an ellipsis rendered via `{"…"}` or assigned to a
    // variable), which is a real, common pattern elsewhere in this
    // codebase (see `Table.tsx`'s `"▲"`/`"▼"`/`"↕"` sort-indicator glyphs).
    const src = 'const glyph = "‹";\nconst sortIndicator = isAscending ? "▲" : "▼";\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Pagination.tsx");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "no-letters")).toBe(true);
    expect(excluded).toHaveLength(3);
  });

  it('Select.tsx: the "Select an option" placeholder default is copy', () => {
    const src = "isPlaceholder ? (placeholder ?? \"Select an option\") : selectedText\n";
    const { candidates, excluded } = extractCopyCandidates(src, "Select.tsx");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ normalized: "Select an option" });
  });

  it('Table.tsx: "Select all rows" — a real aria-label default written as a string-keyed destructuring property — is excluded, and so is the "aria-label" key itself', () => {
    const src =
      "function TableSelectAllCheckbox({\n" +
      '  "aria-label": ariaLabel = "Select all rows",\n' +
      "  className,\n" +
      "}: TableSelectAllCheckboxProps) {\n";
    const { candidates, excluded } = extractCopyCandidates(src, "Table.tsx");
    expect(candidates).toEqual([]);
    const reasons = excluded.map((e) => e.reason);
    expect(excluded.some((e) => e.raw === '"aria-label"' && e.reason === "object-or-destructuring-key")).toBe(true);
    expect(excluded.some((e) => e.raw === '"Select all rows"' && e.reason === "aria-or-data-attribute-value")).toBe(
      true,
    );
    expect(reasons).toHaveLength(2);
  });

  it('Table.tsx: "Select row" — the per-row checkbox default — is excluded the same way', () => {
    const src = '"aria-label": ariaLabel = "Select row",\n';
    const { excluded, candidates } = extractCopyCandidates(src, "Table.tsx");
    expect(candidates).toEqual([]);
    expect(excluded.some((e) => e.raw === '"Select row"' && e.reason === "aria-or-data-attribute-value")).toBe(true);
  });

  it("import specifiers are never copy", () => {
    const src = 'import type { CSSProperties } from "react";\nconst mod = require("node:path");\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "import-or-require-specifier")).toBe(true);
    expect(excluded).toHaveLength(2);
  });

  it("a genuine object-literal string key is excluded; its multi-word value is not", () => {
    const src = 'const opts = { "some-key": "some value" };\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(excluded).toEqual([{ file: "x.ts", line: 1, raw: '"some-key"', reason: "object-or-destructuring-key" }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ normalized: "some value" });
  });

  it("string-literal union members inside a type alias are excluded as type context", () => {
    const src = 'type Variant = "primary" | "ghost";\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "type-or-interface-context")).toBe(true);
    expect(excluded).toHaveLength(2);
  });

  it("string-literal union members inside an interface body are excluded as type context", () => {
    const src = 'interface Foo {\n  status: "now" | "next" | "later" | "shipped";\n}\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "type-or-interface-context")).toBe(true);
    expect(excluded).toHaveLength(4);
  });

  it("a thrown/logged developer diagnostic is excluded, not reported as copy", () => {
    const src = 'throw new Error("Something broke");\nconsole.warn("Deprecated prop used");\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "developer-diagnostic-argument")).toBe(true);
    expect(excluded).toHaveLength(2);
  });

  it("a bare lowercase single-word token (enum/variant-shaped) is excluded", () => {
    const src = 'const options = ["ascending", "descending"];\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded.every((e) => e.reason === "enum-or-token-shaped")).toBe(true);
    expect(excluded).toHaveLength(2);
  });

  it("a multi-word sentence is copy even when it starts a JSX text-adjacent expression", () => {
    const src = 'const message = "Something went wrong. Try again.";\n';
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
  });

  it("a copy:<id> citation on the same line is attached to that line's candidate", () => {
    const src = 'rangeSummary = "No results"; // copy:pagination.no-results\n';
    const { candidates, citations } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.citedIds).toEqual(["pagination.no-results"]);
    expect(citations).toEqual([{ file: "x.ts", line: 1, id: "pagination.no-results" }]);
  });

  it("a citation with no candidate on its own line is still recorded (a stray/rotted citation)", () => {
    const src = "// copy:some.stale-id\nconst x = 1;\n";
    const { candidates, citations } = extractCopyCandidates(src, "x.ts");
    expect(candidates).toEqual([]);
    expect(citations).toEqual([{ file: "x.ts", line: 1, id: "some.stale-id" }]);
  });

  it("a copy-gate:ignore marker is attached to that line's candidate", () => {
    const src = 'rangeSummary = "TODO copy"; // copy-gate:ignore\n';
    const { candidates } = extractCopyCandidates(src, "x.ts");
    expect(candidates[0]?.hasIgnoreMarker).toBe(true);
  });

  it("escaped quotes inside a string do not terminate it early", () => {
    const src = String.raw`const s = "She said \"hello\" to everyone";` + "\n";
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(excluded).toEqual([]);
    expect(candidates[0]?.normalized).toBe('She said "hello" to everyone');
  });

  it("a division and a regex literal are both handled without derailing subsequent string scanning", () => {
    const src = "const half = total / 2;\nconst re = /a\\/b/;\nconst copy = \"Real copy after a regex\";\n";
    const { candidates, excluded } = extractCopyCandidates(src, "x.ts");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("Real copy after a regex");
  });

  it("an unterminated string is reported as a parse failure, not silently skipped or misread", () => {
    const src = 'const broken = "never closed\nconst x = 1;\n';
    const result = extractCopyCandidates(src, "x.ts");
    expect(result.parseFailure).toBeDefined();
    expect(result.candidates).toEqual([]);
  });

  it("a nested template literal inside an interpolation does not desync the outer scan", () => {
    const src = "const s = `outer ${`inner ${x}`} tail`;\nconst copy = \"Real copy after nesting\";\n";
    const result = extractCopyCandidates(src, "x.ts");
    expect(result.parseFailure).toBeUndefined();
    expect(result.candidates.some((c) => c.normalized === "Real copy after nesting")).toBe(true);
  });
});

describe("extractCopyCandidates — JSX text nodes (issue #37)", () => {
  it("a plain JSX text node is one candidate, trimmed", () => {
    const src = "const el = <p>Hello world</p>;\n";
    const { candidates, excluded, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(excluded).toEqual([]);
    expect(unchecked).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "jsx-text",
      raw: "Hello world",
      normalized: "Hello world",
      placeholderCount: 0,
      line: 1,
    });
  });

  it("mixed content: text runs across an element boundary are separate candidates, tail not lost", () => {
    const src = "const el = <p>Hello <strong>there</strong> friend</p>;\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates.map((c) => c.normalized)).toEqual(["Hello", "there", "friend"]);
  });

  it("a multi-line, prettier-wrapped text node collapses onto JSX's own whitespace rule", () => {
    const src = "const el = (\n  <p>\n    Hello\n    world\n  </p>\n);\n";
    const { candidates } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("Hello world");
  });

  it("an {expression} child is skipped as code, not text — the surrounding text runs are still found", () => {
    const src = "const el = <p>Count: {count}</p>;\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("Count:");
  });

  it("a string literal INSIDE a {expression} child is still found, via the ordinary literal path", () => {
    const src = 'const el = <p>{isEmpty ? "No results" : "Has results"}</p>;\n';
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    const kinds = candidates.map((c) => ({ kind: c.kind, normalized: c.normalized }));
    expect(kinds).toEqual(
      expect.arrayContaining([
        { kind: "string", normalized: "No results" },
        { kind: "string", normalized: "Has results" },
      ]),
    );
  });

  it("nested JSX inside an expression child is resolved — its own text nodes are found too", () => {
    const src = "const el = <div>{show && <span>Now visible</span>}</div>;\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates.some((c) => c.kind === "jsx-text" && c.normalized === "Now visible")).toBe(true);
  });

  it("JSX entities: named (&amp;) and numeric (&#8212;, &nbsp;) are decoded", () => {
    // "10&#8212;20" alone decodes to "10—20" — digits and a dash, no
    // \p{L} letters at all — which is correctly excluded as no-letters
    // (rule #8's JSX-text analogue), same as a bare glyph string literal
    // would be. " units"/"items" keeps each fixture a real candidate.
    const src =
      "const a = <p>Terms &amp; Conditions</p>;\n" +
      "const b = <p>10&#8212;20 units</p>;\n" +
      "const c = <p>10&nbsp;items</p>;\n";
    const { candidates } = extractCopyCandidates(src, "Widget.tsx");
    const texts = candidates.map((c) => c.normalized);
    expect(texts).toContain("Terms & Conditions");
    expect(texts).toContain("10—20 units");
    expect(texts).toContain("10 items"); // &nbsp; -> an ordinary space, not U+00A0 — see NAMED_JSX_ENTITIES' own doc comment
  });

  it("an unrecognized named entity is left verbatim, not guessed at or dropped", () => {
    const src = "const el = <p>Look &foobar; here</p>;\n";
    const { candidates } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates[0]?.normalized).toBe("Look &foobar; here");
  });

  it("whitespace-only text between sibling tags is not copy, and is never even counted as excluded", () => {
    const src = "const el = (\n  <div>\n    <span>Label</span>\n  </div>\n);\n";
    const { candidates, excluded, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("Label");
    expect(excluded).toEqual([]); // no "no-letters" noise from pure indentation
  });

  it("a punctuation/symbol-only text run (a bare em dash) is excluded as no-letters, and IS counted", () => {
    const src = "const el = (\n  <div>\n    <span>Label</span>\n    <span>—</span>\n  </div>\n);\n";
    const { candidates, excluded } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates.map((c) => c.normalized)).toEqual(["Label"]);
    expect(excluded).toEqual([{ file: "Widget.tsx", line: 4, raw: "—", reason: "no-letters" }]);
  });

  it("the enum/token-shaped heuristic (a bare lowercase word) does NOT apply to JSX text — unlike a string literal", () => {
    const src = "const el = <Badge>new</Badge>;\n";
    const { candidates, excluded } = extractCopyCandidates(src, "Widget.tsx");
    expect(excluded).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("new");
  });

  it("a {/* JSX comment */} is not text and produces no candidate, and does not merge the text on either side", () => {
    const src = "const el = <p>Hello{/* TODO: revisit */}world</p>;\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates.map((c) => c.normalized)).toEqual(["Hello", "world"]);
  });

  it("a copy:<id> citation on a JSX text node's own line is attached exactly like a literal candidate's", () => {
    const src = "const el = <p>No results found</p>; // copy:pagination.no-results\n";
    const { candidates, citations } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.citedIds).toEqual(["pagination.no-results"]);
    expect(citations).toEqual([{ file: "Widget.tsx", line: 1, id: "pagination.no-results" }]);
  });

  it("a copy-gate:ignore marker on a JSX text node's own line is attached exactly like a literal candidate's", () => {
    const src = "const el = <p>Not yet registered</p>; // copy-gate:ignore\n";
    const { candidates } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates[0]?.hasIgnoreMarker).toBe(true);
  });

  it("a self-closing element contributes no text candidate", () => {
    const src = 'const el = <br className="mt-sm" />;\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([{ file: "Widget.tsx", line: 1, raw: '"mt-sm"', reason: "denylisted-attribute-or-prop-value" }]);
  });

  it("a JSX attribute value still goes through the SAME classification as before JSX-awareness existed", () => {
    const src = '<Button variant="ghost" size="sm" aria-label="Previous page" isDisabled={isFirstPage} />;\n';
    const { candidates, excluded } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([]);
    const reasons = excluded.map((e) => e.reason).sort();
    expect(reasons).toEqual(
      ["aria-or-data-attribute-value", "denylisted-attribute-or-prop-value", "denylisted-attribute-or-prop-value"].sort(),
    );
  });

  // ------------------------------------------------- false-positive traps

  it("does NOT fire inside a .ts file with no JSX at all", () => {
    const src = "const el = <p>Hello world</p>;\n";
    const { candidates } = extractCopyCandidates(src, "plain.ts");
    expect(candidates).toEqual([]);
  });

  it("does NOT fire inside a .js file with no JSX at all", () => {
    const src = "const el = <p>Hello world</p>;\n";
    const { candidates } = extractCopyCandidates(src, "plain.js");
    expect(candidates).toEqual([]);
  });

  it("does NOT fire on a string literal containing '>' and '<' — the string branch already consumed it", () => {
    const src = 'const s = "a > b < c";\n';
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates).toEqual([{
      file: "Widget.tsx",
      line: 1,
      kind: "string",
      raw: '"a > b < c"',
      normalized: "a > b < c",
      placeholderCount: 0,
      citedIds: [],
      hasIgnoreMarker: false,
    }]);
  });

  it("does NOT fire on a generic type parameter (Map<string, string>)", () => {
    const src = "type X = Map<string, string>;\nconst m: Map<string, string> = new Map();\n";
    const { candidates, excluded, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("does NOT fire on a comparison expression (a < b && c > d)", () => {
    const src = "const ok = a < b && c > d;\n";
    const { candidates, excluded, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("does NOT fire on '<'/'>' inside a regex literal, and subsequent real copy is still found", () => {
    const src = 'const re = /<[^>]+>/;\nconst copy = "Real copy after a regex";\n';
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "string", normalized: "Real copy after a regex" });
  });

  // ---------------------------------------------------------- unchecked

  it("an unclosed JSX element is reported via `unchecked`, not silently dropped — text found before the break is kept", () => {
    const src = "const el = <div>\n  <p>Hello</p>\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([expect.objectContaining({ kind: "jsx-text", normalized: "Hello" })]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]).toMatchObject({ file: "Widget.tsx", kind: "unclosed-jsx-element" });
  });

  it("an unbalanced {expression} child is reported via `unchecked` — text found before it is kept", () => {
    const src = "const el = <p>Count: {count</p>\nconst x = 1;\n";
    const { candidates, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([expect.objectContaining({ kind: "jsx-text", normalized: "Count:" })]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]).toMatchObject({ file: "Widget.tsx", kind: "malformed-jsx-expression" });
  });

  it("an unterminated JSX attribute EXPRESSION value is reported via `unchecked`, not a silent parse success", () => {
    // (An unterminated QUOTED attribute string is a slightly different
    // case: it always cascades into a whole-file `parseFailure` instead
    // — see this file's "does NOT commit" reasoning in `tryScanJsxElement`'s
    // own doc comment. This fixture exercises the `{expr}` attribute-value
    // path, which fails in isolation without taking the rest of the file
    // down with it.)
    const src = "const el = <p title={neverClosed>Hello</p>;\n";
    const { unchecked, parseFailure } = extractCopyCandidates(src, "Widget.tsx");
    expect(parseFailure).toBeUndefined();
    expect(unchecked.some((u) => u.kind === "malformed-jsx-tag")).toBe(true);
  });

  it("TSX generic-arrow-function syntax is silently treated as not-JSX — no unchecked noise", () => {
    const src = "const identity = <T,>(x: T): T => x;\n";
    const { candidates, excluded, unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("JSX nesting deep enough to trip the depth safety bound is reported via `unchecked`, never a crash or a hang", () => {
    const depth = 205;
    const src = `const el = ${"<div>".repeat(depth)}${"</div>".repeat(depth)};\n`;
    const { unchecked } = extractCopyCandidates(src, "Widget.tsx");
    expect(unchecked.some((u) => u.kind === "jsx-depth-exceeded")).toBe(true);
  });
});

describe("scanCopySourceTree", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "copy-scan-test-"));
  });

  afterEach(() => {
    try {
      chmodSync(join(dir, "locked"), 0o755); // restore, so rmSync below can clean up even after the permissions test
    } catch {
      // "locked" may not exist in every test — fine.
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads every matching file, counts it as scanned, and returns repo-relative /-joined paths", () => {
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "notes.ts"), 'export const x = "Hello there";\n');
    writeFileSync(join(dir, "notes.txt"), "not scanned — wrong extension");
    const result = scanCopySourceTree(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.candidates).toEqual([
      expect.objectContaining({ file: "nested/notes.ts", normalized: "Hello there" }),
    ]);
  });

  it("skips node_modules, dist, build, coverage, and .git by default", () => {
    for (const skipped of ["node_modules", "dist", "build", "coverage", ".git"]) {
      mkdirSync(join(dir, skipped), { recursive: true });
      writeFileSync(join(dir, skipped, "nope.ts"), 'const x = "Should not be read";\n');
    }
    writeFileSync(join(dir, "real.ts"), 'const x = "Should be read";\n');
    const result = scanCopySourceTree(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.candidates).toEqual([expect.objectContaining({ file: "real.ts" })]);
  });

  it("skips .test.ts(x)/.spec.ts(x)/.check.ts(x)/.d.ts files BY DESIGN, and reports the skip, never silently", () => {
    writeFileSync(join(dir, "a.test.ts"), 'const x = "Fixture copy";\n');
    writeFileSync(join(dir, "a.check.tsx"), 'const x = "Fixture copy";\n');
    writeFileSync(join(dir, "a.d.ts"), 'declare const x: "not runtime";\n');
    writeFileSync(join(dir, "real.ts"), 'const x = "Real copy";\n');
    const result = scanCopySourceTree(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.skippedByDesign.map((s) => s.file).sort()).toEqual(["a.check.tsx", "a.d.ts", "a.test.ts"]);
  });

  it("respects a custom extensions list", () => {
    writeFileSync(join(dir, "notes.jsx"), 'const x = "Hello";\n');
    writeFileSync(join(dir, "notes.ts"), 'const x = "Hello";\n');
    const result = scanCopySourceTree(dir, { extensions: [".jsx"] });
    expect(result.filesScanned).toBe(1);
    expect(result.candidates[0]?.file).toBe("notes.jsx");
  });

  it("returns zero files scanned for a directory with no matching files — the caller (cli.ts) treats this as exit 2, never a clean pass", () => {
    writeFileSync(join(dir, "data.json"), "{}");
    const result = scanCopySourceTree(dir);
    expect(result.filesScanned).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it("a file that fails to parse contributes zero candidates AND is reported in parseFailures, not silently treated as scanned", () => {
    writeFileSync(join(dir, "broken.ts"), 'const broken = "never closed\nconst x = 1;\n');
    writeFileSync(join(dir, "fine.ts"), 'const x = "Real copy";\n');
    const result = scanCopySourceTree(dir);
    expect(result.filesScanned).toBe(1); // only fine.ts
    expect(result.parseFailures).toEqual([expect.objectContaining({ file: "broken.ts" })]);
    expect(result.candidates).toEqual([expect.objectContaining({ file: "fine.ts" })]);
  });

  // Fails CLOSED: an unreadable directory must throw, never be silently
  // treated as empty — see this file's top doc comment, and
  // `@vespeneventures/strategy`'s `scan.test.ts` for the identical case.
  // Skipped when running as root (root bypasses directory permission bits
  // entirely, which would make this assertion meaningless rather than
  // wrong).
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(isRoot)("throws rather than silently skipping an unreadable directory", () => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "secret.ts"), 'const x = "should never be silently skipped";\n');
    chmodSync(locked, 0o000);
    expect(() => scanCopySourceTree(dir)).toThrow(/cannot read directory/);
  });
});
