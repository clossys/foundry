import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import common from "./catalog/records/common-labels.r1.en.json" with { type: "json" };
import { ADMIN_STUDIO_COPY_EN } from "./admin-studio.js";
import { createAdminCopy, resolveAdminCopyRef, type AdminCopyEnvelope } from "./admin-copy.js";

const record = ADMIN_STUDIO_COPY_EN.records.find(row => row.id === "st.7zkxq40fwy")!;
const binding = ADMIN_STUDIO_COPY_EN.bindings.find(row => row.recordId === record.id)!;
const preview = { target: "preview" as const };
function copyWith(recordPatch = {}, bindings: readonly unknown[] = [binding]) {
  return createAdminCopy([{ ...ADMIN_STUDIO_COPY_EN, records: [{ ...record, ...recordPatch }], bindings } as AdminCopyEnvelope]);
}

describe("strict Designer item-name resolution", () => {
  it("resolves the actual Button source binding with an explicit preview marker", () => {
    const slots = JSON.parse(readFileSync(new URL("../../designer/src/catalog/slots/components.json", import.meta.url), "utf8"));
    expect(slots.some((row: { id: string }) => row.id === "components.button")).toBe(true);
    expect(binding).toEqual({ cellId: "designer.item.components.button", recordId: record.id, kind: "item-name", target: "packages/designer/src/catalog/slots/components.json" });
    const copy = copyWith(), before = JSON.stringify(copy);
    expect(resolveAdminCopyRef({ id: record.id }, copy, preview)).toMatchObject({ text: "Button", servedLocale: "en", status: "draft", activation: "none" });
    expect(JSON.stringify(copy)).toBe(before);
    expect(copy.records[0]).not.toHaveProperty("approval");
  });
  it("refuses missing, wrong-kind, wrong-cell, wrong-record and wrong-target bindings", () => {
    for (const bindings of [[], [{ ...binding, kind: "CopyRef" }], [{ ...binding, kind: "ia-name" }], [{ ...binding, cellId: "designer.item.components.badge" }], [{ ...binding, recordId: "st.unknown000" }], [{ ...binding, target: "packages/designer/src/catalog/slots/themes.json" }]]) {
      expect(resolveAdminCopyRef({ id: record.id }, copyWith({}, bindings), preview), JSON.stringify(bindings)).toBeUndefined();
    }
  });
  it("resolves the existing Background record only with its authentic theme-slot binding on preview", () => {
    const slots = JSON.parse(readFileSync(new URL("../../designer/src/catalog/slots/themes.json", import.meta.url), "utf8"));
    expect(slots.some((row: { id: string }) => row.id === "themes.background")).toBe(true);
    const gradient = ADMIN_STUDIO_COPY_EN.records.find(row => row.id === "st.70ma9sgngq")!;
    const bindings = ADMIN_STUDIO_COPY_EN.bindings.filter(row => row.recordId === gradient.id);
    expect(bindings).toEqual([{ cellId: "designer.item.themes.background", recordId: gradient.id, kind: "item-name", target: "packages/designer/src/catalog/slots/themes.json" }]);
    const copy = createAdminCopy([ADMIN_STUDIO_COPY_EN]), before = JSON.stringify(copy);
    expect(resolveAdminCopyRef({ id: gradient.id }, copy, preview)).toMatchObject({ text: "Background", servedLocale: "en", status: "draft", activation: "none" });
    expect(resolveAdminCopyRef({ id: gradient.id }, copy)).toBeUndefined();
    const missing = createAdminCopy([{ ...ADMIN_STUDIO_COPY_EN, bindings: ADMIN_STUDIO_COPY_EN.bindings.filter(row => row.recordId !== gradient.id) }]);
    expect(resolveAdminCopyRef({ id: gradient.id }, missing, preview)).toBeUndefined();
    expect(JSON.stringify(copy)).toBe(before);
    expect(gradient).not.toHaveProperty("approval");
  });
  it("refuses unregistered item ids, wrong leaf and wrong item identity", () => {
    for (const patch of [{ id: "st.unknown000" }, { leaf: "strings.labels" }, { context: "designer.item.components.badge" }]) {
      expect(resolveAdminCopyRef({ id: patch.id ?? record.id }, copyWith(patch), preview)).toBeUndefined();
    }
    expect(resolveAdminCopyRef({ id: "st.unknown000" }, copyWith(), preview)).toBeUndefined();
  });
  it("retains target, locale and ICU checks for item names", () => {
    const copy = copyWith();
    expect(resolveAdminCopyRef({ id: record.id }, copy)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id }, copy, { target: "production" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id, locale: "fr" }, copy, preview)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id, values: { unexpected: 1 } }, copy, preview)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id }, copyWith({ status: "retired" }), preview)).toBeUndefined();
  });
});


describe("current common item owners and original Studio carriers", () => {
  const ids = ["st.v1cbgc4kr2", "st.s13b3hwkta"];
  const store = () => createAdminCopy([common as AdminCopyEnvelope, ADMIN_STUDIO_COPY_EN]);
  it("resolves Item and Pagination from unchanged common owners only in preview", () => {
    for (const [index, id] of ids.entries()) {
      const owner = common.records.find(row => row.id === id)!;
      const family = owner.context.split(".")[2];
      const slots = JSON.parse(readFileSync(new URL(`../../designer/src/catalog/slots/${family}.json`, import.meta.url), "utf8"));
      expect(slots.some((slot: { id: string }) => slot.id === owner.context.slice("designer.item.".length))).toBe(true);
      const copy = store(), before = JSON.stringify(copy);
      expect(resolveAdminCopyRef({ id }, copy, preview)).toMatchObject({ text: ["Item", "Pagination"][index], status: "draft", activation: "none" });
      expect(resolveAdminCopyRef({ id }, copy)).toBeUndefined();
      expect(resolveAdminCopyRef({ id, locale: "fr" }, copy, preview)).toBeUndefined();
      expect(resolveAdminCopyRef({ id, values: { unexpected: 1 } }, copy, preview)).toBeUndefined();
      expect(JSON.stringify(copy)).toBe(before);
    }
    for (const id of ["st.mn2v0dgaj8", "st.17r7xa6wg9"]) expect(resolveAdminCopyRef({ id }, store(), preview)).toBeUndefined();
  });
  it("refuses missing, duplicate, altered owners, original usage, declaration and carrier", () => {
    for (const id of ids) {
      const owner = common.records.find(row => row.id === id)!;
      const carrierBinding = ADMIN_STUDIO_COPY_EN.bindings.find(row => row.recordId === id)!;
      const ownerMutations = [
        { ...common, records: common.records.filter(row => row.id !== id) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, text: "Altered" } : row) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, context: "designer.item.components.button" } : row) },
        { ...common, usages: common.usages.filter(row => !(row.recordId === id && row.source === "records/admin-studio.r1.en.json")) },
        { ...common, bindings: [carrierBinding] },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, status: "retired" } : row) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, status: "approved" } : row) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, approval: { kind: "delegate" } } : row) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, limits: { maxChars: 999 } } : row) },
        { ...common, records: common.records.map(row => row.id === id ? { ...row, origin: "altered" } : row) },
        { ...common, activation: "active" },
        { ...common, state: "approved" },
        { ...common, locale: "fr" },
        { ...common, records: [...common.records, owner] },
      ];
      for (const changed of ownerMutations) expect(resolveAdminCopyRef({ id }, createAdminCopy([changed as AdminCopyEnvelope, ADMIN_STUDIO_COPY_EN]), preview)).toBeUndefined();
      expect(resolveAdminCopyRef({ id }, createAdminCopy([common as AdminCopyEnvelope]), preview)).toBeUndefined();
      expect(resolveAdminCopyRef({ id }, createAdminCopy([common as AdminCopyEnvelope, common as AdminCopyEnvelope, ADMIN_STUDIO_COPY_EN]), preview)).toBeUndefined();
      for (const bindings of [[], [carrierBinding, carrierBinding], [{ ...carrierBinding, kind: "CopyRef" }], [{ ...carrierBinding, target: "wrong" }], [{ ...carrierBinding, cellId: "wrong" }]]) {
        const carrier = { ...ADMIN_STUDIO_COPY_EN, bindings: [...ADMIN_STUDIO_COPY_EN.bindings.filter(row => row.recordId !== id), ...bindings] } as AdminCopyEnvelope;
        expect(resolveAdminCopyRef({ id }, createAdminCopy([common as AdminCopyEnvelope, carrier]), preview)).toBeUndefined();
      }
      for (const patch of [{ activation: "active" }, { state: "approved" }, { locale: "fr" }, { revision: 2 }, { sourceCommit: "altered" }, { sourceFiles: {} }]) {
        const carrier = { ...ADMIN_STUDIO_COPY_EN, ...patch } as AdminCopyEnvelope;
        expect(resolveAdminCopyRef({ id }, createAdminCopy([common as AdminCopyEnvelope, carrier]), preview)).toBeUndefined();
      }
      const declaration = ADMIN_STUDIO_COPY_EN.externalRecords.find(row => row.recordId === id)!;
      for (const externalRecords of [[], [declaration, declaration], [{ ...declaration, sourceContext: "wrong" }], [{ ...declaration, source: "wrong" }]]) {
        const carrier = { ...ADMIN_STUDIO_COPY_EN, externalRecords: [...ADMIN_STUDIO_COPY_EN.externalRecords.filter(row => row.recordId !== id), ...externalRecords] };
        expect(resolveAdminCopyRef({ id }, createAdminCopy([common as AdminCopyEnvelope, carrier]), preview)).toBeUndefined();
      }
      expect(owner.leaf).toBe("strings.common");
    }
  });
});
