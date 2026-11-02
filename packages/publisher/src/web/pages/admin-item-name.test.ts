import { describe, expect, it } from "vitest";
import { ADMIN_STUDIO_COPY_EN } from "@clossys/writer/admin-studio";
import { ADMIN_WRITER_COPY_EN } from "@clossys/writer/admin-copy";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import common from "../../../../writer/src/catalog/records/common-labels.r1.en.json" with { type: "json" };
import pages from "../../../../writer/src/catalog/records/admin-pages.r1.en.json" with { type: "json" };
import { createAdminPageCopy } from "./admin-copy.js";

const record = ADMIN_STUDIO_COPY_EN.records.find(row => row.id === "st.7zkxq40fwy")!;
const binding = ADMIN_STUDIO_COPY_EN.bindings.find(row => row.recordId === record.id)!;
function source(recordPatch = {}, bindings: readonly unknown[] = [binding]) {
  return { source: "admin-studio.r1.en.json", envelope: { ...ADMIN_STUDIO_COPY_EN, records: [{ ...record, ...recordPatch }], bindings } };
}
function pageCopy(input = source()) {
  return createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes([input]) });
}

describe("native Designer item-name CopyRef boundary", () => {
  it("prepares and resolves the authentic Button title without an alias or new binding", () => {
    const input = source(), before = JSON.stringify(input);
    const copy = pageCopy(input);
    expect(copy.resolve({ id: record.id })).toMatchObject({ text: "Button", provenance: {
      cellId: "designer.item.components.button", recordId: record.id, locale: "en", status: "draft", activation: "none",
      mode: "writer-icu-preview", bindingSource: input.source, recordSource: input.source,
    } });
    expect(JSON.stringify(input)).toBe(before);
    expect(copy.provenance()).toHaveLength(1);
  });
  it("refuses arbitrary ids, malformed item identity, missing and wrong-kind bindings", () => {
    const copy = pageCopy();
    expect(() => copy({ id: "st.unknown000" })).toThrow(/Writer/);
    for (const patch of [{ id: "st.unknown000" }, { leaf: "strings.labels" }, { context: "designer.item.components.badge" }, { context: "unrelated.fixture" }]) {
      expect(() => pageCopy(source(patch))({ id: patch.id ?? record.id })).toThrow(/Writer/);
    }
    for (const bindings of [[], [{ ...binding, kind: "ia-name" }], [{ ...binding, kind: "CopyRef" }], [{ ...binding, cellId: "designer.item.components.badge" }], [{ ...binding, target: "packages/designer/src/catalog/slots/themes.json" }]]) {
      expect(() => pageCopy(source({}, bindings))({ id: record.id })).toThrow(/Writer/);
    }
    expect(() => copy({ id: record.id, locale: "fr" })).toThrow(/locale/);
    expect(() => copy({ id: record.id, values: { unexpected: 1 } })).toThrow(/Writer/);
    const malformedLocale = source({}, [{ ...binding, kind: "CopyRef" }]);
    const localized = createAdminPageCopy({ locale: "ar", envelopes: prepareAdminPageCopyEnvelopes([
      { ...malformedLocale, envelope: { ...malformedLocale.envelope, locale: "ar" } },
    ]) });
    expect(() => localized({ id: record.id })).toThrow(/one bound record/);
  });
  it("does not grant ordinary CopyRef binding authority to an unrelated record", () => {
    const ordinary = ADMIN_WRITER_COPY_EN.records[0]!;
    const input = { source: "admin-writer.r1.en.json", envelope: { ...ADMIN_WRITER_COPY_EN, records: [ordinary], bindings: [{ ...binding, recordId: ordinary.id, cellId: ordinary.context }] } };
    const copy = createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes([input]) });
    expect(() => copy({ id: ordinary.id })).toThrow(/one bound record/);
  });
});


describe("current common owner and original Writer carriers", () => {
  const cases = [
    { id: "st.v1cbgc4kr2", alias: "strings.admin.column.item", text: "Item" },
    { id: "st.s13b3hwkta", alias: "strings.admin.pagination.label", text: "Pagination" },
  ];
  const copyEnvelopes = () => prepareAdminPageCopyEnvelopes([
    { source: "common-labels.r1.en.json", envelope: common },
    { source: "admin-studio.r1.en.json", envelope: ADMIN_STUDIO_COPY_EN },
    { source: "admin-pages.r1.en.json", envelope: pages },
  ]);
  const create = (envelopes = copyEnvelopes()) => createAdminPageCopy({ locale: "en", envelopes });
  it("resolves direct and shipped aliases with the actual common owner and separate binding source", () => {
    const envelopes = copyEnvelopes(), before = JSON.stringify(envelopes), copy = create(envelopes);
    for (const row of cases) for (const alias of [false, true]) {
      expect(copy.resolve({ id: alias ? row.alias : row.id })).toMatchObject({ text: row.text, provenance: {
        recordId: row.id, status: "draft", activation: "none", mode: "writer-icu-preview",
        recordSource: "common-labels.r1.en.json", bindingSource: alias ? "admin-pages.r1.en.json" : "admin-studio.r1.en.json",
      } });
    }
    expect(JSON.stringify(envelopes)).toBe(before);
    for (const id of ["st.mn2v0dgaj8", "st.17r7xa6wg9"]) expect(() => copy({ id })).toThrow(/Writer/);
  });
  it("refuses a missing original Studio carrier for both direct and existing aliases", () => {
    const copy = create(copyEnvelopes().filter(row => row.source !== "admin-studio.r1.en.json"));
    for (const row of cases) for (const id of [row.id, row.alias]) expect(() => copy({ id })).toThrow(/Writer/);
  });
  it("refuses remapping shipped item aliases to an ordinary actual Page record", () => {
    const ordinary = pages.records.find(row => row.id === "st.d0n2nss87p")!;
    expect(ordinary).toBeDefined();
    for (const row of cases) {
      const envelopes = structuredClone(copyEnvelopes());
      const page = envelopes.find(entry => entry.source === "admin-pages.r1.en.json")!.envelope;
      Object.assign(page.aliases!, { [row.alias]: ordinary.id });
      const binding = page.bindings.find(binding => binding.cellId === row.alias)!;
      Object.assign(binding, { recordId: ordinary.id });
      expect(() => create(envelopes)({ id: row.alias })).toThrow(/Writer/);
    }
  });
  it("refuses a second Page binding for the same protected alias cell", () => {
    const ordinary = pages.records.find(row => row.id === "st.d0n2nss87p")!;
    for (const row of cases) {
      const envelopes = structuredClone(copyEnvelopes());
      const page = envelopes.find(entry => entry.source === "admin-pages.r1.en.json")!.envelope;
      const binding = page.bindings.find(binding => binding.cellId === row.alias)!;
      (page.bindings as unknown[]).push({ ...binding, recordId: ordinary.id });
      expect(() => create(envelopes)({ id: row.alias })).toThrow(/Writer/);
    }
  });
  it("refuses relabelling the actual Studio carrier for direct and alias resolution", () => {
    const envelopes = copyEnvelopes().map(entry => entry.source === "admin-studio.r1.en.json" ? { ...entry, source: "wrong.json" } : entry);
    const copy = create(envelopes);
    for (const row of cases) for (const id of [row.id, row.alias]) expect(() => copy({ id })).toThrow(/Writer/);
  });
  it("refuses fabricated aliases and altered Page CopyRef targets, declarations or owner text", () => {
    for (const row of cases) {
      const mutations = [
        (entry: any) => entry.source === "admin-pages.r1.en.json" && (entry.envelope.aliases["strings.admin.fabricated"] = row.id),
        (entry: any) => entry.source === "admin-pages.r1.en.json" && (entry.envelope.bindings.find((binding: any) => binding.cellId === row.alias).target = "wrong"),
        (entry: any) => entry.source === "admin-pages.r1.en.json" && (entry.envelope.externalRecords.find((declaration: any) => declaration.recordId === row.id).sourceContext = "wrong"),
        (entry: any) => entry.source === "common-labels.r1.en.json" && (entry.envelope.records.find((record: any) => record.id === row.id).text = "Altered"),
      ];
      for (const [index, mutate] of mutations.entries()) {
        const envelopes = structuredClone(copyEnvelopes());
        envelopes.forEach(mutate);
        expect(() => create(envelopes)({ id: index === 0 ? "strings.admin.fabricated" : row.alias })).toThrow(/Writer/);
      }
    }
  });
});
