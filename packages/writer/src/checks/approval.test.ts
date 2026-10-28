import { describe, expect, it } from "vitest";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "../fingerprint.js";
import type { ChromeNarrative, LexiconRecord, LongFormNarrative, PageNarrative, PassageRecord, PatternInstance, RecordBase, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import { checkWriterApproval, resolveWriterRefText, writerRecordFingerprint, writerRecordText } from "./approval.js";

const base = (id: RecordBase["id"], leaf: RecordBase["leaf"]): RecordBase => ({ id, leaf, context: "Example", status: "approved", origin: "authored" });
const string = (): StringRecord => ({ ...base("st.0123456789", "strings.button-label"), text: "Continue" });
const term = (): LexiconRecord => ({ ...base("lx.0123456789", "lexicon.preferred-terms"), kind: "term", term: "Example", forms: [], termStatus: "preferred", reason: "Clear" });
const pattern = (): PatternInstance => ({ ...base("pt.0123456789", "patterns.headline-subhead"), parts: { headline: { ref: { kind: "string", id: "st.0123456789" } }, subhead: { text: "Example detail" } } });
const passage = (): PassageRecord => ({ ...base("ps.0123456789", "passages.hero"), schema: "passages.hero", schemaDigest: "example", fields: { headline: { ref: "pattern", id: "pt.0123456789", part: "headline" }, label: { ref: "term", id: "lx.0123456789" } } });
const chrome = (): ChromeNarrative => ({ ...base("nr.0123456789", "narratives.chrome"), frame: { frameId: "frames.example", configId: "example" }, regions: { header: { title: { ref: "string", id: "st.0123456789" } } } });
const page = (): PageNarrative => ({ ...base("nr.123456789a", "narratives.page"), frame: { frameId: "frames.example" }, chrome: "nr.0123456789", passages: ["ps.0123456789"] });
const longform = (): LongFormNarrative => ({ ...base("nr.23456789ab", "narratives.article"), title: "st.0123456789", frame: { frameId: "frames.example" }, blocks: [{ type: "paragraph", designer: { id: "components.example", configId: "example" }, text: "Example body", children: [{ type: "quote", designer: { id: "components.example", configId: "example" }, text: "Example quote" }] }] });

function library(records: WriterRecord[]): WriterLibrary {
  return { manifest: { consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "a", strings: "b", patterns: "c", passages: "d", narratives: "e" } }, locales: { en: { records, documents: [] } } };
}
function approve(records: WriterRecord[]): WriterRecord[] {
  return records.map(record => ({ ...record, approval: { approvedBy: "owner", approvedAt: "2026-01-01T00:00:00Z", textFingerprint: writerRecordFingerprint(record, records), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM } }));
}

describe("Writer semantic approval subjects", () => {
  it("preserves legacy raw String fingerprints", () => {
    const record = string();
    expect(writerRecordText(record, [record])).toBe(record.text);
    expect(writerRecordFingerprint(record, [record])).toBe(computeCopyFingerprint(record.text));
  });
  it("canonicalizes semantic object members and ignores bookkeeping", () => {
    const record = pattern();
    const reordered: PatternInstance = { ...record, status: "draft", context: "Updated context", origin: "foundry-default", parts: { subhead: record.parts.subhead!, headline: record.parts.headline! } };
    expect(writerRecordFingerprint(record, [string(), record])).toBe(writerRecordFingerprint(reordered, [reordered, string()]));
    expect(writerRecordFingerprint({ ...record, parts: { ...record.parts, subhead: { text: "Changed" } } }, [string()])).not.toBe(writerRecordFingerprint(record, [string()]));
  });
  it("resolves String, term, and selected Pattern part wording without JSON wrappers", () => {
    const records = [string(), term(), pattern()];
    expect(resolveWriterRefText({ ref: "string", id: "st.0123456789" }, records)).toBe("Continue");
    expect(resolveWriterRefText({ ref: "term", id: "lx.0123456789" }, records)).toBe("Example");
    expect(resolveWriterRefText({ ref: "pattern", id: "pt.0123456789", part: "headline" }, records)).toBe("Continue");
  });
  it("propagates referenced wording changes through all composite layers", () => {
    const records: WriterRecord[] = [string(), term(), pattern(), passage(), chrome(), page(), longform()];
    const changed = records.map(record => "text" in record ? { ...record, text: "Proceed" } : record);
    for (const record of records.filter(record => !("text" in record) && !("kind" in record))) {
      expect(writerRecordFingerprint(record, changed)).not.toBe(writerRecordFingerprint(record, records));
    }
  });
  it("includes long-form block text, nested text, and literal titles", () => {
    const record = longform();
    const original = writerRecordFingerprint(record, [string()]);
    expect(writerRecordFingerprint({ ...record, title: "Literal title" }, [string()])).not.toBe(original);
    expect(writerRecordFingerprint({ ...record, blocks: [{ ...record.blocks[0]!, text: "Changed body" }] }, [string()])).not.toBe(original);
    expect(writerRecordFingerprint({ ...record, blocks: [{ ...record.blocks[0]!, children: [{ ...record.blocks[0]!.children![0]!, text: "Changed quote" }] }] }, [string()])).not.toBe(original);
  });
  it("uses deterministic sentinels for unresolved refs and cycles", () => {
    const record = page();
    record.passages = [record.id];
    expect(writerRecordText(record, [record])).toContain('"cycle"');
    expect(writerRecordText(record, [record])).toBe(writerRecordText(record, [record]));
    expect(writerRecordText(passage(), [])).toContain('"unresolved"');
    expect(resolveWriterRefText({ ref: "pattern", id: "pt.0123456789", part: "absent" }, [pattern()])).toContain("unresolved");
  });
});

describe("Writer WR11 approval", () => {
  it("accepts current owner approval on every record layer", () => {
    expect(checkWriterApproval(library(approve([string(), term(), pattern(), passage(), chrome(), page(), longform()])))).toEqual([]);
  });
  it("rejects approved status without recorded owner approval", () => {
    expect(checkWriterApproval(library([string()]))).toContainEqual(expect.objectContaining({ code: "WR11", severity: "error", recordId: "st.0123456789", field: "approval" }));
    expect(checkWriterApproval(library([{ ...string(), status: "draft" }]))).toEqual([]);
    expect(checkWriterApproval(library([{ ...string(), status: "retired" }]))).toEqual([]);
  });
  it("rejects stale text and unsupported algorithm independently", () => {
    const records = approve([string()]);
    records[0]!.approval!.fingerprintAlgorithm = "future";
    (records[0]! as StringRecord).text = "Changed";
    expect(checkWriterApproval(library(records)).map(finding => finding.field)).toEqual(["approval.fingerprintAlgorithm", "approval.textFingerprint"]);
  });
  it("invalidates approved composites when their referenced wording changes", () => {
    const records = approve([string(), pattern(), passage(), chrome(), page(), longform()]);
    (records[0]! as StringRecord).text = "Changed";
    expect(checkWriterApproval(library(records)).filter(finding => finding.field === "approval.textFingerprint")).toHaveLength(records.length);
  });
  it("does not grant delegate clearance or accept delegate metadata on owner records", () => {
    const records = approve([string()]);
    records[0]!.approval!.approvedBy = "delegate";
    expect(checkWriterApproval(library(records))).toContainEqual(expect.objectContaining({ field: "approval.approvedBy", severity: "error" }));
    records[0]!.approval!.approvedBy = "owner";
    records[0]!.approval!.pendingOwnerReview = false;
    expect(checkWriterApproval(library(records))).toContainEqual(expect.objectContaining({ field: "approval" }));
  });
  it("reports unparsed Markdown approval as a bounded limitation", () => {
    const value = library([]);
    value.locales.en!.documents.push({ path: "narratives/example.md", source: "# Example" });
    expect(checkWriterApproval(value)).toContainEqual(expect.objectContaining({ code: "WR11", path: "en/narratives/example.md", message: expect.stringContaining("WR-NARR") }));
  });
});
