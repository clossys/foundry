import { describe, expect, it } from "vitest";
import { parseCopyRecord, validateCopyRecordShape } from "./schema.js";
import type { CopyRecord } from "./types.js";

// A minimal but complete, obviously-fictional CopyRecord used across this
// file's tests. "Acme" mirrors the placeholder already used elsewhere in
// this repository's own README examples — never a real company, and never
// copy any real product would actually show a user.
const validRecord: CopyRecord = {
  id: "acme-app",
  entries: [
    {
      id: "pagination.no-results",
      text: "No results found for your search.",
      context: "search results page, empty state",
    },
    {
      id: "pagination.range",
      text: "Showing {start}–{end} of {total} results.",
      context: "search results page, pagination footer",
      placeholders: ["start", "end", "total"],
    },
  ],
};

describe("validateCopyRecordShape", () => {
  it("returns no findings for a well-formed CopyRecord", () => {
    expect(validateCopyRecordShape(validRecord)).toEqual([]);
  });

  it("never throws on null, a string, an array, a number, or undefined, and reports record-present", () => {
    for (const bad of [null, "not an object", [], 42, undefined]) {
      expect(() => validateCopyRecordShape(bad)).not.toThrow();
      const findings = validateCopyRecordShape(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
      expect(findings.some((f) => f.rule === "record-present" && f.path === "$")).toBe(true);
    }
  });

  it("flags a missing id with an id-shape finding at path 'id'", () => {
    const findings = validateCopyRecordShape({ ...validRecord, id: undefined });
    expect(findings.some((f) => f.rule === "id-shape" && f.path === "id")).toBe(true);
  });

  it("flags a non-array entries with entries-shape", () => {
    const findings = validateCopyRecordShape({ ...validRecord, entries: "nope" });
    expect(findings.some((f) => f.rule === "entries-shape" && f.path === "entries")).toBe(true);
  });

  it("is well-formed (zero findings) for a record with zero entries — emptiness is a checker-level concern, not a shape one", () => {
    expect(validateCopyRecordShape({ id: "acme-app", entries: [] })).toEqual([]);
  });

  describe("entry id", () => {
    it("flags a missing id with id-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ text: "x", context: "y" }],
      });
      expect(findings.some((f) => f.rule === "id-shape" && f.path === "entries.0.id")).toBe(true);
    });

    it("flags an unnamespaced id (no dot) with id-well-formed", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "title", text: "x", context: "y" }],
      });
      expect(findings.some((f) => f.rule === "id-well-formed" && f.path === "entries.0.id")).toBe(true);
    });

    it("flags an uppercase id with id-well-formed", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "Pagination.NoResults", text: "x", context: "y" }],
      });
      expect(findings.some((f) => f.rule === "id-well-formed")).toBe(true);
    });

    it("accepts a multi-segment, kebab-case, dot-separated id", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "onboarding.step-2.title", text: "x", context: "y" }],
      });
      expect(findings).toEqual([]);
    });

    it("flags a duplicate id across two entries as id-unique, on the second occurrence", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [
          { id: "pagination.no-results", text: "a", context: "c1" },
          { id: "pagination.no-results", text: "b", context: "c2" },
        ],
      });
      const dupe = findings.find((f) => f.rule === "id-unique");
      expect(dupe).toBeDefined();
      expect(dupe?.path).toBe("entries.1.id");
    });

    it("does not double-report a duplicate id also as unique when the id itself is malformed", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [
          { id: "", text: "a", context: "c1" },
          { id: "", text: "b", context: "c2" },
        ],
      });
      expect(findings.some((f) => f.rule === "id-unique")).toBe(false);
      expect(findings.filter((f) => f.rule === "id-shape")).toHaveLength(2);
    });
  });

  describe("text and context", () => {
    it("flags an empty text as text-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "", context: "y" }],
      });
      expect(findings.some((f) => f.rule === "text-shape" && f.path === "entries.0.text")).toBe(true);
    });

    it("flags a whitespace-only text as text-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "   \n\t", context: "y" }],
      });
      expect(findings.some((f) => f.rule === "text-shape")).toBe(true);
    });

    it("flags a missing context as context-shape — an unlocatable entry cannot be reviewed", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "x" }],
      });
      expect(findings.some((f) => f.rule === "context-shape" && f.path === "entries.0.context")).toBe(true);
    });
  });

  describe("placeholders — the real check", () => {
    it("passes when every declared placeholder is present in text", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [
          {
            id: "pagination.range",
            text: "Showing {start}–{end} of {total} results.",
            context: "footer",
            placeholders: ["start", "end", "total"],
          },
        ],
      });
      expect(findings).toEqual([]);
    });

    it("flags a declared placeholder that does not appear in text — a real authoring bug, not decoration", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [
          {
            id: "pagination.range",
            text: "Showing {start}–{end} of results.", // "total" was dropped
            context: "footer",
            placeholders: ["start", "end", "total"],
          },
        ],
      });
      const finding = findings.find((f) => f.rule === "placeholder-missing-from-text");
      expect(finding).toBeDefined();
      expect(finding?.path).toBe("entries.0.placeholders.2");
      expect(finding?.message).toMatch(/"total"/);
    });

    it("does not require the braces themselves to be declared in placeholders — only the bare name", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "Hello {name}.", context: "y", placeholders: ["name"] }],
      });
      expect(findings).toEqual([]);
    });

    it("flags a non-array placeholders with placeholders-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "x", context: "y", placeholders: "start" }],
      });
      expect(findings.some((f) => f.rule === "placeholders-shape")).toBe(true);
    });

    it("flags a non-string placeholder item with placeholders-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "Hi {name}.", context: "y", placeholders: ["name", 5] }],
      });
      expect(findings.some((f) => f.rule === "placeholders-shape" && f.path === "entries.0.placeholders.1")).toBe(
        true,
      );
    });

    it("does not also report placeholder-missing-from-text when placeholders itself is malformed", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "x", context: "y", placeholders: "start" }],
      });
      expect(findings.some((f) => f.rule === "placeholder-missing-from-text")).toBe(false);
    });

    it("omitting placeholders entirely is valid — most copy has none", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "No results found.", context: "y" }],
      });
      expect(findings).toEqual([]);
    });
  });

  describe("factRef", () => {
    it("is valid when omitted", () => {
      expect(
        validateCopyRecordShape({ id: "acme-app", entries: [{ id: "a.b", text: "x", context: "y" }] }),
      ).toEqual([]);
    });

    it("flags an empty-string factRef as fact-ref-shape", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "x", context: "y", factRef: "" }],
      });
      expect(findings.some((f) => f.rule === "fact-ref-shape")).toBe(true);
    });

    it("never resolves factRef against anything — a nonsense string is still a valid, well-formed one", () => {
      const findings = validateCopyRecordShape({
        id: "acme-app",
        entries: [{ id: "a.b", text: "x", context: "y", factRef: "definitely-not-a-real-fact" }],
      });
      expect(findings).toEqual([]);
    });
  });

  it("flags every malformed entry in a list, not just the first", () => {
    const findings = validateCopyRecordShape({
      id: "acme-app",
      entries: [
        { id: "a.b", text: "", context: "y" },
        { id: "c.d", text: "x", context: "" },
      ],
    });
    expect(findings.some((f) => f.path === "entries.0.text")).toBe(true);
    expect(findings.some((f) => f.path === "entries.1.context")).toBe(true);
  });

  it("rejects a non-object entry with entry-shape rather than throwing", () => {
    const findings = validateCopyRecordShape({ id: "acme-app", entries: ["not an object", null, 5] });
    expect(findings.filter((f) => f.rule === "entry-shape")).toHaveLength(3);
  });
});

describe("parseCopyRecord", () => {
  it("returns a parsed CopyRecord for valid input", () => {
    const parsed = parseCopyRecord(validRecord);
    expect(parsed.id).toBe("acme-app");
    expect(parsed.entries).toHaveLength(2);
  });

  it("defaults a missing placeholders to []", () => {
    const parsed = parseCopyRecord({
      id: "acme-app",
      entries: [{ id: "a.b", text: "No results found.", context: "y" }],
    });
    expect(parsed.entries[0]?.placeholders).toEqual([]);
  });

  it("does not mutate the input array it copies placeholders from", () => {
    const placeholders = ["name"];
    const record: CopyRecord = {
      id: "acme-app",
      entries: [{ id: "a.b", text: "Hi {name}.", context: "y", placeholders }],
    };
    const parsed = parseCopyRecord(record);
    parsed.entries[0]?.placeholders?.push("extra");
    expect(placeholders).toEqual(["name"]);
  });

  it("throws a plain Error, listing every issue, for invalid input", () => {
    expect(() => parseCopyRecord({ id: "" })).toThrowError(/parseCopyRecord: value is not a valid CopyRecord/);
    try {
      parseCopyRecord(null);
      expect.unreachable("parseCopyRecord should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/must be an object/);
    }
  });

  it("throws listing a dropped placeholder by name", () => {
    expect(() =>
      parseCopyRecord({
        id: "acme-app",
        entries: [{ id: "pagination.range", text: "Showing {start} of results.", context: "y", placeholders: ["start", "total"] }],
      }),
    ).toThrowError(/"total"/);
  });
});
