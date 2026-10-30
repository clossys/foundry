import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_STUDIO_COPY_EN } from "./admin-studio.js";
import { ADMIN_COMMON_COPY_EN } from "./admin-common.js";
import { createAdminCopy, getAdminItemNameBinding, resolveAdminCopyRef, type AdminCopyEnvelope } from "./admin-copy.js";

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

describe("common-owned Designer item-name authority", () => {
  const spacing = ADMIN_COMMON_COPY_EN.records.find(row => row.id === "st.mn2v0dgaj8")!;
  const spacingBinding = ADMIN_STUDIO_COPY_EN.bindings.find(row => row.recordId === spacing.id && row.kind === "item-name")!;
  const commonOwner = { ...ADMIN_COMMON_COPY_EN, records: [spacing] };
  const commonCopy = (studio: AdminCopyEnvelope = ADMIN_STUDIO_COPY_EN, owner: AdminCopyEnvelope = commonOwner) => createAdminCopy([studio, owner]);
  const replaceBinding = (patch: Record<string, unknown>) => ({
    ...ADMIN_STUDIO_COPY_EN,
    bindings: ADMIN_STUDIO_COPY_EN.bindings.map(row => row === spacingBinding ? { ...row, ...patch } : row),
  }) as AdminCopyEnvelope;

  it("authenticates the shipped common Spacing record with its original Studio item binding", () => {
    expect(spacing).toMatchObject({ leaf: "strings.common", context: "designer.item.tokens.spacing", status: "draft", text: "Spacing" });
    expect(ADMIN_COMMON_COPY_EN.bindings).toEqual([]);
    expect(ADMIN_COMMON_COPY_EN.usages).toContainEqual(expect.objectContaining({
      recordId: spacing.id, source: "records/admin-studio.r1.en.json", context: spacing.context, leaf: "strings.names",
    }));
    expect(ADMIN_STUDIO_COPY_EN.externalRecords).toContainEqual({ recordId: spacing.id, source: "common-labels.r1.en.json", sourceContext: spacing.context });
    expect(spacingBinding).toEqual({ cellId: spacing.context, recordId: spacing.id, kind: "item-name", target: "packages/designer/src/catalog/slots/tokens.json" });
    const copy = commonCopy(), before = JSON.stringify(copy);
    expect(getAdminItemNameBinding(spacing.id)).toEqual(spacingBinding);
    expect(getAdminItemNameBinding(spacing.id, copy)).toEqual(spacingBinding);
    expect(resolveAdminCopyRef({ id: spacing.id }, copy, preview)).toMatchObject({ text: "Spacing", servedLocale: "en", status: "draft", activation: "none" });
    expect(resolveAdminCopyRef({ id: spacing.id }, undefined, preview)).toMatchObject({ text: "Spacing", servedLocale: "en", status: "draft", activation: "none" });
    expect(JSON.stringify(copy)).toBe(before);
    expect(spacing).not.toHaveProperty("approval");
  });

  it("refuses missing or altered original item-binding authority", () => {
    const missing = { ...ADMIN_STUDIO_COPY_EN, bindings: ADMIN_STUDIO_COPY_EN.bindings.filter(row => row !== spacingBinding) };
    const duplicated = { ...ADMIN_STUDIO_COPY_EN, bindings: [...ADMIN_STUDIO_COPY_EN.bindings, spacingBinding] };
    const invalid = [
      createAdminCopy([commonOwner]), commonCopy(missing), commonCopy(duplicated),
      ...[{ kind: "CopyRef" }, { kind: "ia-name" }, { cellId: "designer.item.tokens.density" },
        { recordId: "st.unknown000" }, { target: "packages/designer/src/catalog/slots/components.json" }].map(patch => commonCopy(replaceBinding(patch))),
      commonCopy(ADMIN_STUDIO_COPY_EN, { ...commonOwner, bindings: [spacingBinding] } as AdminCopyEnvelope),
    ];
    for (const copy of invalid) {
      expect(getAdminItemNameBinding(spacing.id, copy)).toBeUndefined();
      expect(resolveAdminCopyRef({ id: spacing.id }, copy, preview)).toBeUndefined();
    }
  });

  it("requires the original binding carrier's declaration of the common record owner", () => {
    for (const patch of [undefined, { source: "admin-pages.r1.en.json" }, { sourceContext: "designer.item.tokens.density" }]) {
      const externalRecords = ADMIN_STUDIO_COPY_EN.externalRecords.flatMap(row => row.recordId !== spacing.id ? [row] : patch ? [{ ...row, ...patch }] : []);
      const copy = commonCopy({ ...ADMIN_STUDIO_COPY_EN, externalRecords } as AdminCopyEnvelope);
      expect(getAdminItemNameBinding(spacing.id, copy)).toBeUndefined();
      expect(resolveAdminCopyRef({ id: spacing.id }, copy, preview)).toBeUndefined();
    }
  });

  it("retains exact identity, leaf, context, approval, locale and ICU guards", () => {
    for (const patch of [{ id: "st.unknown000" }, { leaf: "strings.names" }, { context: "designer.item.tokens.density" }]) {
      const copy = commonCopy(ADMIN_STUDIO_COPY_EN, { ...commonOwner, records: [{ ...spacing, ...patch }] } as AdminCopyEnvelope);
      expect(getAdminItemNameBinding(patch.id ?? spacing.id, copy)).toBeUndefined();
      expect(resolveAdminCopyRef({ id: patch.id ?? spacing.id }, copy, preview)).toBeUndefined();
    }
    const copy = commonCopy();
    expect(resolveAdminCopyRef({ id: spacing.id }, copy)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacing.id }, copy, { target: "production" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacing.id, locale: "ar" }, copy, preview)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacing.id, values: { unexpected: 1 } }, copy, preview)).toBeUndefined();
    expect(resolveAdminCopyRef({ id: spacing.id }, commonCopy(ADMIN_STUDIO_COPY_EN, { ...commonOwner, records: [{ ...spacing, status: "retired" }] }), preview)).toBeUndefined();
  });
});
