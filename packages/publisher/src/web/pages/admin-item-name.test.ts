import { describe, expect, it } from "vitest";
import { ADMIN_STUDIO_COPY_EN } from "@clossys/writer/admin-studio";
import { ADMIN_WRITER_COPY_EN } from "@clossys/writer/admin-copy";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { createAdminPageCopy } from "./admin-copy.js";
import { adminCopyFixture, copyEnvelopes } from "./__fixtures__/copy.mjs";

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
    for (const bindings of [[], [{ ...binding, kind: "ia-name" }], [{ ...binding, kind: "CopyRef" }], [{ ...binding, cellId: "designer.item.components.badge" }], [{ ...binding, target: "packages/designer/src/catalog/slots/tokens.json" }]]) {
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

describe("shared Studio item names used by existing page cells", () => {
  for (const [id, cellId, context, text] of [
    ["st.v1cbgc4kr2", "strings.admin.column.item", "designer.item.components.item", "Item"],
    ["st.s13b3hwkta", "strings.admin.pagination.label", "designer.item.sections.pagination", "Pagination"],
  ] as const) {
    it(`preserves the original ${cellId} proof and direct canonical item proof`, () => {
      const copy = adminCopyFixture();
      const semantic = copy.resolve({ id: cellId });
      const direct = copy.resolve({ id });
      expect(semantic).toMatchObject({ text, ref: { id, locale: "en" }, provenance: {
        cellId, recordId: id, bindingSource: "admin-pages.r1.en.json", recordSource: "common-labels.r1.en.json", status: "draft", activation: "none",
      } });
      expect(direct).toMatchObject({ text, provenance: { cellId: context, recordId: id, bindingSource: "common-labels.r1.en.json", recordSource: "common-labels.r1.en.json" } });
      expect(semantic.provenance.bindingEnvelopeHash).not.toBe(direct.provenance.bindingEnvelopeHash);
      expect(semantic.provenance.envelopeHash).toBe(direct.provenance.envelopeHash);
      expect(copy.previewState()).toEqual({ target: "preview", draft: true });
    });
    it(`refuses forged aliases, sources, targets and incomplete canonical proof for ${text}`, () => {
      const attempts = ["item-missing", "item-target", "item-cell", "item-kind", "item-duplicate", "copy-missing", "copy-target", "copy-duplicate", "declaration-missing", "declaration-context", "declaration-duplicate", "foreign-source", "record-text", "record-context", "record-leaf", "foreign-locale", "forged-alias", "missing-owner"];
      for (const attempt of attempts) {
        const inputs = structuredClone(copyEnvelopes());
        const page = inputs.find(row => row.source === "admin-pages.r1.en.json")!;
        const owner = inputs.find(row => row.source === "common-labels.r1.en.json")!;
        const item = owner.envelope.bindings.find(row => row.recordId === id)!;
        const cell = page.envelope.bindings.find(row => row.cellId === cellId)!;
        const declaration = page.envelope.externalRecords!.find(row => row.recordId === id)!;
        const record = owner.envelope.records.find(row => row.id === id)!;
        let requested: string = cellId;
        if (attempt === "item-missing") owner.envelope.bindings = owner.envelope.bindings.filter(row => row.recordId !== id);
        if (attempt === "item-target") item.target = "packages/designer/src/catalog/slots/unknown.json";
        if (attempt === "item-cell") item.cellId = "designer.item.components.button";
        if (attempt === "item-kind") item.kind = "CopyRef";
        if (attempt === "item-duplicate") owner.envelope.bindings.push({ ...item });
        if (attempt === "copy-missing") page.envelope.bindings = page.envelope.bindings.filter(row => row.cellId !== cellId);
        if (attempt === "copy-target") cell.target = "sections.forged.label";
        if (attempt === "copy-duplicate") page.envelope.bindings.push({ ...cell });
        if (attempt === "declaration-missing") page.envelope.externalRecords = page.envelope.externalRecords!.filter(row => row.recordId !== id);
        if (attempt === "declaration-context") declaration.sourceContext = "designer.item.components.button";
        if (attempt === "declaration-duplicate") page.envelope.externalRecords!.push({ ...declaration });
        if (attempt === "foreign-source") { owner.source = "foreign.json"; declaration.source = "foreign.json"; }
        if (attempt === "record-text") record.text = "Forged name";
        if (attempt === "record-context") record.context = "designer.item.components.button";
        if (attempt === "record-leaf") record.leaf = "strings.names";
        if (attempt === "foreign-locale") owner.envelope.locale = "ar";
        if (attempt === "forged-alias") { requested = "strings.admin.forged.item"; page.envelope.aliases![requested] = id; page.envelope.bindings.push({ ...cell, cellId: requested }); }
        if (attempt === "missing-owner") inputs.splice(inputs.indexOf(owner), 1);
        const copy = createAdminPageCopy({ locale: "en", envelopes: inputs });
        expect(() => copy({ id: requested }), attempt).toThrow(/Writer/);
      }
    });
  }
});
