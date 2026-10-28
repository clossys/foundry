import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { CHECK_CODES } from "../../designer/src/catalog-core/check-guidance.js";
import { readStudioFinding } from "../../designer/src/studio/copy-binding.js";
import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord } from "./admin-studio.js";
import { validateWriterRecord } from "./model/validate.js";
import type { StringRecord, WriterLibrary, WriterRecord } from "./model/types.js";
import { checkWriterLint } from "./checks/lint/index.js";
import { checkWriterICU } from "./checks/icu.js";
import { checkWriterLength } from "./checks/length.js";
import { checkWriterExpansion } from "./checks/expansion.js";
import terminology from "./catalog/admin-terminology.json" with { type: "json" };

const prefix = "designer.scorecard.finding.";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const records = ADMIN_STUDIO_COPY_EN.records.filter(record => record.context.startsWith(prefix));

it("supplies draft scorecard copy for the authoritative Designer finding codes", () => {
  // CHECK_CODES comes from the exhaustive Finding-code guidance, including reserved R.
  expect(CHECK_CODES.length).toBeGreaterThan(0);
  expect(records.map(record => record.context).sort()).toEqual(CHECK_CODES.map(code => `${prefix}${code}`).sort());
  const messages = Object.fromEntries(ADMIN_STUDIO_COPY_EN.bindings.map(binding => [binding.cellId, { id: binding.recordId }]));
  for (const code of CHECK_CODES) {
    const cellId = `${prefix}${code}`;
    const record = records.find(record => record.context === cellId)!;
    expect(record, cellId).toMatchObject({ status: "draft", leaf: "strings.errors", origin: "foundry-default" });
    expect(record).not.toHaveProperty("approval");
    expect(record.id).toMatch(/^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
    expect(validateWriterRecord(record, "strings"), cellId).toEqual([]);
    expect(ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.cellId === cellId), cellId).toHaveLength(1);
    const text = readStudioFinding({ locale: "en", messages, resolver: ref => {
      const value = getAdminStudioCopyRecord(ref.id);
      return value ? { ref, text: value.text, servedLocale: "en" } : undefined;
    } }, {}, cellId);
    expect(text, cellId).toBe(record.text);
  }
});

it("passes Writer schema, lint, message, length and expansion checks for scorecard drafts", () => {
  const content: WriterLibrary = { manifest: {
    consumer: "scorecard-draft-review", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }],
    fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
  }, locales: { en: { records: [...terminology.lexiconRecords as WriterRecord[], ...records as unknown as StringRecord[]], documents: [] } } };
  expect(records.length).toBe(CHECK_CODES.length);
  const batch = ADMIN_STUDIO_COPY_EN.sourceBatches.find(batch => batch.unit === "A4-WR-SCORECARD-COPY")!;
  expect([...batch.recordIds].sort()).toEqual(records.map(record => record.id).sort());
  for (const [path, digest] of Object.entries(batch.sourceFiles)) {
    expect(createHash("sha256").update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest("hex"), path).toBe(digest);
  }
  expect(checkWriterLint(content)).toEqual([]);
  expect(checkWriterICU(content)).toEqual([]);
  expect(checkWriterLength(content)).toEqual([]);
  expect(checkWriterExpansion(content)).toEqual([]);
});

it("resolves every scorecard finding key through both packed public admin exports", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-scorecard-exports-"));
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: packageRoot, encoding: "utf8" }));
    const installed = join(root, "node_modules/@clossys/writer");
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", ["-xzf", join(root, packed[0].filename), "-C", installed, "--strip-components=1"]);
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
    writeFileSync(join(root, "codes.json"), JSON.stringify(CHECK_CODES));
    const probe = join(root, "probe.mjs");
    writeFileSync(probe, `
      import assert from "node:assert/strict";
      import codes from "./codes.json" with { type: "json" };
      import { ADMIN_STUDIO_COPY_EN, getAdminStudioCopyRecord } from "@clossys/writer/admin-studio";
      import { getAdminCopyRecord } from "@clossys/writer/admin-copy";
      for (const code of codes) {
        const key = "designer.scorecard.finding." + code;
        const bindings = ADMIN_STUDIO_COPY_EN.bindings.filter(binding => binding.cellId === key);
        assert.equal(bindings.length, 1, key);
        const record = getAdminStudioCopyRecord(bindings[0].recordId);
        assert.equal(record?.context, key, key);
        assert.deepEqual(getAdminCopyRecord(record.id), record);
        assert.equal(record.status, "draft");
        assert.equal(Object.hasOwn(record, "approval"), false);
        assert.ok(record.text.trim().length > 0);
      }
      console.log(JSON.stringify({ codes: codes.length }));
    `);
    expect(JSON.parse(execFileSync(process.execPath, [probe], { cwd: root, encoding: "utf8" }))).toEqual({ codes: CHECK_CODES.length });
    const raw = JSON.parse(readFileSync(join(installed, "src/catalog/records/admin-studio.r1.en.json"), "utf8"));
    expect(raw.records.filter((record: { context: string }) => record.context.startsWith(prefix))).toHaveLength(CHECK_CODES.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
