import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { validateWriterRecord } from "../../model/validate.js";
import type { StringRecord, WriterLibrary } from "../../model/types.js";
import { checkWriterICU } from "../../checks/icu.js";
import { directionFor } from "../../locale.js";

interface Envelope {
  state: string; activation: string; locale: string; direction?: string;
  aliases?: Record<string, string>; records: StringRecord[];
  bindings: { cellId: string; recordId: string; target: string; kind: string }[];
  externalRecords?: { recordId: string; source: string; sourceContext: string }[];
  coverage?: { proposedBindings: number };
}
const read = (path: string): Envelope => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const english = () => read("../records/admin-pages.r1.en.json");
const arabic = () => read("./admin-pages.r1.ar.json");
const sources = () => ["admin-pages.r1.en.json", "admin-studio.r1.en.json", "admin-chat.r1.en.json", "common-labels.r1.en.json", "admin-writer-paging.r1.en.json"].map(source => ({ source, envelope: read(`../records/${source}`) }));
const allRecords = () => sources().flatMap(source => source.envelope.records);
const library = (records: StringRecord[], ar?: Envelope): WriterLibrary => ({
  manifest: { consumer: "admin-pages-fixture", messageSyntax: "icu-mf1", defaultLocale: "en",
    locales: [{ tag: "en", dir: "ltr", state: "active" }, ...(ar ? [{ tag: "ar", dir: "rtl", state: "active" } as const] : [])],
    fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records, documents: [] }, ...(ar ? { ar: { records: ar.records, documents: [] } } : {}) },
});

it("allows many page bindings per canonical draft record and resolves every external source explicitly", () => {
  const en = english(), sourceRows = sources(), records = sourceRows.flatMap(row => row.envelope.records), ids = records.map(record => record.id);
  expect(en).toMatchObject({ state: "draft", activation: "none", locale: "en" });
  expect(new Set(ids).size).toBe(ids.length);
  expect(en.bindings).toHaveLength(363);
  expect(Object.keys(en.aliases!)).toHaveLength(363);
  expect(en.coverage?.proposedBindings).toBe(en.bindings.length);
  expect(new Set(en.bindings.map(binding => binding.cellId)).size).toBe(en.bindings.length);
  expect(new Set(en.bindings.map(binding => binding.recordId)).size).toBeLessThan(en.bindings.length);
  for (const binding of en.bindings) {
    expect(en.aliases![binding.cellId]).toBe(binding.recordId);
    const record = records.find(record => record.id === binding.recordId)!;
    expect(record, binding.cellId).toBeDefined();
    expect(validateWriterRecord(record, "strings"), binding.cellId).toEqual([]);
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(binding).toMatchObject({ target: expect.stringMatching(/^(sections|frames)\./), kind: "CopyRef" });
    if (!en.records.some(local => local.id === record.id)) {
      const source = sourceRows.find(source => source.envelope.records.some(local => local.id === record.id))!;
      expect(en.externalRecords).toContainEqual({ recordId: record.id, source: source.source, sourceContext: record.context });
    }
  }
});

it("keeps every consumed IA heading bound after canonical record sharing", () => {
  const en = english(), sourceRows = sources(), records = sourceRows.flatMap(row => row.envelope.records);
  const common = read("../records/common-labels.r1.en.json") as Envelope & { usages: { source: string; context: string; recordId: string }[] };
  const source = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const [owner, layers] of Object.entries({ writer: ["lexicon", "strings", "patterns", "passages", "narratives"], designer: ["tokens", "assets", "components", "sections", "frames"] })) {
    for (const layer of layers) {
      const path = owner === "writer" ? `../ia/${layer}.json` : `../../../../designer/src/catalog/ia/${layer}.json`;
      for (const node of source(path).nodes) for (const heading of [node, ...(node.children ?? [])]) {
        const key = `strings.admin.ia.${owner}.${layer}.${heading.id}`, id = en.aliases![key];
        if (owner === "writer") expect(records.find(record => record.id === id)?.text, key).toBe(heading.label);
        else {
          // Designer display copy is authored independently from raw IA labels.
          const context = `designer.ia.${layer}.${heading.id}`;
          const original = sourceRows.find(row => row.source === "admin-studio.r1.en.json")!.envelope.records.find(record => record.context === context);
          expect(original?.id ?? common.usages.find(usage => usage.source === "records/admin-studio.r1.en.json" && usage.context === context)?.recordId, key).toBe(id);
        }
        expect(en.bindings.find(binding => binding.cellId === key)?.recordId).toBe(id);
      }
    }
  }
});

it("formats shared page counters without freezing data values", () => {
  const en = english(), records = allRecords();
  expect(checkWriterICU(library(records))).toEqual([]);
  const format = (key: string, values: Record<string, string | number>) => new IntlMessageFormat(records.find(record => record.id === en.aliases![`strings.admin.${key}`])!.text, "en").format(values);
  expect(format("action.showAll", { count: 137 })).toBe("Show all (137)");
  expect(format("stats.total", { count: 1 })).toBe("1 record");
  expect(format("stats.total", { count: 2 })).toBe("2 records");
});

it("preserves exactly two native Arabic drafts with canonical English IDs and semantic bindings", () => {
  const en = allRecords(), ar = arabic(), content = library(en, ar);
  expect(ar).toMatchObject({ state: "draft", activation: "none", locale: "ar", direction: "rtl" });
  expect(ar.records).toHaveLength(2); expect(ar.bindings).toHaveLength(2);
  expect(directionFor("ar", content.manifest)).toBe("rtl");
  expect(checkWriterICU(content)).toEqual([]);
  for (const record of ar.records) {
    expect(validateWriterRecord(record, "strings")).toEqual([]);
    expect(en.find(source => source.id === record.id)).toMatchObject({ context: record.context, leaf: record.leaf });
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(record.text).toMatch(/[\u0600-\u06ff]/);
    const binding = ar.bindings.find(binding => binding.recordId === record.id)!;
    expect(ar.aliases![binding.cellId]).toBe(record.id);
  }
});

it("resolves all 363 bindings through the authentic P1b copy consumer with declared shared sources", async () => {
  const { prepareAdminPageCopyEnvelopes } = await import("../../../../publisher/src/web/pages/admin-copy-source.js");
  const { createAdminPageCopy } = await import("../../../../publisher/src/web/pages/admin-copy.js");
  const sourceRows = sources(), records = sourceRows.flatMap(row => row.envelope.records);
  const copy = createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes([...sourceRows, { source: "admin-pages.r1.ar.json", envelope: arabic() }]) });
  for (const binding of english().bindings) {
    const record = records.find(record => record.id === binding.recordId)!;
    const values = Object.fromEntries((record.args ?? []).map(arg => [arg.name, ["number", "plural", "date"].includes(arg.type) ? 2 : "Writer"]));
    const result = copy.resolve({ id: binding.cellId, ...(Object.keys(values).length ? { values } : {}) });
    expect(result.text.trim(), binding.cellId).not.toBe("");
    expect(result.provenance).toMatchObject({ cellId: binding.cellId, recordId: binding.recordId, locale: "en", status: "draft", activation: "none" });
  }
  expect(copy({ id: "strings.admin.page.writer", locale: "ar" })).toBe("الكاتب");
  expect(copy({ id: "strings.admin.column.text", locale: "ar" })).toBe("النص");
});
