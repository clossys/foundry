import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WriterLibrary, WriterRecord } from "../model/types.js";
import { canonicalWriterJSON, computeWriterReceipt, writeWriterReceipt } from "./index.js";

const record = (id: WriterRecord["id"], status: "draft" | "approved" | "retired" = "draft"): WriterRecord => ({
  id, leaf: "strings.actions", context: "Example action", status, origin: "authored", text: id,
});
const library = (): WriterLibrary => ({
  manifest: {
    consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [
      { tag: "en", dir: "ltr", state: "active" }, { tag: "fr", dir: "ltr", state: "planned" },
    ], fallback: { fr: ["en"] }, strategist: { path: "../strategist" },
    leafFreeze: { lexicon: "one", strings: "two", patterns: "three", passages: "four", narratives: "five" },
  },
  locales: {
    en: { records: [record("st.0000000001", "approved"), record("st.0000000002", "retired"), record("st.0000000003")], documents: [
      { path: "narratives/z.md", source: "# Example\n" }, { path: "narratives/a.md", source: "Opaque source\n" },
    ] },
    fr: { records: [record("st.0000000001")], documents: [] },
  },
});
const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "writer-receipt-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("canonicalWriterJSON", () => {
  it("sorts every object's keys lexicographically while preserving array order", () => {
    expect(canonicalWriterJSON({ z: { b: 2, a: 1 }, a: ["second", "first"], "10": 10, "2": 2 }))
      .toBe('{"10":10,"2":2,"a":["second","first"],"z":{"a":1,"b":2}}');
    expect(canonicalWriterJSON({ quote: '"\n', zero: -0, yes: true, empty: null })).toBe('{"empty":null,"quote":"\\\"\\n","yes":true,"zero":0}');
  });

  it("refuses values JSON cannot represent instead of losing content", () => {
    for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol("example"), { x: undefined }, [1, , 2]]) {
      expect(() => canonicalWriterJSON(value)).toThrow(TypeError);
    }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalWriterJSON(cycle)).toThrow(TypeError);
  });
});

describe("computeWriterReceipt", () => {
  it("ignores locale, object, record, document and locale declaration ordering without mutating input", () => {
    const source = library();
    const before = JSON.stringify(source);
    const reordered = library();
    reordered.manifest.locales.reverse();
    reordered.locales = { fr: reordered.locales.fr!, en: reordered.locales.en! };
    reordered.locales.en!.records.reverse();
    reordered.locales.en!.documents.reverse();
    reordered.locales.en!.records[0] = Object.fromEntries(Object.entries(reordered.locales.en!.records[0]!).reverse()) as unknown as WriterRecord;
    expect(computeWriterReceipt(reordered)).toEqual(computeWriterReceipt(source));
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.keys(computeWriterReceipt(source).locales)).toEqual(["en", "fr"]);
  });

  it("hashes complete locale content with lowercase SHA-256 and no status interpretation of markdown", () => {
    const source = library();
    const normalized = { records: source.locales.en!.records, documents: [...source.locales.en!.documents].reverse(), files: [] };
    const expected = createHash("sha256").update(canonicalWriterJSON(normalized)).digest("hex");
    const receipt = computeWriterReceipt(source);
    expect(receipt.locales.en!.digest).toBe(expected);
    expect(receipt.libraryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.locales.en!.counts).toEqual({ draft: 1, approved: 1, retired: 1, missing: 0 });
    expect(receipt.locales.fr!.counts).toEqual({ draft: 1, approved: 0, retired: 0, missing: 2 });
    source.manifest.locales.push({ tag: "de", dir: "ltr", state: "planned" });
    expect(computeWriterReceipt(source).locales.de!.counts).toEqual({ draft: 0, approved: 0, retired: 0, missing: 3 });
  });

  it("changes the relevant digest for text, status, translation metadata and opaque source changes", () => {
    const baseline = computeWriterReceipt(library());
    const changes: ((source: WriterLibrary) => void)[] = [
      (source) => { (source.locales.fr!.records[0] as { text: string }).text = "Changed example"; },
      (source) => { source.locales.fr!.records[0]!.status = "approved"; },
      (source) => { source.locales.fr!.records[0]!.translation = { sourceFingerprint: "example", fingerprintAlgorithm: "sha256", translatedAt: "2026-01-01T00:00:00Z" }; },
      (source) => { source.locales.fr!.documents.push({ path: "narratives/example.md", source: "status: approved\nOpaque text" }); },
    ];
    for (const change of changes) {
      const source = library(); change(source);
      const next = computeWriterReceipt(source);
      expect(next.libraryDigest).not.toBe(baseline.libraryDigest);
      expect(next.locales.fr!.digest).not.toBe(baseline.locales.fr!.digest);
      expect(next.locales.en!.digest).toBe(baseline.locales.en!.digest);
    }
  });

  it("preserves semantic passage order and includes manifest changes only in the library digest", () => {
    const source = library();
    source.locales.en!.records.push({
      id: "nr.0000000001", leaf: "narratives.page-story", context: "Example page", status: "draft", origin: "authored",
      frame: { frameId: "example" }, passages: ["ps.0000000001", "ps.0000000002"],
    });
    const baseline = computeWriterReceipt(source);
    const narrative = source.locales.en!.records.at(-1) as { passages: string[] };
    narrative.passages.reverse();
    expect(computeWriterReceipt(source).locales.en!.digest).not.toBe(baseline.locales.en!.digest);
    narrative.passages.reverse();
    source.manifest.consumer = "another-example";
    expect(computeWriterReceipt(source).libraryDigest).not.toBe(baseline.libraryDigest);
    expect(computeWriterReceipt(source).locales).toEqual(baseline.locales);
  });

  it("hashes JSON file locations while ignoring file and contained record id ordering", () => {
    const source = library();
    source.locales.en!.files = [
      { path: "strings/one.json", recordIds: ["st.0000000002", "st.0000000001"] },
      { path: "strings/two.json", recordIds: ["st.0000000003"] },
    ];
    const baseline = computeWriterReceipt(source);
    source.locales.en!.files.reverse();
    source.locales.en!.files[1]!.recordIds.reverse();
    expect(computeWriterReceipt(source)).toEqual(baseline);
    source.locales.en!.files[0]!.path = "strings/moved.json";
    expect(computeWriterReceipt(source).libraryDigest).not.toBe(baseline.libraryDigest);
    expect(computeWriterReceipt(source).locales.en!.digest).not.toBe(baseline.locales.en!.digest);
    expect(computeWriterReceipt(source).locales.fr).toEqual(baseline.locales.fr);
  });
});

describe("writeWriterReceipt", () => {
  it("writes only a deterministic newline-terminated receipt and ignores existing generated files", () => {
    const root = temp();
    mkdirSync(join(root, ".generated"));
    writeFileSync(join(root, ".generated", "unrelated.json"), "preserve me");
    const source = library();
    const first = writeWriterReceipt(root, source);
    const destination = join(root, ".generated", "writer-receipt.json");
    const bytes = readFileSync(destination, "utf8");
    expect(bytes).toBe(`${canonicalWriterJSON(first)}\n`);
    expect(writeWriterReceipt(root, source)).toEqual(first);
    expect(readFileSync(destination, "utf8")).toBe(bytes);
    expect(readFileSync(join(root, ".generated", "unrelated.json"), "utf8")).toBe("preserve me");
    expect(readdirSync(root)).toEqual([".generated"]);
    expect(readdirSync(join(root, ".generated")).sort()).toEqual(["unrelated.json", "writer-receipt.json"]);
    const anotherRoot = temp();
    expect(writeWriterReceipt(anotherRoot, source)).toEqual(first);
  });

  it("rejects a generated directory symlink without writing outside the root", () => {
    const root = temp(); const outside = temp();
    symlinkSync(outside, join(root, ".generated"), "dir");
    expect(() => writeWriterReceipt(root, library())).toThrow(/symlink|directory/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("rejects destination symlinks, including dangling ones, and leaves their targets untouched", () => {
    for (const existing of [true, false]) {
      const root = temp(); const outside = temp();
      const target = join(outside, "receipt.json");
      if (existing) writeFileSync(target, "preserve me");
      mkdirSync(join(root, ".generated"));
      symlinkSync(target, join(root, ".generated", "writer-receipt.json"));
      expect(() => writeWriterReceipt(root, library())).toThrow(/symlink/i);
      expect(readdirSync(outside)).toEqual(existing ? ["receipt.json"] : []);
      if (existing) expect(readFileSync(target, "utf8")).toBe("preserve me");
    }
  });
});
