import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWriterLibrary } from "./index.js";
import type { WriterManifest, WriterRecord } from "../model/types.js";
import type { CopyRef } from "../types.js";
import { computeWriterReceipt, writeWriterReceipt } from "../digest/index.js";

const manifest: WriterManifest = {
  consumer: "example", messageSyntax: "icu-mf1", defaultLocale: "en",
  locales: [{ tag: "en", dir: "ltr", state: "active" }, { tag: "fr", dir: "ltr", state: "planned" }],
  fallback: { fr: ["en"] }, strategy: { root: "../strategist", contract: "writer.messaging" },
  leafFreeze: { lexicon: "1", strings: "1", patterns: "1", passages: "1", narratives: "1" },
};
const base = { context: "Fixture copy", status: "draft", origin: "authored" } as const;
const records: WriterRecord[] = [
  { ...base, id: "lx.0000000001", leaf: "lexicon.preferred-terms", kind: "term", term: "Workspace", forms: ["workspaces"], termStatus: "preferred", reason: "Consistent naming" },
  { ...base, id: "st.0000000001", leaf: "strings.actions", text: "Continue" },
  { ...base, id: "pt.0000000001", leaf: "patterns.section-title", parts: { title: { ref: { kind: "string", id: "st.0000000001" } } } },
  { ...base, id: "ps.0000000001", leaf: "passages.hero", schema: "passages.hero", schemaDigest: "a".repeat(64), fields: { heading: { ref: "string", id: "st.0000000001" } } },
  { ...base, id: "nr.0000000001", leaf: "narratives.page-story", frame: { frameId: "frames.site-shell" }, passages: ["ps.0000000001"] },
];

let root: string;
function put(path: string, value: unknown): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}
function library(): void {
  put("writer.json", manifest);
  for (const record of records) {
    const layer = record.leaf.split(".")[0]!;
    put(`en/${layer}/fixture.json`, layer === "narratives" ? record : [record]);
  }
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "writer-loader-")); });
afterEach(() => { rmSync(root, { force: true, recursive: true }); });

describe("loadWriterLibrary", () => {
  it("loads distinct passage instances sharing one schema", () => {
    library();
    put("en/passages/fixture.json", [records[3], { ...records[3], id: "ps.0000000002" }]);
    const loaded = loadWriterLibrary(root);
    expect(loaded.exitCode).toBe(0);
    expect(loaded.issues).toEqual([]);
    const passages = loaded.library!.locales.en!.records.filter(record => "schema" in record);
    expect(passages.map(record => record.id)).toEqual(["ps.0000000001", "ps.0000000002"]);
    expect(passages.map(record => record.schema)).toEqual(["passages.hero", "passages.hero"]);
  });
  it("lets two external Publisher candidates reference the same loaded passage", () => {
    library();
    const loaded = loadWriterLibrary(root);
    expect(loaded.exitCode).toBe(0);
    const passage = loaded.library!.locales.en!.records.find(record => record.id === "ps.0000000001")!;
    const publisherCandidates = ["primary", "alternative"].map(candidateId => ({
      candidateId,
      sections: [{ slot: "hero", copy: {
        key: "heading", locale: "en", source: "writer" as const,
        ref: { id: "ps.0000000001", locale: "en" } satisfies CopyRef,
      } }],
    }));
    // Consumer-side ID lookup demonstrates reuse; Writer's future resolver owns resolution policy.
    const referencedRecords = publisherCandidates.map(candidate => {
      const reference = candidate.sections[0]!.copy.ref;
      return loaded.library!.locales[reference.locale]!.records.find(record => record.id === reference.id);
    });
    expect(publisherCandidates.map(candidate => candidate.candidateId)).toEqual(["primary", "alternative"]);
    expect(referencedRecords).toHaveLength(2);
    expect(referencedRecords[0]).toBe(passage);
    expect(referencedRecords[1]).toBe(passage);
    expect(passage).not.toHaveProperty("binding");
  });
  it.each([
    { path: "en/passages/fixture.json", record: records[3], array: true },
    { path: "en/narratives/fixture.json", record: records[4], array: false },
    { path: "en/narratives/article.json", record: { ...base, id: "nr.0000000002", leaf: "narratives.article", title: "Product story", frame: { frameId: "frames.article" }, blocks: [] }, array: false },
  ])("rejects stored consumer bindings at $path", ({ path, record, array }) => {
    library();
    const bound = { ...record, binding: { slotId: "hero", candidateId: "primary", sectionKey: "hero" } };
    put(path, array ? [bound] : bound);
    const loaded = loadWriterLibrary(root);
    expect(loaded.exitCode).toBe(1);
    expect(loaded.library).toBeNull();
    expect(loaded.issues).toContainEqual({ code: "WR1", path: `${path}${array ? "[0]" : ""}.binding`, message: "Unknown field" });
  });
  it("round-trips a loaded library receipt without changing its source identity", () => {
    library();
    const loaded = loadWriterLibrary(root);
    expect(loaded.exitCode).toBe(0);
    const receipt = writeWriterReceipt(root, loaded.library!);
    expect(receipt.locales.en?.counts).toEqual({ draft: 5, approved: 0, retired: 0, missing: 0 });
    expect(receipt.locales.fr?.counts).toEqual({ draft: 0, approved: 0, retired: 0, missing: 5 });
    expect(JSON.parse(readFileSync(join(root, ".generated/writer-receipt.json"), "utf8"))).toEqual(receipt);
    const reloaded = loadWriterLibrary(root);
    expect(reloaded.exitCode).toBe(0);
    expect(computeWriterReceipt(reloaded.library!)).toEqual(receipt);
  });
  it("loads meaningful records in all five layers and retains absent target locales", () => {
    library();
    const result = loadWriterLibrary(root);
    expect(result.issues).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.library?.locales.en?.records).toEqual(records);
    expect(result.library?.locales.fr).toEqual({ records: [], documents: [], files: [] });
    expect(result.library?.locales.en?.files).toEqual(records.map(record => ({ path: `${record.leaf.split(".")[0]}/fixture.json`, recordIds: [record.id] })));
  });
  it("keeps Markdown opaque with a locale-relative path", () => {
    library();
    const source = "---\nunparsed: [\n---\n# Story\n";
    writeFileSync(join(root, "en/narratives/story.md"), source);
    expect(loadWriterLibrary(root).library?.locales.en?.documents).toEqual([{ path: "narratives/story.md", source }]);
  });
  it("accepts narrative arrays as well as individual objects", () => {
    library();
    put("en/narratives/fixture.json", [records[4]]);
    expect(loadWriterLibrary(root).exitCode).toBe(0);
  });
  it("orders files deterministically and does not resolve manifest paths", () => {
    library();
    put("en/strings/z.json", [{ ...records[1], id: "st.0000000003", text: "Last" }]);
    put("en/strings/a.json", [{ ...records[1], id: "st.0000000002", text: "First" }]);
    const result = loadWriterLibrary(root);
    expect(result.exitCode).toBe(0);
    expect(result.library?.locales.en?.records.filter(r => r.id.startsWith("st.")).map(r => r.id)).toEqual(["st.0000000002", "st.0000000001", "st.0000000003"]);
  });
  it.each(["en/strings/bad.json", "writer.json"])("rejects malformed JSON at %s", path => {
    library();
    writeFileSync(join(root, path), "{");
    const result = loadWriterLibrary(root);
    expect(result.exitCode).toBe(1);
    expect(result.library).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "WR1", path }));
  });
  it.each([null, {}, [null], [true]])("rejects record file shape %s", value => {
    library();
    put("en/strings/fixture.json", value);
    expect(loadWriterLibrary(root).exitCode).toBe(1);
  });
  it("rejects invalid manifest shape", () => {
    put("writer.json", { defaultLocale: "en" });
    expect(loadWriterLibrary(root).exitCode).toBe(1);
  });
  it("reports duplicate record ids within a locale", () => {
    library();
    put("en/strings/other.json", [records[1]]);
    expect(loadWriterLibrary(root).issues).toContainEqual(expect.objectContaining({ code: "WR1", path: "en/strings/other.json[0].id" }));
  });
  it("allows the same id across locales and does not impose target completeness", () => {
    library();
    put("fr/strings/fixture.json", [records[1], { ...records[1], id: "st.0000000002" }]);
    expect(loadWriterLibrary(root).exitCode).toBe(0);
  });
  it("validates record prefix and leaf against its containing layer", () => {
    library();
    put("en/strings/fixture.json", [records[0]]);
    expect(loadWriterLibrary(root).exitCode).toBe(1);
  });
  it.each(["en/strings/nested", "en/mystery", "de"])("reports unknown directory %s", path => {
    library();
    mkdirSync(join(root, path));
    expect(loadWriterLibrary(root).issues).toContainEqual(expect.objectContaining({ code: "WR1", path }));
  });
  it.each(["notes.txt", "en/strings/note.md", "en/narratives/note.yaml", "en/strings/.generated"])("reports unknown file %s", path => {
    library();
    writeFileSync(join(root, path), "unrecognized");
    expect(loadWriterLibrary(root).issues).toContainEqual(expect.objectContaining({ code: "WR1", path }));
  });
  it("excludes only the root generated output", () => {
    library();
    put(".generated/nested/output.json", { unrelated: true });
    expect(loadWriterLibrary(root).exitCode).toBe(0);
  });
  it("rejects missing default locale instead of returning an empty clean library", () => {
    put("writer.json", manifest);
    expect(loadWriterLibrary(root).exitCode).toBe(1);
  });
  it("reports unavailable root or manifest as load failures", () => {
    expect(loadWriterLibrary(join(root, "absent")).exitCode).toBe(2);
    expect(loadWriterLibrary(root).issues).toContainEqual(expect.objectContaining({ code: "load", path: "writer.json" }));
  });
  it.each(["en/strings/linked.json", "en/linked", "fr"])("refuses symlinks at %s without following them", path => {
    library();
    symlinkSync(join(root, "en/strings/fixture.json"), join(root, path));
    const result = loadWriterLibrary(root);
    expect(result.exitCode).toBe(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "load", path }));
  });
  it("refuses a symlinked root and root ancestors", () => {
    library();
    symlinkSync(root, join(root, "alias"));
    expect(loadWriterLibrary(join(root, "alias")).exitCode).toBe(2);
    expect(loadWriterLibrary(join(root, "alias", "en")).exitCode).toBe(2);
  });
  it("refuses a symlinked manifest", () => {
    library();
    const source = readFileSync(join(root, "writer.json"));
    rmSync(join(root, "writer.json"));
    writeFileSync(join(root, "actual.json"), source);
    symlinkSync(join(root, "actual.json"), join(root, "writer.json"));
    expect(loadWriterLibrary(root).exitCode).toBe(2);
  });
  it("rejects invalid UTF-8 instead of substituting replacement characters", () => {
    library();
    writeFileSync(join(root, "en/narratives/bad.md"), Buffer.from([0xc3, 0x28]));
    expect(loadWriterLibrary(root).exitCode).toBe(1);
  });
  it("gives IO refusal precedence when shape findings also exist", () => {
    library();
    put("en/strings/bad.json", false);
    symlinkSync(join(root, "en/strings/fixture.json"), join(root, "en/strings/link.json"));
    const result = loadWriterLibrary(root);
    expect(result.exitCode).toBe(2);
    expect(result.issues.some(issue => issue.code === "WR1")).toBe(true);
    expect(result.issues.some(issue => issue.code === "load")).toBe(true);
  });
});
