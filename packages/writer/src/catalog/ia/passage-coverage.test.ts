import { readFileSync, readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { loadWriterCatalog, writerIAFindings, type WriterCatalog, type WriterNode } from "./index.js";
import { checkWriterClosedWorld } from "../../checks/closed-world.js";
import { checkIACoverage } from "../../checks/ia-coverage/index.js";
import { loadBuildCatalog } from "../../../../designer/src/catalog-core/index.js";
import { loadSectionRegistry } from "../../../../designer/src/catalog-core/sections-contract.js";
import type { WriterLibrary, WriterRecord } from "../../model/types.js";

const additions = ["account-summary", "boundary-message", "error-state", "legal-prose", "logo-mark", "sign-in-form"] as const;
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
type Section = { id: string; contract: { passageSchema: string; copy: unknown } };
type Subject = { file: string; locale: string; record: WriterRecord };
const sections = read<Section[]>("../../../../designer/src/catalog/slots/sections.json");
const sectionIA = read<{ layer: string; nodes: WriterNode[] }>("../../../../designer/src/catalog/ia/sections.json");
const opaqueId = /^(?:lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

// Discover opaque records, including nested native-locale envelopes; aliases and
// bindings are reference metadata, never substitute record subjects.
function recordsIn(value: unknown, file: string, locale?: string): Subject[] {
  if (Array.isArray(value)) return value.flatMap(item => recordsIn(item, file, locale));
  if (!object(value)) return [];
  const tag = typeof value.locale === "string" ? value.locale : locale;
  if (typeof value.id === "string" && opaqueId.test(value.id) && typeof value.leaf === "string") {
    if (!tag) throw new Error(`${file}: ${value.id} has no native locale`);
    return [{ file, locale: tag, record: value as unknown as WriterRecord }];
  }
  return Object.entries(value).flatMap(([key, item]) => key === "locales" && object(item)
    ? Object.entries(item).flatMap(([nativeLocale, content]) => recordsIn(content, file, nativeLocale))
    : recordsIn(item, file, tag));
}

const recordFiles = readdirSync(new URL("../records/", import.meta.url)).filter(file => file.endsWith(".json")).sort();
const subjects = recordFiles.flatMap(file => recordsIn(read<unknown>(`../records/${file}`), file));
const locales: WriterLibrary["locales"] = {};
for (const { locale, record } of subjects) (locales[locale] ??= { records: [], documents: [] }).records.push(record);
// Only catalog membership and local references are evidence here. Authored
// statuses stay intact; Designer version/config and approval needs stay outside
// this report rather than receiving synthetic clearance.
const library: WriterLibrary = {
  manifest: {
    consumer: "passage-catalog-coverage-test", messageSyntax: "icu-mf1", defaultLocale: "en",
    locales: Object.keys(locales).map(tag => ({ tag, dir: tag === "ar" ? "rtl" : "ltr", state: "active" })),
    fallback: {}, strategist: { path: "synthetic/passage-catalog-coverage" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
  },
  locales,
};

function mapNodes(nodes: WriterNode[]): WriterNode[] {
  return nodes.map(node => "children" in node
    ? { ...node, children: mapNodes(node.children) }
    : { ...node, leaves: node.leaves.map(id => id.replace(/^sections\./, "passages.")) });
}

/** Test-local report: no production checker or CLI behavior is changed. */
function coverageReport(catalog: WriterCatalog) {
  const coverage = checkIACoverage({
    catalog, designer: loadBuildCatalog(),
    catalogRecords: Object.entries(locales).map(([locale, content]) => ({ locale, records: content.records })),
  });
  const schemaPair: string[] = [];
  const slots = catalog.slots.filter(slot => slot.layer === "passages");
  const expectedIds = sections.map(section => section.contract.passageSchema);
  for (const section of sections) {
    const id = section.contract.passageSchema;
    const matches = slots.filter(slot => slot.id === id);
    if (id !== section.id.replace(/^sections\./, "passages.") || matches.length !== 1 ||
      !isDeepStrictEqual(matches[0]?.contract, {
        kind: "passage", source: "writer", sectionId: section.id, passageSchema: id, copy: section.contract.copy,
      })) schemaPair.push(`schema-pair: ${section.id} -> ${id} must have one exact Designer copy contract`);
  }
  for (const slot of slots) if (!expectedIds.includes(slot.id)) schemaPair.push(`schema-pair: unexpected ${slot.id}`);
  if (!isDeepStrictEqual(catalog.placements.filter(row => row.layer === "passages"), [
    { ...sectionIA, layer: "passages", nodes: mapNodes(sectionIA.nodes) },
  ])) schemaPair.push("schema-pair: passage placements must exactly mirror Designer sections");
  const closedWorld = checkWriterClosedWorld(library, { catalog });
  const recordLeaf = closedWorld.filter(finding => /^(?:Catalog leaf |Passage schema )/.test(finding.message));
  const dangling = closedWorld.filter(finding => /^Reference .* (?:must resolve|targets a retired|must target)/.test(finding.message) || /^Pattern .* has no part /.test(finding.message));
  return {
    counts: {
      schemaPair: coverage.findings.filter(finding => finding.code === "schema-pair").length,
      recordLeaf: coverage.findings.filter(finding => finding.code === "record-leaf").length,
      dangling: coverage.dangling.length,
    },
    coverage, schemaPair, recordLeaf, dangling, ia: writerIAFindings(catalog, ["passages"]),
  };
}

describe("Designer to Writer passage catalog coverage", () => {
  it("keeps error-message as a retired alias of the live error-state section", () => {
    const registry = loadSectionRegistry();
    expect(registry.slots.some(slot => slot.id === "sections.error-message")).toBe(false);
    expect(registry.slots.filter(slot => slot.id === "sections.error-state")).toHaveLength(1);
    expect(registry.aliases).toContainEqual({ id: "sections.error-message", target: "sections.error-state" });
    expect(subjects.some(subject => subject.record.leaf === "passages.error-message")).toBe(false);
    expect(subjects.some(subject => subject.record.id === "ps.000000002q" && subject.record.leaf === "passages.error-state")).toBe(true);
  });

  it("reports zero schema-pair, record-leaf and dangling findings across all 51 pairs and actual records", () => {
    const catalog = loadWriterCatalog();
    expect(sections).toHaveLength(51);
    expect(new Set(sections.map(section => section.contract.passageSchema)).size).toBe(51);
    expect(catalog.slots.filter(slot => slot.layer === "passages")).toHaveLength(51);
    expect(recordFiles).toEqual(expect.arrayContaining(["site.en.json", "sign-in.json", "admin-meta.r1.en.json", "admin-studio.r1.en.json", "admin-voice.r1.en.json"]));
    for (const file of recordFiles) expect(subjects.some(subject => subject.file === file), file).toBe(true);
    const report = coverageReport(catalog);
    expect(report.schemaPair).toEqual([]);
    expect(report.recordLeaf).toEqual([]);
    expect(report.dangling).toEqual([]);
    expect(report.ia).toEqual([]);
    expect(report.counts).toEqual({ schemaPair: 0, recordLeaf: 0, dangling: 0 });
  });

  it.each(additions)("connects sections.%s to its exact schema and real opaque passage records", name => {
    const catalog = loadWriterCatalog();
    const id = `passages.${name}`;
    const source = sections.filter(section => section.id === `sections.${name}`);
    const slots = catalog.slots.filter(slot => slot.id === id);
    expect(source).toHaveLength(1);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.contract).toEqual({ kind: "passage", source: "writer", sectionId: source[0]!.id, passageSchema: id, copy: source[0]!.contract.copy });
    const records = subjects.filter(subject => subject.record.leaf === id);
    // Unfilled schema leaves are valid: only existing records can prove fill.
    expect(coverageReport(catalog).coverage.leaves.find(leaf => leaf.id === id)!.records).toHaveLength(records.length);
    for (const { record } of records) {
      expect(record.id).toMatch(opaqueId);
      expect(record).toHaveProperty("schema", id);
      expect(record).toHaveProperty("fields");
    }
  });

  it.each(additions)("fails with named schema and record findings when %s loses its schema leaf", name => {
    const catalog = structuredClone(loadWriterCatalog());
    const id = `passages.${name}`;
    catalog.slots = catalog.slots.filter(slot => slot.id !== id);
    const report = coverageReport(catalog);
    expect(report.schemaPair).toContain(`schema-pair: sections.${name} -> ${id} must have one exact Designer copy contract`);
    const actualRecords = subjects.filter(subject => subject.record.leaf === id);
    expect(report.coverage.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "schema-pair", subject: id }),
    ]));
    for (const { record } of actualRecords) expect(report.coverage.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "record-leaf", subject: record.id, detail: `Record leaf ${id} is not registered` }),
    ]));
    expect(report.ia).toEqual(expect.arrayContaining([expect.objectContaining({ message: `IA: unknown leaf ${id}` })]));
    expect(report.counts.schemaPair).toBeGreaterThan(0);
    expect(report.counts.recordLeaf).toBe(new Set(actualRecords.map(subject => subject.record.id)).size);
    expect(report.coverage.dangling).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `sections.${name}`, to: id, kind: "schema" }),
    ]));
  });
});
