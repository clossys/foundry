import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { getAdminCopy, getAdminCopyRecord, ADMIN_WRITER_COPY_EN, ADMIN_COMMON_COPY_EN, createAdminCopy, resolveAdminCopyRef } from "./admin-copy.js";
import writerSource from "./catalog/records/admin-writer.r1.en.json" with { type: "json" };

const cli = new URL("../dist/cli.js", import.meta.url);
it("resolves every common survivor in the default store while preserving explicit store isolation", () => {
  expect(ADMIN_COMMON_COPY_EN.records).toHaveLength(177);
  for (const record of ADMIN_COMMON_COPY_EN.records) {
    expect(getAdminCopyRecord(record.id), record.id).toBe(record);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.status).toBe("draft");
    expect(record).not.toHaveProperty("approval");
    expect(getAdminCopyRecord(record.id, createAdminCopy([]))).toBeUndefined();
  }
  for (const id of ["st.1vc3bb7pw7", "st.pdq1ef8q2d", "st.2zj7yrtkfr"]) {
    const record = getAdminCopyRecord(id)!;
    expect(record.id).toBe(id);
    expect(resolveAdminCopyRef({ id, locale: "en" }, undefined, { target: "preview" })).toMatchObject({ text: record.text, status: "draft", activation: "none" });
    expect(resolveAdminCopyRef({ id, locale: "fr" }, undefined, { target: "preview" })).toBeUndefined();
    expect(resolveAdminCopyRef({ id }, createAdminCopy([]), { target: "preview" })).toBeUndefined();
  }
});
it("creates only validated explicitly English draft envelopes through the installed command", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-draft-command-"));
  try {
    const input = join(root, "input.json"), output = join(root, "draft.json");
    writeFileSync(input, JSON.stringify({ locale: "en", records: ADMIN_WRITER_COPY_EN.records }));
    const result = spawnSync(process.execPath, [cli.pathname, "admin-copy-draft", input, output], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
      version: 1, revision: 1, state: "draft", locale: "en", activation: "none",
      records: ADMIN_WRITER_COPY_EN.records,
      bindings: ADMIN_WRITER_COPY_EN.records.map(record => ({ cellId: record.context, recordId: record.id, target: "WriterRoutePage", kind: "CopyRef" })),
    });
    const original = readFileSync(output, "utf8");
    const existing = spawnSync(process.execPath, [cli.pathname, "admin-copy-draft", input, output], { encoding: "utf8" });
    expect(existing.status).toBe(2); expect(readFileSync(output, "utf8")).toBe(original);
    const record = ADMIN_WRITER_COPY_EN.records[0]!;
    for (const invalid of [
      { locale: "fr", records: [record] }, { records: [record] }, { locale: "en", records: [] },
      { locale: "en", records: [record, record] }, { locale: "en", records: [{ ...record, status: "approved" }] },
      { locale: "en", records: [{ ...record, locale: "fr" }] }, { locale: "en", records: [{ ...record, leaf: "strings.unknown" }] },
      { locale: "en", records: [{ ...record, text: "{undeclared}" }] },
    ]) {
      writeFileSync(input, JSON.stringify(invalid));
      expect(spawnSync(process.execPath, [cli.pathname, "admin-copy-draft", input, join(root, "refused.json")]).status).toBe(2);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15000);

it("exposes unchanged draft records and resolves English display CopyRefs without approval or fallback", () => {
  expect(getAdminCopy().envelopes).toContain(ADMIN_WRITER_COPY_EN);
  for (const external of writerSource.externalRecords) {
    const record = getAdminCopyRecord(external.recordId)!;
    expect(external.source).toBe("common-labels.r1.en.json");
    expect(record).toMatchObject({ id: external.recordId, context: external.sourceContext, leaf: "strings.common", status: "draft" });
    expect(writerSource.bindings.some(binding => binding.recordId === record.id)).toBe(true);
  }
  for (const binding of ADMIN_WRITER_COPY_EN.bindings) expect(getAdminCopyRecord(binding.recordId), binding.cellId).toBeDefined();
  for (const record of ADMIN_WRITER_COPY_EN.records) {
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(getAdminCopyRecord(record.id)).toBe(record);
    expect(Object.isFrozen(record)).toBe(true);
  }
  const record = ADMIN_WRITER_COPY_EN.records.find(record => record.context.endsWith("coverageSummary"))!;
  expect(resolveAdminCopyRef({ id: record.id, locale: "en", values: { records: 7, bindings: 4 } }, undefined, { target: "preview" })).toMatchObject({ text: "7 records; 4 proposed bindings.", status: "draft", activation: "none", servedLocale: "en" });
  expect(resolveAdminCopyRef({ id: record.id }, undefined, { target: "preview" })).toBeUndefined();
  expect(resolveAdminCopyRef({ id: record.id, locale: "fr" }, undefined, { target: "preview" })).toBeUndefined();
  expect(resolveAdminCopyRef({ id: "missing" }, undefined, { target: "preview" })).toBeUndefined();
});
