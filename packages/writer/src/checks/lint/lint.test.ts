import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { mainWriterLibrary } from "../../cli.js";
import type { LexiconRecord, PageNarrative, PassageRecord, StringRecord, WriterLibrary, WriterRecord } from "../../model/types.js";
import { checkWriterLint } from "./index.js";
import { compileLexiconRules, runRetextRules } from "./rules.js";
import { writerLintTargets } from "./targets.js";

const base = { context: "Example", status: "draft", origin: "authored" } as const;
const term = (word = "utilize", extra: Partial<Extract<LexiconRecord, { kind: "term" }>> = {}): LexiconRecord => ({
  ...base, id: "lx.0000000001", leaf: "lexicon.avoid-terms", kind: "term", term: word, forms: [], termStatus: "avoid", reason: "Use plain language", ...extra,
});
const string = (text: string, id: StringRecord["id"] = "st.0000000001"): StringRecord => ({ ...base, id, leaf: "strings.actions", text });
const passage = (id: PassageRecord["id"] = "ps.0000000001", stringId: StringRecord["id"] = "st.0000000001"): PassageRecord => ({
  ...base, id, leaf: "passages.band", schema: "passages.band", schemaDigest: "example", fields: { heading: { ref: "string", id: stringId } },
});
const page = (passages: PageNarrative["passages"] = ["ps.0000000001"]): PageNarrative => ({
  ...base, id: "nr.0000000001", leaf: "narratives.page-story", frame: { frameId: "frames.page" }, passages,
});
const library = (records: WriterRecord[], locale = "en"): WriterLibrary => ({
  manifest: { consumer: "example", defaultLocale: locale, locales: [{ tag: locale, dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { [locale]: { records, documents: [] } },
});
const pattern = (source: string): LexiconRecord => ({ ...base, id: "lx.0000000002", leaf: "lexicon.avoid-patterns", kind: "pattern-rule", pattern: { source, flags: "i" }, severity: "warning", reason: "Avoid jargon" });

describe("Writer WR5 lint", () => {
  it("names one lexicon finding for a referenced string, passage, and assembled page", () => {
    const value = library([term(), string("Please utilize this"), passage(), page()]);
    const findings = checkWriterLint(value);
    expect(findings).toHaveLength(3);
    for (const recordId of ["st.0000000001", "ps.0000000001", "nr.0000000001"]) {
      const matches = findings.filter(finding => finding.recordId === recordId);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ code: "WR5", severity: "error", locale: "en", message: expect.stringContaining("lx.0000000001") });
      expect(matches[0]!.message).toMatch(/utilize/i);
    }
    expect(writerLintTargets(value).filter(target => target.recordId === "nr.0000000001")).toEqual([
      expect.objectContaining({ field: "assembled", text: "Please utilize this" }),
    ]);
    expect(checkWriterLint(library([term(), string("Please use this"), passage(), page()]))).toEqual([]);
  });

  it("checks phrases across passage boundaries only on the assembled page", () => {
    const records = [term("bad idea"), string("bad"), string("idea", "st.0000000002"), passage(), passage("ps.0000000002", "st.0000000002"), page(["ps.0000000001", "ps.0000000002"])];
    expect(checkWriterLint(library(records))).toEqual([
      expect.objectContaining({ code: "WR5", recordId: "nr.0000000001", field: "assembled", message: expect.stringContaining("lx.0000000001") }),
    ]);
  });

  it.each(["en", "en-US", "en-GB"])("runs English rules for %s", locale => {
    expect(checkWriterLint(library([term(), string("utilize")], locale))).toHaveLength(1);
  });

  it("skips non-English text and external legal wording including references", () => {
    expect(checkWriterLint(library([term(), string("utilize")], "fr"))).toEqual([]);
    const external: StringRecord = { ...string("utilize"), origin: "external", external: { publisher: "Example", reference: "Terms", retrievedAt: "2026-01-01" } };
    expect(checkWriterLint(library([term(), external, passage(), page()]))).toEqual([]);
  });

  it("preserves an external passage as a barrier between authored page wording", () => {
    const external: StringRecord = { ...string("legal terms", "st.0000000002"), origin: "external", external: { publisher: "Example", reference: "Terms", retrievedAt: "2026-01-01" } };
    expect(checkWriterLint(library([
      term("bad idea"), string("bad"), external, string("idea", "st.0000000003"),
      passage(), passage("ps.0000000002", external.id), passage("ps.0000000003", "st.0000000003"),
      page(["ps.0000000001", "ps.0000000002", "ps.0000000003"]),
    ]))).toEqual([]);
  });

  it("skips retired rules and retired records including referenced wording", () => {
    expect(checkWriterLint(library([{ ...term(), status: "retired" }, string("utilize")]))).toEqual([]);
    expect(checkWriterLint(library([term(), { ...string("utilize"), status: "retired" }, passage(), page()]))).toEqual([]);
  });

  it("does not treat preferred-term metadata as a banned vocabulary", () => {
    expect(checkWriterLint(library([term("utilize", { termStatus: "preferred", alternative: "use", reason: "Never utilize this metadata" }), string("utilize use")]))).toEqual([]);
  });

  it("lints ICU prose without treating control words or argument names as wording", () => {
    expect(checkWriterLint(library([term("other"), string("{n, plural, one {Save} other {Continue}}")]))).toEqual([]);
    expect(checkWriterLint(library([term("username"), string("Welcome {username}")]))).toEqual([]);
    expect(checkWriterLint(library([pattern("."), string("{username}")]))).toEqual([]);
  });

  it("keeps mutually exclusive ICU branches separate while retaining surrounding prose", () => {
    expect(checkWriterLint(library([term("bad idea"), string("{n, select, first {bad} other {idea}}")]))).toEqual([]);
    expect(checkWriterLint(library([term("bad idea"), string("bad {n, select, first {idea} other {plan}}")]))).toEqual([
      expect.objectContaining({ code: "WR5", recordId: "st.0000000001", message: expect.stringContaining("lx.0000000001") }),
    ]);
  });

  it("finds banned ICU branch prose once per subject across matching variants", () => {
    expect(checkWriterLint(library([term(), string("{n, select, first {utilize this} other {utilize that}}")]))).toEqual([
      expect.objectContaining({ code: "WR5", recordId: "st.0000000001", message: expect.stringContaining("lx.0000000001") }),
    ]);
  });

  it("reports ICU variant overflow as named incomplete WR5 instead of clean", () => {
    const text = Array.from({ length: 9 }, (_, index) => `{a${index}, select, x {a} other {b}}`).join(" ");
    expect(checkWriterLint(library([term(), string(text)]))).toContainEqual(
      expect.objectContaining({ code: "WR5", recordId: "st.0000000001", incomplete: true, message: expect.stringContaining("WR5") }),
    );
  });

  it("uses whole words and deduplicates repeated forms", () => {
    const compiled = compileLexiconRules([term("utilize", { forms: ["utilize", "UTILIZE", "utilized", "utilized"] })]);
    expect(compiled.issues).toEqual([]);
    expect(runRetextRules("superutilize utilizedness", compiled.rules)).toEqual([]);
    expect(runRetextRules("UTILIZE", compiled.rules)).toEqual([expect.objectContaining({ ruleId: "lx.0000000001", severity: "error" })]);
    expect(runRetextRules("utilized", compiled.rules)).toHaveLength(1);
  });

  it("normalizes phrase spacing and preserves hyphenated token boundaries", () => {
    const rules = compileLexiconRules([term("bad idea"), term("world-class", { id: "lx.0000000003" })]).rules;
    expect(runRetextRules("BAD   IDEA and world-class", rules).map(match => match.ruleId)).toEqual(["lx.0000000001", "lx.0000000003"]);
    expect(runRetextRules("bad ideal and world-classified", rules)).toEqual([]);
  });

  it("compiles voice forbidden words as errors and safe patterns with their authored severity", () => {
    const voice: LexiconRecord = { ...base, id: "lx.0000000004", leaf: "lexicon.formality", kind: "voice-rule", rule: "formality", value: "plain", forbidden: ["utilize"] };
    expect(checkWriterLint(library([voice, string("utilize")]))).toEqual([
      expect.objectContaining({ code: "WR5", severity: "error", message: expect.stringContaining(voice.id) }),
    ]);
    expect(checkWriterLint(library([pattern("\\butilize\\b"), string("UTILIZE")]))).toEqual([
      expect.objectContaining({ code: "WR5", severity: "warning", message: expect.stringContaining("lx.0000000002") }),
    ]);
  });

  it("reports refused unsafe regexes as named incomplete WR5 findings", () => {
    const unsafe = pattern("(a+)+$");
    const compiled = compileLexiconRules([unsafe]);
    expect(compiled.rules).toEqual([]);
    expect(compiled.issues).toEqual([expect.objectContaining({ recordId: unsafe.id, message: expect.any(String) })]);
    expect(checkWriterLint(library([unsafe, string(`${"a".repeat(10000)}!`) ]))).toEqual([
      expect.objectContaining({ code: "WR5", severity: "error", incomplete: true, recordId: unsafe.id }),
    ]);
  });

  it("registers WR5 in the actual library CLI JSON report", () => {
    const root = mkdtempSync(join(tmpdir(), "writer-wr5-cli-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      cpSync(fileURLToPath(new URL("../../../fixtures/library-clean", import.meta.url)), root, { recursive: true });
      mkdirSync(join(root, "en/lexicon"), { recursive: true });
      writeFileSync(join(root, "en/lexicon/terms.json"), JSON.stringify([term("Save")]));
      expect(mainWriterLibrary([root, "--format", "json"])).toBe(1);
      const report = JSON.parse(log.mock.calls.map(call => call.map(String).join(" ")).join("\n")) as { findings: { code: string; recordId?: string; message: string }[] };
      expect(report.findings.filter(finding => finding.code === "WR5")).toEqual([
        expect.objectContaining({ code: "WR5", recordId: "st.0000000001", message: expect.stringContaining("lx.0000000001") }),
      ]);
    } finally {
      log.mockRestore(); error.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
