import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { validateWriterRecord } from "../../model/validate.js";
import type { StringRecord, WriterLibrary } from "../../model/types.js";
import { checkWriterICU } from "../../checks/icu.js";
import { directionFor } from "../../locale.js";

interface Envelope {
  state: string; activation: string; locale: string; direction?: string;
  aliases: Record<string, string>; records: StringRecord[];
  bindings: { cellId: string; recordId: string; target: string; kind: string }[];
  externalRecords?: { recordId: string; source: string; sourceContext: string }[];
}
const read = (path: string): Envelope => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const english = () => read("../records/admin-pages.r1.en.json");
const arabic = () => read("./admin-pages.r1.ar.json");
const library = (en: Envelope, ar?: Envelope): WriterLibrary => ({
  manifest: { consumer: "admin-pages-fixture", messageSyntax: "icu-mf1", defaultLocale: "en",
    locales: [{ tag: "en", dir: "ltr", state: "active" }, ...(ar ? [{ tag: "ar", dir: "rtl", state: "active" } as const] : [])],
    fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records: en.records, documents: [] }, ...(ar ? { ar: { records: ar.records, documents: [] } } : {}) },
});

it("parses registered draft records with unique opaque IDs and one complete semantic cell binding", () => {
  const en = english(), ids = en.records.map(record => record.id);
  expect(en).toMatchObject({ state: "draft", activation: "none", locale: "en" });
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(en.bindings.map(binding => binding.cellId)).size).toBe(en.bindings.length);
  expect(en.bindings).toHaveLength(en.records.length + (en.externalRecords?.length ?? 0));
  for (const record of en.records) {
    expect(validateWriterRecord(record, "strings"), record.context).toEqual([]);
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(record.context).toMatch(/^strings\.admin\./);
    expect(en.aliases[record.context]).toBe(record.id);
    expect(en.bindings.filter(binding => binding.recordId === record.id)).toEqual([
      { cellId: record.context, recordId: record.id, target: expect.stringMatching(/^(sections|frames)\./), kind: "CopyRef" },
    ]);
  }
  // Existing source IDs must not be shadowed by this new bundle.
  const existing = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (typeof row.id === "string" && typeof row.leaf === "string") existing.add(row.id);
      else Object.values(row).forEach(collect);
    }
  };
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith(".json") && entry.name !== "admin-pages.r1.en.json") collect(JSON.parse(readFileSync(file, "utf8")));
    }
  };
  visit(new URL("../records/", import.meta.url).pathname);
  for (const id of ids) expect(existing.has(id), id).toBe(false);
});

it("binds every consumed IA heading semantically and reuses existing Designer copy without duplicating it", () => {
  const en = english(), localIds = new Set(en.records.map(record => record.id));
  const source = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const layer of ["lexicon", "strings", "patterns", "passages", "narratives"]) {
    for (const node of source(`../ia/${layer}.json`).nodes) {
      for (const heading of [node, ...(node.children ?? [])]) {
        const key = `strings.admin.ia.writer.${layer}.${heading.id}`, id = en.aliases[key];
        expect(localIds.has(id!), key).toBe(true);
        expect(en.records.find(record => record.id === id)).toMatchObject({ context: key, text: heading.label });
        expect(en.bindings.find(binding => binding.cellId === key)?.recordId).toBe(id);
      }
    }
  }
  for (const node of source("../../../../publisher/src/content/tree.json").nodes) {
    for (const heading of node.children ?? []) {
      const key = `strings.admin.ia.publisher.${node.id}.${heading.id}`, id = en.aliases[key];
      expect(localIds.has(id!), key).toBe(true);
      expect(en.records.find(record => record.id === id)).toMatchObject({ context: key, text: heading.label });
    }
  }
  const existing = source("../records/admin-studio.r1.en.json").records as StringRecord[];
  for (const layer of ["tokens", "assets", "components", "sections", "frames"]) {
    for (const node of source(`../../../../designer/src/catalog/ia/${layer}.json`).nodes) {
      for (const heading of [node, ...(node.children ?? [])]) {
        const key = `strings.admin.ia.designer.${layer}.${heading.id}`, id = en.aliases[key];
        const sourceContext = `designer.ia.${layer}.${heading.id}`;
        expect(existing.find(record => record.context === sourceContext)?.id, key).toBe(id);
        expect(localIds.has(id!), key).toBe(false);
        expect(en.externalRecords).toContainEqual({ recordId: id, source: "admin-studio.r1.en.json", sourceContext });
        expect(en.bindings.find(binding => binding.cellId === key)?.recordId).toBe(id);
      }
    }
  }
});

it("covers the consumed page families and formats counters rather than freezing data values", () => {
  const en = english();
  const required = ["page.designer", "page.writer", "page.publisher", "stats.total", "stats.status", "action.showAll", "action.pinToChat", "search.placeholder", "empty.title", "noResults.title", "toggle.outline", "toggle.chat", "item.heading", "item.notFound", "pagination.range", "column.preview", "column.localeCoverage", "column.lastPublished"];
  for (const key of required) expect(en.aliases).toHaveProperty(`strings.admin.${key}`);
  for (const [page, groups] of Object.entries({ designer: ["tokens", "assets", "components", "sections", "frames"], writer: ["lexicon", "strings", "patterns", "passages", "narratives"], publisher: ["websites", "documents", "presentations", "videos", "messages", "social"] })) {
    for (const group of groups) expect(en.aliases).toHaveProperty(`strings.admin.group.${page}.${group}`);
  }
  expect(checkWriterICU(library(en))).toEqual([]);
  const format = (key: string, values: Record<string, string | number>) => {
    const record = en.records.find(record => record.id === en.aliases[`strings.admin.${key}`])!;
    return new IntlMessageFormat(record.text, "en").format(values);
  };
  expect(format("action.showAll", { count: 137 })).toBe("Show all (137)");
  expect(format("stats.total", { count: 1 })).toBe("1 record");
  expect(format("stats.total", { count: 2 })).toBe("2 records");
});

it("supplies exactly two native Arabic draft records without pretending to translate the whole page", () => {
  const en = english(), ar = arabic();
  expect(ar).toMatchObject({ state: "draft", activation: "none", locale: "ar", direction: "rtl" });
  expect(ar.records).toHaveLength(2); expect(ar.bindings).toHaveLength(2);
  const content = library(en, ar);
  expect(directionFor("ar", content.manifest)).toBe("rtl");
  expect(checkWriterICU(content)).toEqual([]);
  for (const record of ar.records) {
    expect(validateWriterRecord(record, "strings")).toEqual([]);
    expect(en.records.find(source => source.id === record.id)?.context).toBe(record.context);
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(record.text).toMatch(/[\u0600-\u06ff]/);
    expect(ar.aliases[record.context]).toBe(record.id);
    expect(ar.bindings.find(binding => binding.recordId === record.id)?.cellId).toBe(record.context);
  }
});
