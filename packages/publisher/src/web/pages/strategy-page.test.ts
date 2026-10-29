import { afterEach, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminCopy } from "@clossys/writer/admin-copy";
import { runtimeHash } from "@clossys/designer/catalog";
import { openStrategy, readStrategyRoot } from "@clossys/strategist";
import designer from "../../../../designer/strategy-brief.json" with { type: "json" };
import writer from "../../../../writer/strategy-brief.json" with { type: "json" };
import publisher from "../../../strategy-brief.json" with { type: "json" };
import ui from "../../../examples/strategy-page.copy.r1.en.json" with { type: "json" };
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { prepareStrategyPage, type StrategyPageInput, type StrategyPageReader } from "@clossys/publisher/web/registered-route-check";
import { strategyExampleLabels } from "./__fixtures__/strategy-page.mjs";
import { checkWriterLength, measureWriterText } from "../../../../writer/dist/checks/length.js";
import { checkWriterICU } from "../../../../writer/dist/checks/icu.js";
import writerSlots from "../../../../writer/src/catalog/slots/strings.json" with { type: "json" };

const example = fileURLToPath(new URL("../../../../strategist/test-fixtures/strategy-v2/example/", import.meta.url));
const contracts = [designer, writer, publisher].map(contract => ({ ...contract, schemaVersion: 1 as const }));
const cellId = "focus.segment.core";
const roots: string[] = [];
const idFor = (context: string) => `st.${runtimeHash(context).slice(7, 17)}`;
function input(root = example): StrategyPageInput {
  return {
    open: () => openStrategy(root, { contracts }),
    source: { id: "strategy.example", revision: 1 }, namespace: "example.strategy", scope: "core", selected: { id: cellId },
    contracts: contracts.map(contract => contract.id), ownedRecords: getAdminCopy().records, recordIdForContext: idFor,
    envelopes: prepareAdminPageCopyEnvelopes([{ source: "strategy-page.copy.r1.en.json", envelope: ui }]),
    labels: strategyExampleLabels,
  };
}
function copiedRoot() { const root = mkdtempSync(join(tmpdir(), "strategy-page-")); roots.push(root); cpSync(example, root, { recursive: true }); return root; }
function preparedData(value = input()) { const result = prepareStrategyPage(value); expect(result.status, JSON.stringify(result.status === "refused" ? result.findings : [])).toBe("prepared"); if (result.status !== "prepared") throw new Error("Expected prepared strategy data"); return result; }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

it("uses the actual synchronous ST2 API and preserves canonical partial status and real brief identities", () => {
  const actual: StrategyPageReader = openStrategy(example, { contracts });
  const typedInput: StrategyPageInput = { ...input(), open: () => actual };
  const result = preparedData(typedInput);
  expect(result.snapshot.status).toEqual(actual.status());
  expect(result.snapshot.status.counts.total).toBe(24);
  expect(result.snapshot.status.l0Clean).toBe(false);
  expect(result.snapshot.status.storyline.critic).toBe("not judged");
  expect(result.snapshot.briefs.map(brief => brief.contract)).toEqual(["designer.identity", "writer.messaging", "publisher.launch"]);
  expect(result.snapshot.briefs.every(brief => brief.state === "missing" || brief.state === "stale")).toBe(true);
  expect(result.snapshot.briefs.every(brief => /^[a-f0-9]{64}$/.test(brief.fingerprint))).toBe(true);
  expect(result.snapshot.cells.find(cell => cell.id === cellId)).toMatchObject({ latest: { version: 2, status: "active" }, active: { version: 2 }, canonical: { active: false, fresh: false } });
  expect(result.snapshot.briefs.flatMap(brief => brief.stale)).toContainEqual({ cell: "context.customer.need", version: 1 });
});

it("projects complete keyed bullets once through Writer and retains source locations, refs and fingerprints", () => {
  const result = preparedData(), cell = openStrategy(example).getCell(cellId)!;
  const body = JSON.stringify(result.body.value);
  for (const region of ["direction", "because", "watch"] as const) for (const bullet of cell[region]) {
    const displayed = bullet.key === undefined ? bullet.text : `${bullet.key}: ${bullet.text}`;
    expect(body).toContain(JSON.stringify(displayed).slice(1, -1));
    const field = result.provenance.fields.find(field => field.cellId === cellId && field.region === region && field.line === bullet.line)!;
    expect(field).toMatchObject({ version: 2, refs: bullet.refs, text: displayed, writer: { revision: 1, status: "draft", activation: "none", recordSource: "strategy.example" } });
    expect(field.cellFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.copy({ id: field.recordId })).toBe(displayed);
  }
  expect(result.provenance.envelopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(result.envelope.envelope.records.every(record => record.status === "draft" && !("approval" in record))).toBe(true);
  expect(result.rows.value).toHaveLength(24);
});

it("retains literal braces, apostrophes and terminal citation text through Writer ICU without interpolation values", () => {
  const root = copiedRoot(), path = join(root, `cells/${cellId}/v2.md`);
  const literal = "owners' {kiln} #1 and 'quoted' work (msg:2026-10-29-1#U4).";
  writeFileSync(path, readFileSync(path, "utf8").replace('Owners called kiln scheduling "the weekly fire drill" (msg:2026-10-29-1#U4).', literal));
  const result = preparedData(input(root)), field = result.provenance.fields.find(field => field.text === literal)!;
  expect(result.copy({ id: field.recordId })).toBe(literal);
  expect(result.envelope.envelope.records.find(record => record.id === field.recordId)?.args).toBeUndefined();
  expect(JSON.stringify(result.body.value)).toContain(literal);
});

it("distinguishes latest drafts, active pointers, pinned versions and reopened snapshots", () => {
  const root = copiedRoot(), value = input(root), old = openStrategy(root);
  const v2 = readFileSync(join(root, `cells/${cellId}/v2.md`), "utf8");
  writeFileSync(join(root, `cells/${cellId}/v3.md`), v2.replace("version: 2", "version: 3").replace("status: active", "status: draft"));
  expect(old.getCell(cellId)?.version).toBe(2);
  const result = preparedData(value);
  expect(result.snapshot.selected).toMatchObject({ version: 3, status: "draft" });
  expect(result.snapshot.cells.find(cell => cell.id === cellId)).toMatchObject({ latest: { version: 3 }, active: { version: 2 } });
  expect(result.provenance.fields.filter(field => field.region === "canonical-status").every(field => field.version === 2)).toBe(true);
  expect(preparedData({ ...value, selected: { id: cellId, version: 2 } }).snapshot.selected?.version).toBe(2);
});

it("keeps catalogue rows for an empty readable strategy and gives missing selection a Writer-backed state", () => {
  const root = mkdtempSync(join(tmpdir(), "strategy-page-empty-")); roots.push(root);
  const result = preparedData({ ...input(root), scope: "full" });
  expect(result.snapshot.status.counts).toMatchObject({ total: 57, active: 0 });
  expect(result.rows.value).toHaveLength(57);
  expect(result.snapshot.selected).toBeNull();
  expect(JSON.stringify(result.body.value)).toContain(result.copy(input(root).labels.missing));
});

it("returns typed non-renderable errors for unreadable roots and thrown read capabilities", () => {
  const root = join(copiedRoot(), "absent");
  expect(prepareStrategyPage({ ...input(root), issues: readStrategyRoot(root).issues })).toMatchObject({ status: "refused", findings: [{ code: "strategy-root", path: ".", reason: "unreadable" }] });
  expect(prepareStrategyPage({ ...input(), open: () => { throw new Error("Unavailable"); } })).toMatchObject({ status: "refused", findings: [{ code: "strategy-read" }] });
});

it("refuses a complete overlimit bullet with its cell, version, region and physical line", () => {
  const root = copiedRoot(), path = join(root, `cells/${cellId}/v2.md`), text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace("owners of independent ceramics studios", "owners " + "ceramics ".repeat(70)));
  const bullet = openStrategy(root).getCell(cellId)!.direction[0]!;
  expect(prepareStrategyPage(input(root))).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.objectContaining({ code: "copy-limit", cellId, version: 2, region: "direction", line: bullet.line })]) });
});

it("refuses collisions with the actual owned set, duplicate allocations and broken Writer ownership", () => {
  const value = input();
  for (const recordIdForContext of [() => value.ownedRecords[0]!.id, () => "st.0000000000", () => "semantic.alias"]) expect(prepareStrategyPage({ ...value, recordIdForContext })).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.objectContaining({ code: "copy-id" })]) });
  const envelope = structuredClone(ui); envelope.bindings.find(binding => binding.recordId === value.labels.direction.id)!.cellId = "foreign.owner";
  expect(prepareStrategyPage({ ...value, envelopes: prepareAdminPageCopyEnvelopes([{ source: "strategy-page.copy.r1.en.json", envelope }]) })).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.objectContaining({ code: "copy-source" })]) });
});

it("reuses a stable owned id only for its exact context and advances source-envelope provenance", () => {
  const value = input(), first = preparedData(value);
  const second = preparedData({ ...value, source: { ...value.source, revision: 2 }, ownedRecords: [...value.ownedRecords, ...first.envelope.envelope.records] });
  expect(second.envelope.envelope.records.map(record => record.id)).toEqual(first.envelope.envelope.records.map(record => record.id));
  expect(second.provenance.envelopeHash).not.toBe(first.provenance.envelopeHash);
  expect(second.provenance.fields.every(field => field.writer.revision === 2)).toBe(true);
  const crossed = first.envelope.envelope.records.map(record => ({ ...record, context: "another.owner" }));
  expect(prepareStrategyPage({ ...value, ownedRecords: [...value.ownedRecords, ...crossed] })).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.objectContaining({ code: "copy-id" })]) });
});

it("passes native Writer length and ICU gates against the unchanged common leaf contract", () => {
  const result = preparedData();
  expect(writerSlots.find(slot => slot.id === "strings.common")!.contract).toMatchObject({ maxChars: 320, maxWords: 60 });
  const library = { manifest: { consumer: "strategy-example", messageSyntax: "icu-mf1" as const, defaultLocale: "en", locales: [{ tag: "en", dir: "ltr" as const, state: "active" as const }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" as const }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
    locales: { en: { records: JSON.parse(JSON.stringify([...ui.records, ...result.envelope.envelope.records])), documents: [] } } };
  expect(checkWriterLength(library)).toEqual([]);
  expect(checkWriterICU(library)).toEqual([]);
});

it("measures quoted ICU by its exact Unicode display, including source longer than the display cap", () => {
  const root = copiedRoot(), path = join(root, `cells/${cellId}/v2.md`), original = readFileSync(path, "utf8");
  for (const text of ["'".repeat(180) + " {kiln} 🏺", "Würzburg's {clay} 中文 studio 🏺"]) {
    writeFileSync(path, original.replace('Owners called kiln scheduling "the weekly fire drill" (msg:2026-10-29-1#U4).', text));
    const result = preparedData(input(root)), field = result.provenance.fields.find(field => field.text === text)!;
    const record = result.envelope.envelope.records.find(record => record.id === field.recordId)!;
    expect(measureWriterText(record.text, "en")).toEqual({ chars: [...text].length, words: [...new Intl.Segmenter("en", { granularity: "word" }).segment(text)].filter(segment => segment.isWordLike).length });
    expect(result.copy({ id: record.id })).toBe(text);
    if (text.startsWith("''")) expect(record.text.length).toBeGreaterThan(320);
  }
});

it("uses Writer-owned status templates and refuses overlimit owned UI labels", () => {
  const value = input(), envelope = structuredClone(ui);
  envelope.records.find(record => record.context === "foundry.example.strategy.scopeSummary")!.text = "Coverage {scope}: {active, number}/{total, number}; current {fresh, number}.";
  const result = preparedData({ ...value, envelopes: prepareAdminPageCopyEnvelopes([{ source: "strategy-page.copy.r1.en.json", envelope }]) });
  expect(JSON.stringify(result.body.value)).toContain("Coverage core:");
  expect(result.provenance.ui.some(item => item.text.startsWith("Coverage core:"))).toBe(true);
  envelope.records.find(record => record.context === "foundry.example.strategy.direction")!.text = "D".repeat(321);
  expect(prepareStrategyPage({ ...value, envelopes: prepareAdminPageCopyEnvelopes([{ source: "strategy-page.copy.r1.en.json", envelope }]) })).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.objectContaining({ code: "copy-limit", region: "ui" })]) });
});
