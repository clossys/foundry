import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkWriterRecordDrift } from "./record-drift.js";
const record = { id: "st.0000000001", leaf: "strings.actions", context: "Build gate fixture", text: "Open", status: "draft", origin: "authored" };
const source = (value: unknown) => [{ path: "sample.json", value }];
const envelope = (records: unknown[] = [record]) => ({ locale: "en", records });

it("checks real draft records without granting approval or demanding unadvertised locales", () => {
  const input = source(envelope()); const before = JSON.stringify(input);
  const report = checkWriterRecordDrift(input);
  expect(report.ok).toBe(true); expect(report.records).toBe(1);
  expect(report.approvalEvaluated).toBe(false); expect(JSON.stringify(input)).toBe(before);
});
it("fails a real overlength record against the existing Writer contract", () => {
  const report = checkWriterRecordDrift(source(envelope([{ ...record, text: "x".repeat(41) }])));
  expect(report.ok).toBe(false); expect(report.findings).toContainEqual(expect.objectContaining({ code: "WR7", recordId: record.id }));
});
it("fails ICU argument drift and malformed ICU in the discovered source", () => {
  const report = checkWriterRecordDrift(source(envelope([{ ...record, text: "Hello {name}" }])));
  expect(report.ok).toBe(false); expect(report.findings).toContainEqual(expect.objectContaining({ code: "WR8", recordId: record.id }));
});
it("requires native records for every declared bundle locale, without fallback", () => {
  const report = checkWriterRecordDrift(source({ manifest: { defaultLocale: "en", locales: [{ tag: "en" }, { tag: "ar" }] }, locales: { en: { records: [record] }, ar: { records: [] } } }));
  expect(report.ok).toBe(false); expect(report.findings).toContainEqual(expect.objectContaining({ code: "WR10", locale: "ar" }));
});
it("preserves each bundle's source locale when translations inherit length limits", () => {
  const multilingual = {
    manifest: { defaultLocale: "ar", locales: [{ tag: "ar" }, { tag: "en" }, { tag: "ja" }] },
    locales: {
      ar: { records: [{ ...record, text: "افتح", limits: { maxChars: 5 } }] },
      en: { records: [{ ...record, text: "Open", limits: { maxChars: 40 } }] },
      ja: { records: [{ ...record, text: "123456" }] },
    },
  };
  const sources = [
    { path: "multilingual.json", value: multilingual },
    { path: "english.json", value: envelope([{ ...record, id: "st.0000000002" }]) },
  ];
  const report = checkWriterRecordDrift(sources);
  expect(report.ok).toBe(false);
  expect(report.findings).toEqual([expect.objectContaining({ code: "WR7", locale: "ja", recordId: record.id })]);
  multilingual.locales.ja.records[0]!.text = "12345";
  expect(checkWriterRecordDrift(sources).ok).toBe(true);
});
it("retains same-locale references across bundles while attributing length findings to the owning record", () => {
  const referenced = { ...record, text: "x".repeat(25) };
  const pattern = {
    id: "pt.0000000001", leaf: "patterns.primary-action", context: "Referenced build gate fixture",
    origin: "authored", status: "draft",
    parts: { verb: { ref: { kind: "string", id: record.id } }, object: { text: "Example" } },
  };
  const sources = [
    { path: "strings.json", value: envelope([referenced]) },
    { path: "patterns.json", value: envelope([pattern]) },
  ];
  const report = checkWriterRecordDrift(sources);
  expect(report.ok).toBe(false);
  expect(report.findings).toEqual([expect.objectContaining({ code: "WR7", locale: "en", recordId: pattern.id, field: "parts.verb" })]);
  referenced.text = "Open";
  expect(checkWriterRecordDrift(sources).ok).toBe(true);
});
it("checks multilingual bundles independently instead of treating a partial fixture as a locale promise", () => {
  const result = checkWriterRecordDrift([
    ...source(envelope()),
    { path: "other.json", value: { locales: { en: { records: [{ ...record, id: "st.0000000002" }] }, ar: { records: [{ ...record, id: "st.0000000002", text: "افتح" }] } } } },
  ]);
  expect(result.ok).toBe(true); expect(result.bundles).toHaveLength(2);
});
it("fails closed on empty sources and malformed records", () => {
  expect(checkWriterRecordDrift(source({ locale: "en", records: [] })).ok).toBe(false);
  expect(checkWriterRecordDrift(source(envelope([{ ...record, id: "invalid" }]))).ok).toBe(false);
});

it("returns nonzero and persists actionable repository-format reports for each build drift class", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-record-drift-"));
  try {
    const records = join(root, "src/catalog/records"), report = join(root, "reports/record-drift.json");
    mkdirSync(records, { recursive: true });
    const script = fileURLToPath(new URL("../../scripts/check-record-drift.mjs", import.meta.url));
    const cases = [
      { code: "WR7", value: envelope([{ ...record, text: "x".repeat(41) }]) },
      { code: "WR8", value: envelope([{ ...record, text: "Hello {name}" }]) },
      { code: "WR10", value: { manifest: { defaultLocale: "en", locales: [{ tag: "en" }, { tag: "ar" }] }, locales: { en: { records: [record] }, ar: { records: [] } } } },
    ];
    for (const fixture of cases) {
      writeFileSync(join(records, "example.json"), JSON.stringify(fixture.value));
      const result = spawnSync(process.execPath, [script, "--records", records, "--report", report], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(1);
      const output = JSON.parse(readFileSync(report, "utf8"));
      expect(output.ok).toBe(false);
      expect(output.findings).toContainEqual(expect.objectContaining({ code: fixture.code }));
      expect(output.approvalEvaluated).toBe(false);
      expect(JSON.stringify(output)).not.toContain(root);
    }
    writeFileSync(join(records, "example.json"), JSON.stringify(envelope()));
    expect(spawnSync(process.execPath, [script, "--records", records, "--report", report]).status).toBe(0);
    expect(spawnSync(process.execPath, [script, "--records", records, "--report", report, "--check"]).status).toBe(0);
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts.build).toMatch(/tsc -p tsconfig\.json && node scripts\/check-record-drift\.mjs$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
