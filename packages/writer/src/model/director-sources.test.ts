import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWriterCell, serializeWriterCell, type WriterCell } from "../cells/parse.js";
import { loadWriterLibrary } from "../loader/index.js";
import { validateWriterRecord } from "./validate.js";

const source = { ref: "director:identity.verbal.voice@2", line: 14 };
const common = { context: "example.voice", status: "draft", origin: "authored" };
const records = [
  { ...common, id: "lx.0000000001", leaf: "lexicon.voice", kind: "voice-rule", rule: "formality", value: "neutral" },
  { ...common, id: "lx.0000000002", leaf: "lexicon.preferred-terms", kind: "term", term: "Workspace", forms: ["workspaces"], termStatus: "preferred", reason: "Use consistent naming" },
];

describe("native Director source metadata", () => {
  it.each(records)("accepts genuine provenance on $kind drafts without requiring it on older records", record => {
    expect(validateWriterRecord({ ...record, directorSources: [source] }, "lexicon")).toEqual([]);
    expect(validateWriterRecord(record, "lexicon")).toEqual([]);
    expect(validateWriterRecord({ ...record, directorSources: [] }, "lexicon")).toEqual([]);
  });

  const malformed = [
    null, {}, "citation", [null], [[]], [{}], [{ ref: source.ref }], [{ line: source.line }],
    [{ ...source, extra: true }], [{ ...source, ref: null }],
    ...["identity.verbal.voice@2", "writer:identity.verbal.voice@2", "director:voice@2", "director:identity.verbal.voice@0", "director:identity.verbal.voice@02", "director:identity.verbal.voice@9007199254740992", "director:identity.verbal.voice@2#L14", `${source.ref}\n`].map(ref => [{ ...source, ref }]),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "14", null].map(line => [{ ...source, line }]),
  ];
  it.each(malformed.map((directorSources, index) => ({ directorSources, index })))("rejects malformed provenance case $index on both record kinds", ({ directorSources }) => {
    for (const record of records) {
      expect(validateWriterRecord({ ...record, directorSources }, "lexicon")).toContainEqual(expect.objectContaining({ code: "WR1", path: expect.stringMatching(/^record\.directorSources/) }));
    }
  });

  it("round-trips native draft citations into schema-valid library records", () => {
    const cell: WriterCell = {
      id: "example.voice", version: 1, status: "draft", updated: "2026-10-29",
      links: [source.ref], locales: ["en"],
      records: records.map(record => ({ locale: "en", record: { ...record, directorSources: [source] }, bindings: [] })),
    };
    const parsed = parseWriterCell(serializeWriterCell(cell));
    expect(parsed).toEqual(cell);
    for (const item of parsed.records) {
      expect(validateWriterRecord(item.record, "lexicon")).toEqual([]);
      expect(item.record).toMatchObject({ status: "draft", directorSources: [source] });
      expect(item.record).not.toHaveProperty("approval");
    }
    const root = mkdtempSync(join(realpathSync(tmpdir()), "writer-provenance-"));
    try {
      writeFileSync(join(root, "writer.json"), JSON.stringify({
        consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en",
        locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {},
        strategy: { root: "../strategy", contract: "writer.messaging" },
        leafFreeze: { lexicon: "1", strings: "1", patterns: "1", passages: "1", narratives: "1" },
      }));
      mkdirSync(join(root, "en/lexicon"), { recursive: true });
      const restored = parsed.records.map(item => item.record);
      writeFileSync(join(root, "en/lexicon/voice.json"), JSON.stringify(restored));
      const loaded = loadWriterLibrary(root);
      expect(loaded.issues).toEqual([]);
      expect(loaded.exitCode).toBe(0);
      expect(loaded.library?.locales.en?.records).toEqual(restored);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
