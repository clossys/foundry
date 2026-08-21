import { describe, expect, it } from "vitest";
import { checkCopyTraceability } from "./copy-gate.js";
import { extractCopyCandidates } from "./scan.js";
import type { CopyRecord } from "./types.js";

// Hermetic: pure in-memory fixtures throughout — no filesystem, no network.
// `extractCopyCandidates` is used to build realistic `CopyCandidate[]`
// (with real `citedIds`/`hasIgnoreMarker` derived from real source text)
// rather than hand-constructing every field, so these tests exercise the
// real seam between `scan.ts` and `copy-gate.ts`, not a mocked one.

function candidatesFor(src: string, file = "x.ts") {
  const { candidates, citations } = extractCopyCandidates(src, file);
  return { candidates, citations };
}

const emptyRecord: CopyRecord = { id: "test", entries: [] };

describe("checkCopyTraceability", () => {
  it("a candidate matching a registered entry's text exactly is traced, not a finding", () => {
    const { candidates, citations } = candidatesFor('const x = "No results";\n');
    const record: CopyRecord = {
      id: "test",
      entries: [{ id: "pagination.no-results", text: "No results", context: "Pagination — empty state" }],
    };
    const result = checkCopyTraceability(candidates, citations, record, 1, []);
    expect(result.findings).toEqual([]);
    expect(result.matched).toBe(1);
    expect(result.candidatesScanned).toBe(1);
    expect(result.filesScanned).toBe(1);
  });

  it("a template literal matches a registered entry by SHAPE, ignoring both sides' placeholder names", () => {
    const { candidates, citations } = candidatesFor(
      "const x = `Showing ${start}–${end} of ${totalItems}`;\n",
    );
    const record: CopyRecord = {
      id: "test",
      entries: [
        {
          id: "pagination.range-summary",
          text: "Showing {from}–{to} of {total}", // deliberately DIFFERENT placeholder names than the source
          context: "Pagination — range summary",
          placeholders: ["from", "to", "total"],
        },
      ],
    };
    const result = checkCopyTraceability(candidates, citations, record, 1, []);
    expect(result.findings).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it("a candidate with no matching entry and no citation is an unregistered-copy finding", () => {
    const { candidates, citations } = candidatesFor('const x = "Totally new copy";\n');
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "unregistered-copy", file: "x.ts", line: 1 });
    expect(result.matched).toBe(0);
  });

  it("a valid copy:<id> citation traces a candidate even when its text doesn't match any entry", () => {
    const { candidates, citations } = candidatesFor(
      'const x = "Some ad-hoc phrasing"; // copy:pagination.no-results\n',
    );
    const record: CopyRecord = {
      id: "test",
      entries: [{ id: "pagination.no-results", text: "No results", context: "Pagination — empty state" }],
    };
    const result = checkCopyTraceability(candidates, citations, record, 1, []);
    expect(result.findings).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it("a copy:<id> citation to an id that does not exist in the record is its own finding — never a silent bypass", () => {
    const { candidates, citations } = candidatesFor('const x = "Some copy"; // copy:no.such.id\n');
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    const rules = result.findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["unknown-copy-citation", "unregistered-copy"]);
  });

  it("a stray copy:<id> citation on a line with no candidate at all is still flagged if the id doesn't exist", () => {
    const { candidates, citations } = candidatesFor("// copy:some.rotted.id\nconst x = 1;\n");
    expect(candidates).toEqual([]); // nothing traceable on that line
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "unknown-copy-citation", line: 1 }),
    ]);
  });

  it("copy-gate:ignore suppresses a finding into `ignored`, never silently drops it", () => {
    const { candidates, citations } = candidatesFor('const x = "Not registered yet"; // copy-gate:ignore\n');
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    expect(result.findings).toEqual([]);
    expect(result.ignored).toEqual([{ file: "x.ts", line: 1, snippet: '"Not registered yet"' }]);
  });

  it("an empty entries array is valid input — every candidate is simply untraced, never a thrown error", () => {
    const { candidates, citations } = candidatesFor('const x = "Anything at all";\n');
    expect(() => checkCopyTraceability(candidates, citations, emptyRecord, 1, [])).not.toThrow();
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    expect(result.findings).toHaveLength(1);
  });

  it("multiple candidates across files are all evaluated independently", () => {
    const a = candidatesFor('const x = "No results";\n', "a.ts");
    const b = candidatesFor('const y = "Unregistered thing";\n', "b.ts");
    const record: CopyRecord = {
      id: "test",
      entries: [{ id: "shared.no-results", text: "No results", context: "shared empty state" }],
    };
    const result = checkCopyTraceability(
      [...a.candidates, ...b.candidates],
      [...a.citations, ...b.citations],
      record,
      2,
      [],
    );
    expect(result.matched).toBe(1);
    expect(result.findings).toEqual([expect.objectContaining({ file: "b.ts" })]);
    expect(result.candidatesScanned).toBe(2);
    expect(result.filesScanned).toBe(2);
  });

  it("passes `unchecked` straight through onto the result, unmodified — see scan.ts's UncheckedItem", () => {
    const { candidates, citations } = candidatesFor('const x = "No results";\n');
    const record: CopyRecord = {
      id: "test",
      entries: [{ id: "pagination.no-results", text: "No results", context: "Pagination — empty state" }],
    };
    const unchecked = [{ file: "Widget.tsx", line: 4, kind: "unclosed-jsx-element", detail: "test fixture" }];
    const result = checkCopyTraceability(candidates, citations, record, 1, unchecked);
    expect(result.unchecked).toEqual(unchecked);
    // Passing through `unchecked` never changes findings/matched — the two
    // concerns are independent; only `cli.ts` decides what a non-empty
    // `unchecked` list means for an overall exit code.
    expect(result.findings).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it("an empty `unchecked` list round-trips as empty, not omitted", () => {
    const { candidates, citations } = candidatesFor('const x = "Anything";\n');
    const result = checkCopyTraceability(candidates, citations, emptyRecord, 1, []);
    expect(result.unchecked).toEqual([]);
  });
});
