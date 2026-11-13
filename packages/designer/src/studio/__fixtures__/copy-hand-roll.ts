import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import type { StudioCopyBinding, StudioCopyRef } from "../copy-binding.js";
import { studioTestCopy } from "./copy.js";

const relative = "packages/writer/src/catalog/records/admin-studio.r1.en.json";
export const repositoryRoot = [process.cwd(), resolve(process.cwd(), "../..")].find(root => existsSync(resolve(root, relative)))!;
export function catalogFixture<T>(path: string): T { return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as T; }
export const draftEnvelopes = ["admin-voice.r1.en.json", "admin-studio.r1.en.json", "admin-meta.r1.en.json"].map(name =>
  catalogFixture<{ records: { id: string; status: string; text: string; args?: { name: string; type: string }[] }[]; bindings?: { cellId: string; recordId: string; kind: string; target: string }[]; reviews: { recordId: string; source: { path: string }; before: string; argumentMapping?: Record<string, string> }[] }>(`packages/writer/src/catalog/records/${name}`));
/** A host Studio binding: the test copy, with every Writer cell bound to its record exactly as the envelopes declare (admin-studio bindings). */
export const studioHostCopy = { ...studioTestCopy, messages: Object.fromEntries(draftEnvelopes.flatMap(envelope => envelope.bindings ?? []).map(binding => [binding.cellId, { id: binding.recordId }])) };
// Shared labels were canonicalized into common-labels, whose external declarations resolve from their owners (sign-in, paging).
const common = catalogFixture<{ records: { id: string }[]; externalRecords: { recordId: string }[] }>("packages/writer/src/catalog/records/common-labels.r1.en.json");
const knownIds = new Set([...draftEnvelopes.flatMap(envelope => envelope.records.map(record => record.id)), ...common.records.map(record => record.id), ...common.externalRecords.map(row => row.recordId)]);
type WriterRecord = { id: string; status: string; text: string; args?: { name: string; type: string }[] };
type WriterEnvelope = { records?: WriterRecord[]; locales?: Record<string, { records: WriterRecord[] }>; externalRecords?: { recordId: string; source: string }[] };
const writerEnvelope = (name: string) => catalogFixture<WriterEnvelope>(`packages/writer/src/catalog/records/${name}`);
/** One record by id: the envelope's own, or the one it declares external, read from its owner (transitively); never copied (WX6_DUPLICATE). */
export function writerRecord(name: string, id: string, seen: ReadonlySet<string> = new Set()): WriterRecord | undefined {
  const key = `${name}#${id}`;
  if (seen.has(key)) throw new Error(`writer.external-cycle ${key}`);
  const envelope = writerEnvelope(name);
  const own = (envelope.records ?? envelope.locales?.en?.records ?? []).find(record => record.id === id);
  if (own) return own;
  const external = envelope.externalRecords?.find(row => row.recordId === id);
  return external ? writerRecord(external.source, id, new Set([...seen, key])) : undefined;
}
// Review rows keep the id a label had before canonicalization; common-labels usages map each legacy id to its canonical record.
const canonicalIds = new Map(catalogFixture<{ usages: { recordId: string; legacyRecordId: string }[] }>("packages/writer/src/catalog/records/common-labels.r1.en.json").usages.map(row => [row.legacyRecordId, row.recordId]));
export function canonicalWriterId(id: string): string { return canonicalIds.get(id) ?? id; }
/** An envelope's own records followed by every record it declares external, each resolved from its owner. */
export function writerRecordsWithExternals(name: string): WriterRecord[] {
  const envelope = writerEnvelope(name);
  const external = (envelope.externalRecords ?? []).map(row => {
    const record = writerRecord(row.source, row.recordId);
    if (!record) throw new Error(`writer.external-missing ${row.recordId} in ${row.source}`);
    return record;
  });
  return [...(envelope.records ?? envelope.locales?.en?.records ?? []), ...external];
}
export function pseudoStudioCopy(locale = "en") {
  const requests: StudioCopyRef[] = [];
  const copy: StudioCopyBinding = { locale, resolver(ref) {
    expect(knownIds.has(ref.id), `unknown production ref ${ref.id}`).toBe(true);
    requests.push(ref);
    return { ref, text: `[[${ref.id}]]`, servedLocale: locale, chain: [locale] };
  } };
  return { copy, requests };
}
export function expectOnlyResolvedCopy(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const actual: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("style,script,[data-studio-data-value]")) continue;
    const value = node.textContent?.trim(); if (value) actual.push(value);
  }
  expect(actual.length).toBeGreaterThan(0);
  for (const value of actual) expect(value, `unwrapped copy node: ${value}`).toMatch(/^(?:\[\[st\.[a-z0-9]+\]\]\s*)+$/);
  for (const element of container.querySelectorAll("[aria-label],[aria-valuetext],[title],[placeholder]")) {
    for (const name of ["aria-label", "aria-valuetext", "title", "placeholder"]) {
      const value = element.getAttribute(name)?.trim();
      // The stock shadcn@aria slider speaks its number in react-aria's Intl format (R2F-33c): data, not copy, so it may carry no letters.
      if (value && name === "aria-valuetext" && element.matches('[data-slot="slider-thumb"] input[type="range"]')) { expect(value, `${name}: ${value}`).toMatch(/^[^\p{L}]+$/u); continue; }
      if (value) expect(value, `${name}: ${value}`).toMatch(/^(?:\[\[st\.[a-z0-9]+\]\]\s*)+$/);
    }
  }
}
