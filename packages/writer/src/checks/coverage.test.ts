import { describe, expect, it } from "vitest";
import { COPY_FINGERPRINT_ALGORITHM } from "../fingerprint.js";
import type { LexiconRecord, PatternInstance, RecordBase, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import { writerRecordFingerprint } from "./approval.js";
import { checkWriterCoverage } from "./coverage.js";

const base = (id: RecordBase["id"], leaf: RecordBase["leaf"]): RecordBase => ({ id, leaf, context: "Example", status: "approved", origin: "authored" });
const sourceString = (): StringRecord => ({ ...base("st.0123456789", "strings.button-label"), text: "Continue" });
const sourcePattern = (): PatternInstance => ({ ...base("pt.0123456789", "patterns.headline-subhead"), parts: { headline: { ref: { kind: "string", id: "st.0123456789" } }, subhead: { text: "Example detail" } } });
function library(): WriterLibrary {
  const records: WriterRecord[] = [sourceString(), sourcePattern()];
  const translated: WriterRecord[] = records.map(record => ({ ...record, translation: { sourceFingerprint: writerRecordFingerprint(record, records), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM, translatedAt: "2026-01-01T00:00:00Z" } }));
  const files = [{ path: "strings/common.json", recordIds: [records[0]!.id] }, { path: "patterns/common.json", recordIds: [records[1]!.id] }];
  return { manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }, { tag: "fr", dir: "ltr", state: "active" }], fallback: { fr: ["en"] }, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "a", strings: "b", patterns: "c", passages: "d", narratives: "e" } }, locales: { en: { records, documents: [], files: structuredClone(files) }, fr: { records: translated, documents: [], files: structuredClone(files) } } };
}

describe("Writer WR10 declared locale coverage", () => {
  it("accepts matching files, IDs, approved statuses and current semantic provenance", () => {
    expect(checkWriterCoverage(library())).toEqual([]);
  });
  it("requires planned locales and does not infer fallback coverage", () => {
    const value = library();
    value.manifest.locales[1]!.state = "planned";
    delete value.locales.fr;
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ code: "WR10", locale: "fr", field: "locales", severity: "error" }));
  });
  it("reports missing and orphan records", () => {
    const value = library();
    value.locales.fr!.records.shift();
    value.locales.fr!.records.push({ ...sourceString(), id: "st.123456789a" });
    const findings = checkWriterCoverage(value);
    expect(findings).toContainEqual(expect.objectContaining({ recordId: "st.0123456789", message: expect.stringContaining("missing") }));
    expect(findings).toContainEqual(expect.objectContaining({ recordId: "st.123456789a", message: expect.stringContaining("Orphan") }));
  });
  it("distinguishes absent provenance, stale provenance, and unsupported algorithms", () => {
    const value = library();
    delete value.locales.fr!.records[0]!.translation;
    value.locales.fr!.records[1]!.translation!.sourceFingerprint = "old";
    value.locales.fr!.records[1]!.translation!.fingerprintAlgorithm = "future";
    expect(checkWriterCoverage(value).map(finding => finding.field)).toEqual(["translation", "translation.fingerprintAlgorithm", "translation.sourceFingerprint"]);
  });
  it("marks Strings and composites stale when source wording changes", () => {
    const value = library();
    (value.locales.en!.records[0]! as StringRecord).text = "Proceed";
    expect(checkWriterCoverage(value).filter(finding => finding.field === "translation.sourceFingerprint")).toHaveLength(2);
  });
  it("requires approved source and target content", () => {
    const value = library();
    value.locales.en!.records[0]!.status = "draft";
    value.locales.fr!.records[1]!.status = "retired";
    expect(checkWriterCoverage(value).filter(finding => finding.field === "status").map(finding => finding.locale)).toEqual(["en", "fr"]);
  });
  it("preserves source leaf and Lexicon kind even with current provenance", () => {
    const value = library();
    value.locales.fr!.records[0]!.leaf = "strings.heading";
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ recordId: "st.0123456789", field: "leaf", severity: "error" }));
    const source: LexiconRecord = { ...base("lx.0123456789", "lexicon.preferred-terms"), kind: "term", term: "Example", forms: [], termStatus: "preferred", reason: "Clear" };
    const translated: LexiconRecord = { ...base(source.id, source.leaf), kind: "claim", strategy: { cell: "advantage.proposition.proof", version: 1 }, phrasings: ["Example"], requiresCitation: true, translation: { sourceFingerprint: writerRecordFingerprint(source, [source]), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM, translatedAt: "2026-01-01T00:00:00Z" } };
    value.locales.en!.records.push(source);
    value.locales.fr!.records.push(translated);
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ recordId: source.id, field: "kind", severity: "error" }));
    expect(checkWriterCoverage(value).filter(finding => finding.field === "translation.sourceFingerprint")).toEqual([]);
  });
  it("mirrors source files even when all record IDs still exist", () => {
    const value = library();
    value.locales.fr!.files![0]!.path = "strings/other.json";
    expect(checkWriterCoverage(value).filter(finding => finding.field === "files")).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "fr/strings/common.json", message: expect.stringContaining("missing") }),
      expect.objectContaining({ path: "fr/strings/other.json", message: expect.stringContaining("Orphan") }),
    ]));
  });
  it("detects records moved between existing source files", () => {
    const value = library();
    value.locales.fr!.files![0]!.recordIds = ["pt.0123456789"];
    value.locales.fr!.files![1]!.recordIds = ["st.0123456789"];
    expect(checkWriterCoverage(value).filter(finding => finding.field === "files")).toHaveLength(4);
  });
  it("compares empty files and supports record-only in-memory libraries", () => {
    const value = library();
    value.locales.en!.files!.push({ path: "lexicon/empty.json", recordIds: [] });
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ path: "fr/lexicon/empty.json", field: "files" }));
    delete value.locales.en!.files;
    delete value.locales.fr!.files;
    expect(checkWriterCoverage(value)).toEqual([]);
  });
  it("reports missing and empty source content explicitly", () => {
    const value = library();
    value.locales.en!.records = [];
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ locale: "en", field: "records" }));
    delete value.locales.en;
    expect(checkWriterCoverage(value)).toContainEqual(expect.objectContaining({ locale: "en", field: "locales" }));
  });
  it("names unparsed Markdown limitations and missing mirrored documents", () => {
    const value = library();
    value.locales.en!.documents.push({ path: "narratives/example.md", source: "# Example" });
    expect(checkWriterCoverage(value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ locale: "en", message: expect.stringContaining("WR-NARR") }),
      expect.objectContaining({ locale: "fr", path: "fr/narratives/example.md", message: expect.stringContaining("missing") }),
    ]));
  });
});
