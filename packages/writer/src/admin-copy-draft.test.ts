import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { getAdminCopy, getAdminCopyRecord, ADMIN_WRITER_COPY_EN, resolveAdminCopyRef } from "./admin-copy.js";

const cli = new URL("../dist/cli.js", import.meta.url);
it("creates only validated explicitly English draft envelopes through the installed command", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-draft-command-"));
  try {
    const input = join(root, "input.json"), output = join(root, "draft.json");
    writeFileSync(input, JSON.stringify({ locale: "en", records: ADMIN_WRITER_COPY_EN.records }));
    const result = spawnSync(process.execPath, [cli.pathname, "admin-copy-draft", input, output], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(ADMIN_WRITER_COPY_EN);
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
  for (const record of ADMIN_WRITER_COPY_EN.records) {
    expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
    expect(getAdminCopyRecord(record.id)).toBe(record);
    expect(Object.isFrozen(record)).toBe(true);
  }
  const record = ADMIN_WRITER_COPY_EN.records.find(record => record.context.endsWith("coverageSummary"))!;
  expect(resolveAdminCopyRef({ id: record.id, locale: "en", values: { records: 7, bindings: 4 } })).toMatchObject({ text: "7 records; 4 proposed bindings.", status: "draft", activation: "none", servedLocale: "en" });
  expect(resolveAdminCopyRef({ id: record.id })).toBeUndefined();
  expect(resolveAdminCopyRef({ id: record.id, locale: "fr" })).toBeUndefined();
  expect(resolveAdminCopyRef({ id: "missing" })).toBeUndefined();
});
