import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { checkWriterRecordDrift } from "../../checks/record-drift.js";
import { ADMIN_COMMON_COPY_EN, createAdminCopy, getAdminCopyRecord, resolveAdminCopyRef } from "../../admin-copy.js";
import { ADMIN_COMMON_COPY_EN as commonFacade } from "../../admin-common.js";
import { createCopyResolver, resolveCopyRef } from "../../resolve.js";
import type { CopyRegistry } from "../../types.js";

const read = (name: string): any => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const signIn = () => read("sign-in.json");
const paging = () => read("admin-writer-paging.r1.en.json");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sources = (root = new URL("./", import.meta.url)): { path: string; value: unknown }[] =>
  readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(new URL(`${entry.name}/`, root)).map(row => ({ ...row, path: `${entry.name}/${row.path}` }))
    : entry.name.endsWith(".json") ? [{ path: entry.name, value: JSON.parse(readFileSync(new URL(entry.name, root), "utf8")) }] : []);

it("passes the actual native drift gate with local paging records and canonical Arabic counterparts", () => {
  const report = checkWriterRecordDrift(sources());
  expect(report.findings).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.approvalEvaluated).toBe(false);
  expect(paging().records.map((record: any) => record.id).sort()).toEqual([
    "st.88wbh5rn5a", "st.96qkp2bzpm", "st.efsb6h9dmb", "st.kb8ve83tjp",
  ]);
  for (const binding of paging().bindings) expect(paging().records.find((record: any) => record.id === binding.recordId)).toBeDefined();
});

it("retains all three Arabic requests as explicit legacy evidence and resolves every native binding locally", () => {
  const { en, ar } = signIn().locales;
  const expected = [
    ["st.95zeepaj3s", "st.ktgn3jyg1d", "تسجيل الدخول", "Generic sign-in copy: header.heading"],
    ["st.an5ekdr18g", "st.hcq4hmxrrk", "رجوع", "Generic sign-in copy: actions.back"],
    ["st.f5ce2skzxv", "st.ktgn3jyg1d", "تسجيل الدخول", "Generic sign-in copy: actions.submit"],
  ];
  for (const [legacyRecordId, recordId, text, context] of expected) {
    expect(ar.legacyRecords).toContainEqual(expect.objectContaining({ legacyRecordId, recordId, text, context, status: "draft", origin: "foundry-default" }));
    const native = ar.records.find((record: any) => record.id === recordId);
    const source = en.records.find((record: any) => record.id === recordId);
    expect(native).toMatchObject({ id: recordId, text, leaf: source.leaf, context: source.context, status: "draft" });
    expect(native).not.toHaveProperty("approval");
  }
  const registry: CopyRegistry = {
    id: "native-ar-sign-in", locale: "ar", revision: "fixture-r1",
    source: { kind: "generated", reference: "catalog/records/sign-in.json" },
    entries: ar.records.filter((record: any) => typeof record.text === "string")
      .map((record: any) => ({ id: record.id, text: record.text, context: record.context, status: record.status })),
  };
  const resolve = createCopyResolver(registry, { target: "preview" });
  const configuredFallback = createCopyResolver(registry, { target: "preview", manifest: {
    defaultLocale: "ar", locales: [{ tag: "en", dir: "ltr", state: "active" }, { tag: "ar", dir: "rtl", state: "active" }],
    fallback: { en: ["ar"] },
  } });
  const withoutArabicSource = createCopyResolver(registry, { target: "preview", manifest: {
    defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {},
  } });
  let affectedCells = 0;
  expect(Object.keys(ar.bindings)).toEqual(Object.keys(ar.legacyBindings));
  for (const [bindingKey, legacy] of Object.entries(ar.legacyBindings) as [string, any][]) {
    const live = ar.bindings[bindingKey];
    expect(live.passageId).toBe(legacy.passageId);
    expect(Object.keys(live.fields)).toEqual(Object.keys(legacy.fields));
    for (const [cellKey, originalRef] of Object.entries(legacy.fields) as [string, any][]) {
      const original = expected.find(([id]) => id === originalRef.id);
      if (!original) continue;
      affectedCells++;
      const [, id, text] = original;
      const ref = live.fields[cellKey];
      expect(ref).toEqual({ id });
      expect(resolve({ ...ref, locale: "ar" }), `${bindingKey}:${cellKey}`)
        .toMatchObject({ text, status: "draft", servedLocale: "ar", chain: ["ar"] });
      expect(resolveCopyRef(registry, { ...ref, locale: "ar" }).issues)
        .toContainEqual(expect.objectContaining({ reason: "copy-not-approved" }));
      expect(resolve({ ...ref, locale: "en" }))
        .toMatchObject({ text, status: "draft", servedLocale: "ar", chain: ["ar"] });
      expect(configuredFallback({ ...ref, locale: "en" }))
        .toMatchObject({ text, status: "draft", servedLocale: "ar", chain: ["en", "ar"] });
      expect(withoutArabicSource({ ...ref, locale: "en" })).toBeUndefined();
    }
  }
  expect(affectedCells).toBe(7);
  for (const [id] of expected) expect(resolve({ id, locale: "ar" })).toBeUndefined();
  for (const binding of Object.values(ar.bindings) as any[]) {
    const passage = ar.records.find((record: any) => record.id === binding.passageId);
    for (const [key, ref] of Object.entries(binding.fields) as [string, any][]) {
      expect(passage.fields[key]).toEqual({ ref: "string", id: ref.id });
      expect(ar.records.find((record: any) => record.id === ref.id)).toHaveProperty("text");
    }
  }
  expect(ar.legacyBindings["ps.sign-in.password"].fields["actions.submit"].id).toBe("st.f5ce2skzxv");
  expect(ar.legacyBindings["ps.sign-in.password"].fields["header.heading"].id).toBe("st.95zeepaj3s");
  const orphaned = structuredClone(signIn());
  orphaned.locales.ar.records.find((record: any) => record.id === "st.hcq4hmxrrk").id = "st.an5ekdr18g";
  expect(checkWriterRecordDrift([{ path: "sign-in.json", value: orphaned }]).findings)
    .toContainEqual(expect.objectContaining({ code: "WR10", locale: "ar", recordId: "st.an5ekdr18g", field: "records" }));
  expect(checkWriterRecordDrift([{ path: "paging.json", value: { ...paging(), records: [] } }]).findings)
    .toContainEqual(expect.objectContaining({ code: "WX6_LOAD" }));
});

it("refuses wrong common source, source context, and source locale through the real facade", async () => {
  const source = read("common-labels.r1.en.json");
  for (const tamper of [
    (value: any) => { value.externalRecords[0].source = "missing-owner.json"; },
    (value: any) => { value.externalRecords[0].sourceContext = "Wrong source context"; },
    (value: any) => { value.locale = "ar"; },
  ]) {
    const invalid = structuredClone(source);
    tamper(invalid);
    vi.resetModules();
    vi.doMock("./common-labels.r1.en.json", () => ({ default: invalid }));
    try {
      await expect(import("../../admin-common.js")).rejects.toThrow("Invalid common copy source:");
    } finally {
      vi.doUnmock("./common-labels.r1.en.json");
      vi.resetModules();
    }
  }
});

it("preserves all original common records and usage evidence through the frozen facade and safe resolver", () => {
  expect(ADMIN_COMMON_COPY_EN).toBe(commonFacade);
  expect(ADMIN_COMMON_COPY_EN.records).toHaveLength(177);
  expect(read("common-labels.r1.en.json").usages).toHaveLength(444);
  // Exact held-984 canonical content/provenance, independent of record ownership.
  expect(digest([...ADMIN_COMMON_COPY_EN.records].sort((a, b) => a.id.localeCompare(b.id))))
    .toBe("412c4754f6dbed6739e6155ec681ede6357847f1d149083a2329b3383825dd3f");
  expect(digest(read("common-labels.r1.en.json").usages))
    .toBe("c70a90fc3503cbfe373089cdf7ac73fd389476c1bbfd046ee00a41d250b1ca85");
  for (const record of ADMIN_COMMON_COPY_EN.records) {
    expect(getAdminCopyRecord(record.id)).toEqual(record);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.status).toBe("draft");
    expect(record).not.toHaveProperty("approval");
    expect(resolveAdminCopyRef({ id: record.id, locale: "en" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id, locale: "ar" }, undefined, { target: "preview" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id }, createAdminCopy([]), { target: "preview" })).toBeUndefined();
  }
  expect(resolveAdminCopyRef({ id: "st.88wbh5rn5a", locale: "en", values: { page: 2, pages: 7 } }, undefined, { target: "preview" }))
    .toMatchObject({ text: "Page 2 of 7", status: "draft", activation: "none" });
  expect(resolveAdminCopyRef({ id: "st.88wbh5rn5a", locale: "en" }, undefined, { target: "preview" })).toBeUndefined();
});
