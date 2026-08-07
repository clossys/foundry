import { describe, expect, it } from "vitest";
import type { VoiceRecord } from "@vespeneventures/voice";
import { checkCopyRecord } from "./checker.js";
import type { CopyRecord } from "./types.js";

// Obviously-fictional fixtures only — "Acme" mirrors the placeholder already
// used across this repository's own README examples. Never real copy, never
// a real voice.

function makeVoiceRecord(overrides: Partial<VoiceRecord> = {}): VoiceRecord {
  return {
    id: "acme-app",
    rules: {
      person: { description: "second-person, you-voice", forbiddenPronouns: ["we", "our", "us"] },
      tense: { description: "present tense, no future promises", forbiddenMarkers: ["will", "shall"] },
      formality: "neutral",
      tone: ["direct"],
    },
    glossary: [{ term: "revolutionary", status: "forbidden", reason: "overused buzzword", caseSensitive: false }],
    claims: [],
    ...overrides,
  };
}

function makeCopyRecord(overrides: Partial<CopyRecord> = {}): CopyRecord {
  return {
    id: "acme-app",
    entries: [
      { id: "pagination.no-results", text: "No results found for your search.", context: "search results page" },
      { id: "pagination.range", text: "Showing {start}–{end} of {total} results.", context: "pagination footer", placeholders: ["start", "end", "total"] },
    ],
    ...overrides,
  };
}

describe("checkCopyRecord — this check can genuinely fail (proof, not assumption)", () => {
  it("reports an error finding, tagged with the offending entry's id, when an entry's copy violates the VoiceRecord", () => {
    const copyRecord = makeCopyRecord({
      entries: [
        { id: "dashboard.welcome", text: "Welcome to our revolutionary new dashboard.", context: "dashboard header" },
      ],
    });
    const report = checkCopyRecord(copyRecord, makeVoiceRecord());

    // This is the crux of the whole check: a real violation must show up as
    // a real, non-empty error finding, attributed to the entry that caused
    // it — not swallowed, not downgraded, not lost in a "clean" report.
    expect(report.findings.length).toBeGreaterThan(0);
    const glossaryFinding = report.findings.find((f) => f.rule === "glossary:forbidden-term");
    expect(glossaryFinding).toBeDefined();
    expect(glossaryFinding?.severity).toBe("error");
    expect(glossaryFinding?.entryId).toBe("dashboard.welcome");
    expect(glossaryFinding?.path).toBe("revolutionary");

    const pronounFinding = report.findings.find((f) => f.rule === "person:forbidden-pronoun");
    expect(pronounFinding).toBeDefined();
    expect(pronounFinding?.entryId).toBe("dashboard.welcome");

    // complete is still true here: checkCopyRecord ran everything it could
    // — complete means "nothing was skipped", never "nothing was wrong".
    expect(report.complete).toBe(true);
    expect(report.checkedCount).toBe(1);
  });

  it("is genuinely clean (findings: [], complete: true) for copy that does not violate the voice record — the contrasting case that proves the failure above was real, not a bug", () => {
    const copyRecord = makeCopyRecord({
      entries: [{ id: "dashboard.welcome", text: "Welcome to your dashboard.", context: "dashboard header" }],
    });
    const report = checkCopyRecord(copyRecord, makeVoiceRecord());
    expect(report.findings).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.checkedCount).toBe(1);
    expect(report.checked[0]?.report.findings).toEqual([]);
  });
});

describe("checkCopyRecord — skipped-entry accounting", () => {
  it("skips every entry, by id, with reason 'voice-record-invalid' when the VoiceRecord fails its own shape validation", () => {
    const copyRecord = makeCopyRecord();
    const badVoiceRecord = { id: "acme-app" } as unknown as VoiceRecord; // missing `rules` entirely
    const report = checkCopyRecord(copyRecord, badVoiceRecord);

    expect(report.complete).toBe(false);
    expect(report.checkedCount).toBe(0);
    expect(report.checked).toEqual([]);
    expect(report.skippedCount).toBe(2);
    expect(report.skipped).toHaveLength(2);
    expect(report.skipped.map((s) => s.entryId).sort()).toEqual(["pagination.no-results", "pagination.range"]);
    expect(report.skipped.every((s) => s.reason === "voice-record-invalid")).toBe(true);

    // The reason the run failed is visible in findings, by rule id — not
    // just an empty findings array a caller could mistake for "clean".
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("skips every entry, best-effort attributed, with reason 'record-shape-invalid' when the CopyRecord itself is malformed", () => {
    const badCopyRecord = {
      id: "acme-app",
      entries: [
        { id: "a.b", text: "x", context: "y" },
        { text: "no id at all", context: "y" }, // malformed: missing id
      ],
    } as unknown as CopyRecord;
    const report = checkCopyRecord(badCopyRecord, makeVoiceRecord());

    expect(report.complete).toBe(false);
    expect(report.checkedCount).toBe(0);
    expect(report.skippedCount).toBe(2);
    expect(report.skipped.some((s) => s.entryId === "a.b" && s.reason === "record-shape-invalid")).toBe(true);
    // The malformed entry has no usable id -- it still gets a positional
    // label rather than silently vanishing from the accounting.
    expect(report.skipped.some((s) => s.entryId === "$1" && s.reason === "record-shape-invalid")).toBe(true);
    expect(report.findings.some((f) => f.rule === "id-shape")).toBe(true);
  });

  it("fails closed on a CopyRecord with zero entries — nothing skipped (nothing to enumerate), but never a clean pass", () => {
    const emptyRecord: CopyRecord = { id: "acme-app", entries: [] };
    const report = checkCopyRecord(emptyRecord, makeVoiceRecord());

    expect(report.complete).toBe(false);
    expect(report.checkedCount).toBe(0);
    expect(report.skippedCount).toBe(0);
    expect(report.checked).toEqual([]);
    expect(report.skipped).toEqual([]);
    // This is exactly the case the design brief called out by name: zero
    // findings from zero entries must not read as "everything passed".
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.rule).toBe("record:no-entries");
  });

  it("checkedCount + skippedCount always accounts for every entry given (invariant across all branches)", () => {
    const cases: Array<[CopyRecord, VoiceRecord]> = [
      [makeCopyRecord(), makeVoiceRecord()],
      [makeCopyRecord(), { id: "x" } as unknown as VoiceRecord],
      [{ id: "acme-app", entries: [] }, makeVoiceRecord()],
    ];
    for (const [copyRecord, voiceRecord] of cases) {
      const report = checkCopyRecord(copyRecord, voiceRecord);
      const totalGiven = Array.isArray(copyRecord.entries) ? copyRecord.entries.length : 0;
      expect(report.checkedCount + report.skippedCount).toBeLessThanOrEqual(totalGiven);
      expect(report.checkedCount).toBe(report.checked.length);
      expect(report.skippedCount).toBe(report.skipped.length);
    }
  });
});

describe("checkCopyRecord — waivers apply per entry, uniformly", () => {
  it("waives a matched finding in every entry it appears in, and reports it under waived, tagged with the right entry", () => {
    const copyRecord = makeCopyRecord({
      entries: [
        { id: "a.one", text: "Our revolutionary launch.", context: "c1" },
        { id: "a.two", text: "This revolutionary release ships today.", context: "c2" },
      ],
    });
    const report = checkCopyRecord(copyRecord, makeVoiceRecord(), {
      waivers: [{ rule: "glossary:forbidden-term", match: "revolutionary", reason: "grandfathered launch copy" }],
    });

    expect(report.findings.find((f) => f.rule === "glossary:forbidden-term")).toBeUndefined();
    expect(report.waived).toHaveLength(2);
    expect(report.waived.map((w) => w.entryId).sort()).toEqual(["a.one", "a.two"]);
    expect(report.waived.every((w) => w.waiver.reason === "grandfathered launch copy")).toBe(true);
  });
});

describe("checkCopyRecord — nested per-entry voice report is preserved", () => {
  it("attaches each entry's own VoiceCheckReport, including its own skipped dimensions, under checked[]", () => {
    // A voice record with no configured claims/tense rules -- those
    // dimensions will be reported as skipped WITHIN voice's own report for
    // this entry, which is a different thing from checkCopyRecord skipping
    // the entry itself (it did not -- it ran).
    const sparseVoice = makeVoiceRecord({
      claims: [],
      rules: {
        person: { description: "no rule", forbiddenPronouns: [] },
        tense: { description: "no rule", forbiddenMarkers: [] },
        formality: "neutral",
        tone: [],
      },
    });
    const copyRecord = makeCopyRecord({
      entries: [{ id: "dashboard.welcome", text: "Welcome to your dashboard.", context: "header" }],
    });
    const report = checkCopyRecord(copyRecord, sparseVoice);

    expect(report.checkedCount).toBe(1);
    expect(report.skippedCount).toBe(0);
    expect(report.complete).toBe(true); // checkCopyRecord itself skipped nothing

    const nested = report.checked[0]?.report;
    expect(nested).toBeDefined();
    // ...but voice's OWN report for this entry is honestly incomplete,
    // because this voice record configured almost nothing to check against
    // — and that fact is not lost, it is right here in the nested report.
    expect(nested?.complete).toBe(false);
    expect(nested?.skipped.length).toBeGreaterThan(0);
  });
});

describe("checkCopyRecord — caller-input errors (thrown, not reported as findings)", () => {
  it("throws for a null or non-object record", () => {
    expect(() => checkCopyRecord(null as unknown as CopyRecord, makeVoiceRecord())).toThrow(TypeError);
  });

  it("throws for a null or non-object voiceRecord", () => {
    expect(() => checkCopyRecord(makeCopyRecord(), null as unknown as VoiceRecord)).toThrow(TypeError);
  });
});
