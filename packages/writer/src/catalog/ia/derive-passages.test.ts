import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateWriterRecord } from "../../model/validate.js";
import { checkWriterICU } from "../../checks/icu.js";
import { writerPassageSchemaDigest } from "../../checks/closed-world.js";
import { loadWriterStore } from "./index.js";
import type { WriterLibrary, WriterRecord } from "../../model/types.js";
import { derivePassages, run } from "../../../scripts/derive-passages.mjs";

import { withDeclaredCommonRecords } from "../__fixtures__/shared-records.fixture.js";

const fixture = () => ({
  ia: { layer: "sections", nodes: [{ id: "explain", label: "Explain", children: [{ id: "explain-reading", label: "Reading", leaves: ["sections.article", "sections.band"] }] }] },
  slots: [
    { id: "sections.article", layer: "sections", contract: { kind: "section", passageSchema: "passages.article", slots: [{ name: "irrelevant", type: "media" }], copy: {
      sourceLocale: "en", fields: [
        { key: "items[].heading", kind: "rich", required: true, maxLength: { en: 100, de: 120 }, dir: "auto", perLocale: true, repeat: { min: 1, max: 8 }, fields: [{ key: "label", kind: "icu", required: false }] },
        { key: "states.empty.heading", kind: "plain", required: true, maxLength: { en: 80 }, dir: "ltr" },
      ], states: { empty: { fields: [{ key: "heading", required: true, kind: "plain", limits: { en: 80 } }] } },
    } } },
    { id: "sections.band", layer: "sections", contract: { kind: "section", passageSchema: "passages.band", copy: { sourceLocale: "en", fields: [] } } },
  ],
});
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe("passage derivation", () => {
  it("keeps every placement, including zero-field sections, and snapshots the complete declared schema", () => {
    const source = fixture();
    const before = structuredClone(source);
    const result = derivePassages(source.ia, source.slots);
    expect(result.ia).toEqual({ ...source.ia, layer: "passages", status: "retired", nodes: [{ ...source.ia.nodes[0], children: [{ ...source.ia.nodes[0]!.children[0], leaves: ["passages.article", "passages.band"] }] }] });
    expect(result.slots).toEqual(source.slots.map(section => ({
      id: section.contract.passageSchema, layer: "passages", contract: { kind: "passage", source: "writer", sectionId: section.id, passageSchema: section.contract.passageSchema, copy: section.contract.copy }, requires: [], status: "draft",
    })));
    expect(source).toEqual(before);
    result.slots[0].contract.copy.fields[0].maxLength.en = 1;
    result.slots[0].contract.copy.states.empty.fields[0].limits.en = 1;
    result.ia.nodes[0].children[0].leaves.push("passages.extra");
    expect(source).toEqual(before);
  });

  it("leaves specimen sections and their emptied IA groups out of the Writer mirror", () => {
    const source = fixture();
    source.ia.nodes.unshift({ id: "specimens", label: "Specimens", children: [{ id: "specimens-content", label: "Content", leaves: ["sections.specimen-swatch"] }] });
    source.ia.nodes[1]!.children[0]!.leaves.push("sections.specimen-grid");
    source.slots.push(
      { id: "sections.specimen-swatch", layer: "sections", contract: { kind: "section", passageSchema: "passages.specimen-swatch", copy: { sourceLocale: "en", fields: [] } } },
      { id: "sections.specimen-grid", layer: "sections", contract: { kind: "section", passageSchema: "passages.specimen-grid", copy: { sourceLocale: "en", fields: [] } } },
    );
    const result = derivePassages(source.ia, source.slots);
    expect(result.slots.map((slot: { id: string }) => slot.id)).toEqual(["passages.article", "passages.band"]);
    expect(result.ia).toEqual(derivePassages(fixture().ia, fixture().slots).ia);
    source.ia.nodes[1]!.children[0]!.leaves.pop();
    expect(() => derivePassages(source.ia, source.slots)).toThrow(/Missing section placement: sections.specimen-grid/);
  });

  it("emits no passage for a copy-less data-bound record section that declares no passageSchema (foundry-build-0048, A3)", () => {
    const records = (id: string, extra: Record<string, unknown> = {}) => ({ id, layer: "sections", contract: { kind: "section", slots: [{ name: "rows", type: "records", required: true }], copy: { sourceLocale: "en", fields: [] as unknown[] }, ...extra } });
    const source = fixture();
    source.ia.nodes.push({ id: "records", label: "Records", children: [{ id: "records-admin", label: "Admin", leaves: ["sections.queue"] }] });
    source.ia.nodes[0]!.children[0]!.leaves.push("sections.gallery");
    source.slots.push(records("sections.queue") as never, records("sections.gallery") as never);
    Object.assign(source.ia, { retired: ["sections.band", "sections.queue"], starter: ["sections.gallery", "sections.article"] });
    const result = derivePassages(source.ia, source.slots);
    expect(result.slots.map((slot: { id: string }) => slot.id)).toEqual(["passages.article", "passages.band"]);
    expect(result.ia.nodes.map((node: { id: string }) => node.id)).toEqual(["explain"]);
    expect(result.ia.nodes[0].children[0].leaves).toEqual(["passages.article", "passages.band"]);
    expect([result.ia.retired, result.ia.starter]).toEqual([["passages.band"], ["passages.article"]]);
    // Still placed exactly once, like every section.
    source.ia.nodes.pop();
    expect(() => derivePassages(source.ia, source.slots)).toThrow(/Missing section placement: sections.queue/);
  });

  it.each([
    ["a non-record section", { slots: [{ name: "mark", type: "media", required: true }] }],
    ["an optional records slot", { slots: [{ name: "rows", type: "records", required: false }] }],
    ["a record section with copy fields", { copy: { sourceLocale: "en", fields: [{ key: "rows[].label", kind: "plain", required: true, maxLength: { en: 40 }, dir: "auto" }] } }],
  ])("still refuses a missing passageSchema on %s", (_name, extra) => {
    const source = fixture();
    source.ia.nodes[0]!.children[0]!.leaves.push("sections.queue");
    source.slots.push({ id: "sections.queue", layer: "sections", contract: { kind: "section", slots: [{ name: "rows", type: "records", required: true }], copy: { sourceLocale: "en", fields: [] }, ...extra } } as never);
    expect(() => derivePassages(source.ia, source.slots)).toThrow(/passageSchema may be absent only on a copy-less data-bound record section: sections.queue/);
  });

  it("names passages, not sections, in the retired and starter lists and leaves specimens out (foundry-build-0033)", () => {
    const source = fixture();
    Object.assign(source.ia, { retired: ["sections.band", "sections.specimen-swatch"], starter: ["sections.article"] });
    const result = derivePassages(source.ia, source.slots);
    expect(result.ia.retired).toEqual(["passages.band"]);
    expect(result.ia.starter).toEqual(["passages.article"]);
    const shipped = JSON.parse(readFileSync(new URL("./passages.json", import.meta.url), "utf8"));
    for (const id of [...shipped.retired, ...shipped.starter]) expect(id).toMatch(/^passages\./);
    Object.assign(source.ia, { retired: ["passages.band"] });
    expect(() => derivePassages(source.ia, source.slots)).toThrow("Source retired must list section ids");
  });

  it.each([
    ["unknown placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.push("sections.unknown"); }],
    ["duplicate placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.push("sections.band"); }],
    ["wrong leaf prefix", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves[0] = "passages.article"; }],
    ["missing placement", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children[0]!.leaves.pop(); }],
    ["missing slots", (s: ReturnType<typeof fixture>) => { s.slots.pop(); }],
    ["duplicate slot", (s: ReturnType<typeof fixture>) => { s.slots.push(s.slots[0]!); }],
    ["wrong slot prefix", (s: ReturnType<typeof fixture>) => { s.slots[0]!.id = "passages.article"; }],
    ["wrong schema pairing", (s: ReturnType<typeof fixture>) => { s.slots[0]!.contract.passageSchema = "passages.band"; }],
    ["missing schema", (s: ReturnType<typeof fixture>) => { delete (s.slots[0]!.contract as { passageSchema?: string }).passageSchema; }],
    ["missing copy", (s: ReturnType<typeof fixture>) => { delete (s.slots[0]!.contract as { copy?: unknown }).copy; }],
    ["wrong IA layer", (s: ReturnType<typeof fixture>) => { s.ia.layer = "passages"; }],
    ["missing L2", (s: ReturnType<typeof fixture>) => { s.ia.nodes[0]!.children = []; }],
  ])("rejects %s", (_name, change) => {
    const source = fixture(); change(source);
    expect(() => derivePassages(source.ia, source.slots)).toThrow();
  });
});

describe("generator check mode", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "writer-passages-")); directories.push(dir);
    const paths = { sourceIa: join(dir, "sections-ia.json"), sourceSlots: join(dir, "sections-slots.json"), outputIa: join(dir, "passages-ia.json"), outputSlots: join(dir, "passages-slots.json") };
    const source = fixture();
    writeFileSync(paths.sourceIa, JSON.stringify(source.ia)); writeFileSync(paths.sourceSlots, JSON.stringify(source.slots));
    const log: string[] = [];
    const invoke = (args: string[]) => run({ args, paths, stdout: (s: string) => log.push(s), stderr: (s: string) => log.push(s) });
    return { paths, source, invoke, log };
  }
  it("generates canonical JSON then checks exact bytes without writing", () => {
    const { paths, invoke } = setup();
    expect(invoke([])).toBe(0);
    const originalIa = readFileSync(paths.outputIa, "utf8"), originalSlots = readFileSync(paths.outputSlots, "utf8");
    expect(originalIa.endsWith("\n")).toBe(true);
    expect(invoke(["--check"])).toBe(0);
    expect(readFileSync(paths.outputIa, "utf8")).toBe(originalIa);
    expect(readFileSync(paths.outputSlots, "utf8")).toBe(originalSlots);
  });
  it.each(["outputIa", "outputSlots"] as const)("detects byte-only drift in %s without rewriting either file", key => {
    const { paths, invoke } = setup(); expect(invoke([])).toBe(0);
    writeFileSync(paths[key], JSON.stringify(JSON.parse(readFileSync(paths[key], "utf8"))));
    const before = [readFileSync(paths.outputIa, "utf8"), readFileSync(paths.outputSlots, "utf8")];
    expect(invoke(["--check"])).toBe(1);
    expect([readFileSync(paths.outputIa, "utf8"), readFileSync(paths.outputSlots, "utf8")]).toEqual(before);
  });
  it("reports absent generated files as stale", () => {
    const { invoke } = setup(); expect(invoke(["--check"])).toBe(1);
  });
  it("distinguishes invalid source and arguments from stale output without rewriting", () => {
    const { paths, source, invoke } = setup(); expect(invoke([])).toBe(0);
    const before = readFileSync(paths.outputSlots, "utf8");
    expect(invoke(["--unknown"])).toBe(2);
    expect(invoke(["--check", "--check"])).toBe(2);
    source.slots[0]!.contract.passageSchema = "passages.wrong";
    writeFileSync(paths.sourceSlots, JSON.stringify(source.slots));
    expect(invoke(["--check"])).toBe(2);
    expect(invoke([])).toBe(2);
    expect(readFileSync(paths.outputSlots, "utf8")).toBe(before);
  });
  it("checks the repository outputs through the guarded CLI", () => {
    const result = spawnSync(process.execPath, [new URL("../../../scripts/derive-passages.mjs", import.meta.url).pathname, "--check"], { encoding: "utf8" });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});


// The assigned base precedes the owning Designer cascade. Current catalog
// equality and the approved projected equality are separate assertions: pending
// records cannot manufacture a registered schema or a schema digest.
describe("SU-9W section copy cascade", () => {
  const read = (path: string): any => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const copy = read("../records/section-defaults.r1.en.json");
  const cascade = read("../records/pending/sections-upgrade.r1.en.json");
  // Specimen sections are excluded from the Writer mirror (owner default).
  const designerSections = read("../../../../designer/src/catalog/slots/sections.json").filter((s: any) => !s.id.startsWith("sections.specimen-"));
  // Copy-less data-bound record sections pair no passage (foundry-build-0048, A3), so they sit outside the mirror too.
  const source = designerSections.filter((s: any) => s.contract.passageSchema !== undefined);
  // Live pairs registered after the cascade was approved sit outside its projection.
  const postCascade = ["sections.sectioned-document"];
  const allRecords = withDeclaredCommonRecords(copy, cascade);
  const aliases = { ...copy.aliases, ...cascade.aliases };
  const strings = allRecords.filter((r: WriterRecord) => r.id.startsWith("st."));

  it("pins 52 current live pairs separately from 52 approved projected pairs", () => {
    const current = loadWriterStore().slots.filter(slot => slot.layer === "passages");
    expect(source).toHaveLength(52);
    expect(current).toHaveLength(52);
    expect(new Set(current.map(slot => slot.id)).size).toBe(52);
    expect(current.map(slot => slot.id).sort()).toEqual(source.map((s: any) => s.contract.passageSchema).sort());
    expect(cascade.merges.map((m: any) => [m.fromSection, m.toSection])).toEqual([
      ["sections.logo-mark", "sections.logo-hero"],
      ["sections.account-summary", "sections.record-detail"],
      ["sections.error-message", "sections.error-state"],
    ]);
    expect(cascade.additions.map((a: any) => a.sectionId)).toEqual([
      "sections.canvas-lane", "sections.slot-board", "sections.canvas-controls",
    ]);
    for (const id of postCascade) expect(source.some((s: any) => s.id === id)).toBe(true);
    const projected = new Set(source.map((s: any) => s.id).filter((id: string) => !postCascade.includes(id)));
    for (const merge of cascade.merges) {
      expect(projected.has(merge.toSection)).toBe(true);
      // Idempotent across the pre-cascade base and the integrated catalog.
      projected.delete(merge.fromSection);
    }
    for (const addition of cascade.additions) {
      projected.add(addition.sectionId);
      expect(addition.passageId).toBe(addition.sectionId.replace(/^sections\./, "passages."));
    }
    expect(projected.size).toBe(cascade.expectedLivePairs);
    expect(projected.size).toBe(52);
    expect(new Set([...projected].map((id: any) => id.replace(/^sections\./, "passages."))).size).toBe(52);
  });

  it("derives no passage, placement or contract for the five admin record sections (foundry-build-0048, A3)", () => {
    const adminRecords = ["slot-gallery", "slot-detail", "candidate-preview", "question-packet", "queue-list"];
    expect(designerSections.filter((s: any) => s.contract.passageSchema === undefined).map((s: any) => s.id).sort()).toEqual(adminRecords.map(leaf => `sections.${leaf}`).sort());
    const shippedIa = JSON.stringify(read("./passages.json")), shippedSlots = read("../slots/passages.json") as { id: string; contract: { sectionId: string } }[];
    const contracts = read("../../slot-contracts/contracts/passages.json") as { slots: { id: string }[] };
    for (const leaf of adminRecords) {
      expect(shippedIa.includes(`passages.${leaf}"`), leaf).toBe(false);
      expect(shippedSlots.some(slot => slot.id === `passages.${leaf}` || slot.contract.sectionId === `sections.${leaf}`), leaf).toBe(false);
      expect(contracts.slots.some(slot => slot.id === `passages.${leaf}`), leaf).toBe(false);
      expect(loadWriterStore().slots.some(slot => slot.id === `passages.${leaf}`), leaf).toBe(false);
    }
  });

  it("keeps every authored string and merged passage draft, valid, unique and referentially complete", () => {
    expect(copy).toMatchObject({ state: "draft", activation: "none", locale: "en" });
    const ids = allRecords.map((r: WriterRecord) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(Object.values(aliases)).size).toBe(strings.length);
    // Merged passages on a passage that Designer retired stay in place as status retired (foundry-build-0033); every
    // other record stays draft.
    const retiredPassages = new Set<string>(read("./passages.json").retired);
    for (const record of allRecords) {
      expect(record.status, record.id).toBe(retiredPassages.has(record.leaf) ? "retired" : "draft");
      expect(record).not.toHaveProperty("approval");
      expect(validateWriterRecord(record, record.id.startsWith("st.") ? "strings" : "passages"), record.context).toEqual([]);
    }
    for (const binding of [...copy.bindings, ...cascade.bindings]) expect(ids).toContain(binding.recordId);
    const library: WriterLibrary = {
      manifest: { consumer: "section-defaults", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
      locales: { en: { records: strings, documents: [] } },
    };
    expect(checkWriterICU(library)).toEqual([]);
    for (const merge of cascade.merges) {
      const record = allRecords.find((r: WriterRecord) => r.id === merge.recordId);
      expect(record.leaf).toBe(merge.toPassage);
      expect(record.schema).toBe(merge.toPassage);
      const slot = loadWriterStore().slots.find(s => s.id === record.schema)!;
      expect(record.schemaDigest).toBe(writerPassageSchemaDigest(slot.contract));
      for (const ref of Object.values(record.fields) as any[]) expect(ids).toContain(ref.id);
    }
  });

  it("covers every DataTable host message and the removed section and site-shell defaults without duplicating chat", () => {
    const messages = readFileSync(new URL("../../../../designer/src/blocks/data-table/messages.ts", import.meta.url), "utf8");
    const fields = [...messages.matchAll(/readonly (\w+)\?:/g)].map(m => m[1]);
    for (const field of fields) expect(aliases).toHaveProperty(`dataTable.${field}`);
    expect(Object.keys(aliases)).toEqual(expect.arrayContaining([
      "pagination.previousPageLabel", "pagination.nextPageLabel", "pagination.noResultsLabel",
      "pagination.rangeSummaryMessage", "pagination.pageSummaryMessage", "pagination.pageSizeLabel", "pagination.ariaLabel",
      "gallery.close", "gallery.enlarge", "navShell.triggerLabel", "navShell.closeLabel",
    ]));
    expect(strings.every((r: any) => !r.context.includes(".chat."))).toBe(true);
    expect(aliases["navShell.triggerLabel"]).toBeTruthy();
    expect(strings.find((r: any) => r.id === aliases["navShell.triggerLabel"]).text).toBe("Menu");
    expect(strings.find((r: any) => r.id === aliases["navShell.closeLabel"]).text).toBe("Close menu");
  });

  it("keeps unresolved new-leaf intents outside record discovery without inventing schema evidence", () => {
    expect(cascade).toMatchObject({ state: "draft", activation: "none", integration: "pending-designer-contracts" });
    expect(cascade.records.length).toBeGreaterThan(0);
    expect(cascade.records.every((record: WriterRecord) => record.id.startsWith("st."))).toBe(true);
    const current = loadWriterStore();
    for (const addition of cascade.additions) {
      // The source leaf may land independently. This intent still has no
      // current digest and must not be mistaken for a registered record.
      const landed = current.slots.find(slot => slot.id === addition.passageId);
      if (landed) expect(landed.contract.sectionId).toBe(addition.sectionId);
      expect(addition.passageIntent).toMatchObject({ status: "draft", leaf: addition.passageId, schema: addition.passageId });
      expect(addition.passageIntent.proposedRecordId).toMatch(/^ps\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
      expect(addition.passageIntent).not.toHaveProperty("id");
      expect(addition.passageIntent).not.toHaveProperty("schemaDigest");
      expect(addition.passageIntent).not.toHaveProperty("approval");
      expect(addition.needs).toContain("Designer copy contract");
      expect(addition.needs).toContain("current schemaDigest");
      for (const ref of Object.values(addition.passageIntent.fields) as any[]) {
        expect(ref.ref).toBe("string");
        expect(strings.some((r: any) => r.id === ref.id)).toBe(true);
      }
    }
  });
});
