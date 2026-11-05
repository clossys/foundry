import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { formatRef, openStrategy } from "@clossys/director";
import { directorStoreReader } from "../../../producer/src/records/slots.js";
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


it("checks claim refs against the pinned Director slot, preserving current refs when a newer unpinned candidate exists", () => {
  mkdirSync("work", { recursive: true });
  const root = mkdtempSync(join("work", "writer-strategy-drift-"));
  const id = "advantage.proposition.proof";
  const candidate = (version: number) => `---\nslot: ${JSON.stringify(id)}\nsource: {"kind":"derived","ref":[]}\nfeeds: []\nfunctions: []\n---\n\n## Direction\n- Evidence: Fictional fixture evidence.\n- Never-claim: Unmeasured results.\n\n## Because\n- Interview evidence.\n\n## Watch\n- If requests > 5 each month, then review.\n`;
  /** Writes candidate `fixture-v<n>.md` of the flat slot folder and, when `pin`, the pin naming it. */
  const stage = (version: number, pin: boolean) => {
    const name = `fixture-v${version}.md`; const bytes = candidate(version);
    mkdirSync(join(root, id, "candidates"), { recursive: true });
    writeFileSync(join(root, id, "candidates", name), bytes);
    if (pin) writeFileSync(join(root, id, "pin.json"), JSON.stringify({ candidate: name, sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "fixture", basis: "test", at: "2026-10-29T00:00:00Z" }));
  };
  const claim = { id: "lx.0000000001", leaf: "lexicon.approved-claims", context: "Strategy drift fixture", kind: "claim", strategy: { cell: id, version: 1 }, phrasings: ["Fixture evidence"], requiresCitation: true, status: "draft", origin: "authored" };
  const input = source(envelope([claim]));
  const before = JSON.stringify(input);
  try {
    stage(1, true); stage(2, false);
    const strategy = openStrategy(root, directorStoreReader);
    expect(strategy.getCell(id)?.version).toBe(1);
    expect(checkWriterRecordDrift(input, { strategy }).ok).toBe(true);
    stage(2, true);
    const report = checkWriterRecordDrift(input, { strategy: openStrategy(root, directorStoreReader) });
    expect(report.ok).toBe(false);
    // The superseded candidate still resolves (as a draft), so the claim is stale, not dangling.
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "WR_STRATEGY_STALE", recordId: claim.id, field: "strategy", message: expect.stringContaining(formatRef({ kind: "cell", ref: claim.strategy })) }));
    expect(report.approvalEvaluated).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
    expect(checkWriterRecordDrift(source(envelope([{ ...claim, strategy: { cell: id, version: 2 } }])), { strategy: openStrategy(root, directorStoreReader) }).ok).toBe(true);
    expect(checkWriterRecordDrift(source(envelope([{ ...claim, strategy: { cell: id, version: 3 } }])), { strategy: openStrategy(root, directorStoreReader) }).findings).toContainEqual(expect.objectContaining({ code: "WR_STRATEGY_DANGLING" }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("refuses to claim strategy currency without a Director snapshot", () => {
  const claim = { id: "lx.0000000001", leaf: "lexicon.approved-claims", context: "Fixture", kind: "claim", strategy: { cell: "advantage.proposition.proof", version: 1 }, phrasings: ["Evidence"], requiresCitation: true, status: "draft", origin: "authored" };
  expect(checkWriterRecordDrift(source(envelope([claim]))).findings).toContainEqual(expect.objectContaining({ code: "WR_STRATEGY_MISSING", field: "strategy" }));
});
