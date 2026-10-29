import { describe, expect, it } from "vitest";
import { ADMIN_STUDIO_COPY_EN } from "@clossys/writer/admin-studio";
import { ADMIN_WRITER_COPY_EN, createAdminCopy, resolveAdminCopyRef } from "@clossys/writer/admin-copy";
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

const spacingId = "st.mn2v0dgaj8";
const spacingAlias = "strings.admin.ia.designer.tokens.type-spacing";
const spacingCopy = (envelopes = copyEnvelopes()) => createAdminPageCopy({ locale: "en", envelopes });

describe("common-owned Designer item-name CopyRef boundary", () => {
  it.each([
    [spacingAlias, spacingAlias, "admin-pages.r1.en.json"],
    [spacingId, "designer.item.tokens.spacing", "admin-studio.r1.en.json"],
  ])("resolves authentic Spacing reference %s with its original binding carrier", (id, cellId, bindingSource) => {
    const envelopes = copyEnvelopes(), before = JSON.stringify(envelopes);
    const copy = spacingCopy(envelopes);
    expect(copy.resolve({ id })).toMatchObject({ text: "Spacing", ref: { id: spacingId, locale: "en" }, provenance: {
      cellId, recordId: spacingId, locale: "en", status: "draft", activation: "none", mode: "writer-icu-preview",
      bindingSource, recordSource: "common-labels.r1.en.json",
    } });
    expect(JSON.stringify(envelopes)).toBe(before);
    expect(copy.previewState()).toEqual({ target: "preview", draft: true });
  });

  it("refuses Spacing bindings with a wrong target, missing carrier or wrong source context", () => {
    const sources = copyEnvelopes();
    const mutations = [
      sources.map(source => source.source !== "admin-pages.r1.en.json" ? source : { ...source, envelope: { ...source.envelope,
        bindings: source.envelope.bindings.map(binding => binding.cellId !== spacingAlias ? binding : { ...binding, target: "sections.section-header.heading" }),
      } }),
      sources.map(source => source.source !== "admin-studio.r1.en.json" ? source : { ...source, envelope: { ...source.envelope,
        bindings: source.envelope.bindings.map(binding => binding.recordId !== spacingId || binding.kind !== "item-name" ? binding : { ...binding, target: "packages/designer/src/catalog/slots/components.json" }),
      } }),
      sources.map(source => source.source !== "admin-studio.r1.en.json" ? source : { ...source, envelope: { ...source.envelope,
        bindings: source.envelope.bindings.map(binding => binding.recordId !== spacingId || binding.kind !== "item-name" ? binding : { ...binding, kind: "ia-name" }),
      } }),
      sources.map(source => source.source !== "common-labels.r1.en.json" ? source : { ...source, envelope: { ...source.envelope,
        records: source.envelope.records.map(record => record.id !== spacingId ? record : { ...record, context: "designer.item.tokens.density" }),
      } }),
      sources.filter(source => source.source !== "admin-studio.r1.en.json"),
      sources.filter(source => source.source !== "common-labels.r1.en.json"),
    ];
    for (const [index, envelopes] of mutations.entries()) {
      const copy = spacingCopy(envelopes);
      expect(() => copy({ id: spacingAlias }), `mutation ${index}`).toThrow(/Writer/);
      if (index !== 0) expect(() => copy({ id: spacingId }), `mutation ${index}`).toThrow(/Writer/);
    }
    const wrongDeclaration = sources.map(source => source.source !== "admin-pages.r1.en.json" ? source : { ...source, envelope: { ...source.envelope,
      externalRecords: source.envelope.externalRecords?.map(row => row.recordId !== spacingId ? row : { ...row, source: "admin-studio.r1.en.json" }),
    } });
    expect(() => spacingCopy(wrongDeclaration)({ id: spacingAlias })).toThrow(/Writer/);
  });

  it("retains explicit preview and production refusal for the genuine common draft", () => {
    const store = createAdminCopy(copyEnvelopes().filter(source => source.envelope.locale === "en").map(source => source.envelope));
    expect(resolveAdminCopyRef({ id: spacingId }, store)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacingId }, store, { target: "production" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacingId }, store, { target: "preview" })).toMatchObject({ text: "Spacing", status: "draft", activation: "none", servedLocale: "en" });
    expect(() => adminCopyFixture()({ id: spacingAlias, locale: "fr" })).toThrow(/locale/);
  });
});
