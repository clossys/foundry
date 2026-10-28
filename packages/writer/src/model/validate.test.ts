import { describe, expect, it } from "vitest";
import { validateWriterManifest, validateWriterRecord } from "./index.js";
import type { WriterLayer } from "./index.js";

const base = (prefix = "st", leaf = "strings.button-label") => ({
  id: `${prefix}.0123456789`, leaf, context: "Example", status: "draft", origin: "authored",
});
const manifest = () => ({ consumer: "example", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "a", strings: "b", patterns: "c", passages: "d", narratives: "e" } });

describe("Writer WR1 shapes", () => {
  it("accepts a manifest without verifying freeze signatures or fallback resolution", () => {
    expect(validateWriterManifest({ ...manifest(), fallback: { fr: ["en"] } })).toEqual([]);
  });
  it("rejects unknown nested keys, invalid and duplicate locales, and missing defaults", () => {
    const value = manifest();
    expect(validateWriterManifest({ ...value, strategist: { path: "x", extra: true } }, "writer.json")).toContainEqual(expect.objectContaining({ code: "WR1", path: "writer.json.strategist.extra" }));
    expect(validateWriterManifest({ ...value, defaultLocale: "fr", locales: [...value.locales, { tag: "EN", dir: "ltr", state: "active" }, { tag: "bad_tag", dir: "ltr", state: "active" }] }).length).toBeGreaterThanOrEqual(3);
  });
  it("validates IDs and the expected layer independently", () => {
    expect(validateWriterRecord({ ...base(), text: "{bad ICU" }, "strings")).toEqual([]);
    for (const id of ["st.012345678", "st.012345678i", "st.012345678A", "pt.0123456789", "st.0123456789\n"]) {
      expect(validateWriterRecord({ ...base(), id, text: "x" }, "strings")).not.toEqual([]);
    }
    expect(validateWriterRecord({ ...base(), leaf: "patterns.headline", text: "x" }, "strings")).not.toEqual([]);
  });
  it("rejects unknown keys at every string nesting and invalid count limits", () => {
    for (const extra of [{ surprise: true }, { args: [{ name: "x", type: "string", extra: 1 }] }, { limits: { maxChars: Infinity } }, { limits: { maxWords: -1 } }, { limits: { maxWords: 1.5 } }, { assetRef: { assetId: "a", libraryVersion: "v", extra: true } }]) {
      expect(validateWriterRecord({ ...base(), text: "x", ...extra }, "strings")).not.toEqual([]);
    }
  });
  it("keeps approval optional and checks provenance shapes without currency gates", () => {
    expect(validateWriterRecord({ ...base(), text: "x", status: "approved" }, "strings")).toEqual([]);
    expect(validateWriterRecord({ ...base(), text: "x", approval: { approvedBy: "delegate", approvedAt: "old", textFingerprint: "old", fingerprintAlgorithm: "future", delegate: { id: "opaque", scope: ["x"] }, pendingOwnerReview: true, expiresAt: "old" }, translation: { sourceFingerprint: "old", fingerprintAlgorithm: "future", translatedAt: "old" } }, "strings")).toEqual([]);
    expect(validateWriterRecord({ ...base(), text: "x", translation: { sourceFingerprint: "x" } }, "strings")).not.toEqual([]);
  });
  it("requires external metadata exactly for external origin", () => {
    const record = { ...base(), text: "Example" };
    const external = { publisher: "example", reference: "source", retrievedAt: "timestamp" };
    expect(validateWriterRecord({ ...record, origin: "external", external }, "strings")).toEqual([]);
    expect(validateWriterRecord({ ...record, origin: "external" }, "strings")).toContainEqual(expect.objectContaining({ path: "record.external", code: "WR1" }));
    for (const origin of ["authored", "foundry-default"]) {
      expect(validateWriterRecord({ ...record, origin, external }, "strings")).toContainEqual(expect.objectContaining({ path: "record.external", code: "WR1" }));
    }
  });
  it("rejects invalid runtime layers", () => {
    expect(validateWriterRecord({ ...base(), text: "Example" }, "unknown" as WriterLayer)).toContainEqual(expect.objectContaining({ code: "WR1", path: "record" }));
  });
  it("requires discriminated lexicon fields and separate lifecycle and term status", () => {
    const term = { ...base("lx", "lexicon.preferred-terms"), kind: "term", term: "Example", forms: [], termStatus: "preferred", reason: "Clear" };
    expect(validateWriterRecord(term, "lexicon")).toEqual([]);
    expect(validateWriterRecord({ ...term, status: "preferred" }, "lexicon")).not.toEqual([]);
    expect(validateWriterRecord({ ...term, termStatus: undefined }, "lexicon")).not.toEqual([]);
    expect(validateWriterRecord({ ...base("lx", "lexicon.voice"), kind: "voice-rule", rule: "warmth", value: NaN }, "lexicon")).not.toEqual([]);
  });
  it("closes catalog pattern parts and requires mandatory parts", () => {
    const pattern = { ...base("pt", "patterns.headline-subhead"), parts: { headline: { text: "Hello" }, subhead: { ref: { kind: "string", id: "st.0123456789" } } } };
    expect(validateWriterRecord(pattern, "patterns")).toEqual([]);
    expect(validateWriterRecord({ ...pattern, parts: { headline: { text: "Hello" } } }, "patterns")).not.toEqual([]);
    expect(validateWriterRecord({ ...pattern, parts: { ...pattern.parts, extra: { text: "x" } } }, "patterns")).not.toEqual([]);
  });
  it("accepts the remaining lexicon variants and rejects malformed discriminants", () => {
    const common = base("lx", "lexicon.voice");
    const variants = [
      { kind: "voice-rule", rule: "energy", value: 2, forbidden: ["shout"] },
      { kind: "pattern-rule", pattern: { source: "[", flags: "future" }, severity: "warning", reason: "Shape only" },
      { kind: "claim", strategistClaimKey: "opaque", phrasings: ["Example"], requiresCitation: true },
      { kind: "format", format: "currency", value: { custom: [true, 2, null] } },
    ];
    for (const variant of variants) expect(validateWriterRecord({ ...common, ...variant }, "lexicon")).toEqual([]);
    expect(validateWriterRecord({ ...common, kind: "claim", strategistClaimKey: "k", phrasings: [], requiresCitation: false }, "lexicon")).not.toEqual([]);
    expect(validateWriterRecord({ ...common, kind: "format", format: "date", value: { nested: NaN } }, "lexicon")).not.toEqual([]);
    expect(validateWriterRecord({ ...common, kind: "unknown" }, "lexicon")).not.toEqual([]);
  });
  it("checks passage ref discriminants and prefixes without resolving refs", () => {
    const passage = { ...base("ps", "passages.hero"), schema: "passages.hero", schemaDigest: "unverified", fields: { title: { ref: "pattern", id: "pt.0123456789", part: "headline" } } };
    expect(validateWriterRecord(passage, "passages")).toEqual([]);
    expect(validateWriterRecord({ ...passage, id: "ps.abcdefghjk" }, "passages")).toEqual([]);
    expect(validateWriterRecord({ ...passage, binding: { slotId: "s", candidateId: "c", sectionKey: "k" } }, "passages")).toContainEqual(expect.objectContaining({ path: "record.binding", code: "WR1", message: "Unknown field" }));
    expect(validateWriterRecord({ ...passage, schema: "passages.other" }, "passages")).toContainEqual(expect.objectContaining({ path: "record.schema", code: "WR1" }));
    expect(validateWriterRecord({ ...passage, fields: { title: { ref: "string", id: "pt.0123456789" } } }, "passages")).not.toEqual([]);
  });
  it("accepts page, chrome, and recursive long-form narratives", () => {
    const narrative = base("nr", "narratives.article");
    const block = { type: "paragraph", designer: { id: "components.prose", configId: "body" }, text: "Hello" };
    expect(validateWriterRecord({ ...narrative, title: "Title", frame: { frameId: "article" }, blocks: [{ ...block, children: [block] }] }, "narratives")).toEqual([]);
    const page = { ...base("nr", "narratives.page-story"), frame: { frameId: "page" }, passages: ["ps.0123456789"] };
    expect(validateWriterRecord(page, "narratives")).toEqual([]);
    expect(validateWriterRecord({ ...page, binding: { slotId: "s", candidateId: "c" } }, "narratives")).toContainEqual(expect.objectContaining({ path: "record.binding", code: "WR1", message: "Unknown field" }));
    expect(validateWriterRecord({ ...narrative, title: "Title", frame: { frameId: "article" }, blocks: [block], binding: { slotId: "s", candidateId: "c" } }, "narratives")).toContainEqual(expect.objectContaining({ path: "record.binding", code: "WR1", message: "Unknown field" }));
    expect(validateWriterRecord({ ...base("nr", "narratives.site-chrome"), frame: { frameId: "site", configId: "main" }, regions: { footer: { text: { ref: "string", id: "st.0123456789" } } } }, "narratives")).toEqual([]);
    expect(validateWriterRecord({ ...narrative, title: "Title", frame: { frameId: "article" }, blocks: [{ ...block, timing: { startMs: 0, endMs: Infinity } }] }, "narratives")).not.toEqual([]);
  });
  it("returns issues for malformed roots and nested objects", () => {
    for (const value of [null, [], "text", 42]) expect(validateWriterRecord(value, "strings")).not.toEqual([]);
    expect(validateWriterRecord({ ...base(), text: "x", limits: null }, "strings")).not.toEqual([]);
  });
});
