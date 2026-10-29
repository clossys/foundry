import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
    for (const bindings of [[], [{ ...binding, kind: "CopyRef" }], [{ ...binding, kind: "ia-name" }], [{ ...binding, cellId: "designer.item.components.badge" }], [{ ...binding, recordId: "st.unknown000" }], [{ ...binding, target: "packages/designer/src/catalog/slots/tokens.json" }]]) {
      expect(resolveAdminCopyRef({ id: record.id }, copyWith({}, bindings), preview), JSON.stringify(bindings)).toBeUndefined();
    }
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
