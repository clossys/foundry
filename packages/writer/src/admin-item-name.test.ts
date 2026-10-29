import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_STUDIO_COPY_EN } from "./admin-studio.js";
import { ADMIN_COMMON_COPY_EN, createAdminCopy, getAdminItemNameBinding, getAdminItemNameCopyRefBinding, resolveAdminCopyRef, type AdminCopyEnvelope } from "./admin-copy.js";

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
    for (const bindings of [[], [{ ...binding, kind: "CopyRef" }], [{ ...binding, kind: "ia-name" }], [{ ...binding, cellId: "designer.item.components.badge" }], [{ ...binding, recordId: "st.unknown000" }], [{ ...binding, target: "packages/designer/src/catalog/slots/tokens.json" }]]) {
      expect(resolveAdminCopyRef({ id: record.id }, copyWith({}, bindings), preview), JSON.stringify(bindings)).toBeUndefined();
    }
  });
  it("resolves the existing Gradient record only with its authentic token-slot binding on preview", () => {
    const slots = JSON.parse(readFileSync(new URL("../../designer/src/catalog/slots/tokens.json", import.meta.url), "utf8"));
    expect(slots.some((row: { id: string }) => row.id === "tokens.gradient")).toBe(true);
    const gradient = ADMIN_STUDIO_COPY_EN.records.find(row => row.id === "st.tbfa7dx2cf")!;
    const bindings = ADMIN_STUDIO_COPY_EN.bindings.filter(row => row.recordId === gradient.id);
    expect(bindings).toEqual([{ cellId: "designer.item.tokens.gradient", recordId: gradient.id, kind: "item-name", target: "packages/designer/src/catalog/slots/tokens.json" }]);
    const copy = createAdminCopy([ADMIN_STUDIO_COPY_EN]), before = JSON.stringify(copy);
    expect(resolveAdminCopyRef({ id: gradient.id }, copy, preview)).toMatchObject({ text: "Gradient", servedLocale: "en", status: "draft", activation: "none" });
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

describe("shared names retain canonical Studio authority", () => {
  it("keeps the merged Form name unauthenticated without blocking unambiguous names", () => {
    const id = "st.17r7xa6wg9";
    expect(ADMIN_COMMON_COPY_EN.records.find(record => record.id === id)).toMatchObject({ text: "Form", context: "designer.item.sections.form" });
    expect(ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.recordId === id)).toHaveLength(3);
    expect(ADMIN_COMMON_COPY_EN.bindings.filter(binding => binding.recordId === id)).toEqual([]);
    expect(getAdminItemNameBinding(id)).toBeUndefined();
    expect(resolveAdminCopyRef({ id }, undefined, preview)).toBeUndefined();
    expect(resolveAdminCopyRef({ id })).toBeUndefined();
  });
  for (const [id, cellId, text] of [
    ["st.v1cbgc4kr2", "strings.admin.column.item", "Item"],
    ["st.s13b3hwkta", "strings.admin.pagination.label", "Pagination"],
  ] as const) {
    it(`resolves ${text} through the unchanged current owner and original page cell`, () => {
      const row = ADMIN_COMMON_COPY_EN.records.find(record => record.id === id)!;
      const item = getAdminItemNameBinding(id)!;
      expect(row).toMatchObject({ leaf: "strings.common", text, context: item.cellId, status: "draft" });
      expect(ADMIN_STUDIO_COPY_EN.records.some(record => record.id === id)).toBe(false);
      expect(ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.recordId === id)).toEqual([item]);
      expect(getAdminItemNameCopyRefBinding(id, cellId)).toMatchObject({ cellId, recordId: id, kind: "CopyRef", source: "admin-pages.r1.en.json", recordSource: "common-labels.r1.en.json", sourceContext: row.context });
      expect(getAdminItemNameCopyRefBinding(id, "strings.admin.forged.item")).toBeUndefined();
      expect(resolveAdminCopyRef({ id }, undefined, preview)).toMatchObject({ text, status: "draft", activation: "none", servedLocale: "en" });
      expect(resolveAdminCopyRef({ id })).toBeUndefined();
      expect(resolveAdminCopyRef({ id }, undefined, { target: "production" })).toBeUndefined();
      expect(resolveAdminCopyRef({ id, locale: "fr" }, undefined, preview)).toBeUndefined();
      expect(row).not.toHaveProperty("approval");
    });
    it(`refuses forged or incomplete shared ${text} authority in every containing envelope`, () => {
      const row = ADMIN_COMMON_COPY_EN.records.find(record => record.id === id)!;
      const item = getAdminItemNameBinding(id)!;
      const envelope = { ...ADMIN_COMMON_COPY_EN, records: [row], bindings: [item] };
      const variants = [
        { ...envelope, bindings: [] },
        { ...envelope, bindings: [item, item] },
        { ...envelope, bindings: [{ ...item, kind: "CopyRef" }] },
        { ...envelope, bindings: [{ ...item, cellId: "designer.item.components.button" }] },
        { ...envelope, bindings: [{ ...item, target: "packages/designer/src/catalog/slots/unknown.json" }] },
        { ...envelope, locale: "ar" },
        ...[{ leaf: "strings.names" }, { context: "designer.item.components.button" }, { text: "Forged name" }, { id: "st.unknown000" }].map(patch => ({ ...envelope, records: [{ ...row, ...patch }] })),
      ];
      for (const invalid of variants) {
        const copy = createAdminCopy([invalid as AdminCopyEnvelope]);
        expect(getAdminItemNameBinding(invalid.records[0]!.id, copy)).toBeUndefined();
        expect(resolveAdminCopyRef({ id: invalid.records[0]!.id }, copy, preview)).toBeUndefined();
      }
      const duplicate = createAdminCopy([envelope as AdminCopyEnvelope, { ...envelope, bindings: [] } as AdminCopyEnvelope]);
      expect(resolveAdminCopyRef({ id }, duplicate, preview)).toBeUndefined();
    });
  }
});
