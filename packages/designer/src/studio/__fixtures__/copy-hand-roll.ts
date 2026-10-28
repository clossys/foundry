import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import type { StudioCopyBinding, StudioCopyRef } from "../copy-binding.js";

const relative = "packages/writer/src/catalog/records/admin-studio.r1.en.json";
export const repositoryRoot = [process.cwd(), resolve(process.cwd(), "../..")].find(root => existsSync(resolve(root, relative)))!;
export function catalogFixture<T>(path: string): T { return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as T; }
export const draftEnvelopes = ["admin-voice.r1.en.json", "admin-studio.r1.en.json", "admin-meta.r1.en.json"].map(name =>
  catalogFixture<{ records: { id: string; status: string; text: string; args?: { name: string; type: string }[] }[]; bindings?: { cellId: string; recordId: string; kind: string; target: string }[]; reviews: { recordId: string; source: { path: string }; before: string; argumentMapping?: Record<string, string> }[] }>(`packages/writer/src/catalog/records/${name}`));
const knownIds = new Set(draftEnvelopes.flatMap(envelope => envelope.records.map(record => record.id)));
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
      if (value) expect(value, `${name}: ${value}`).toMatch(/^(?:\[\[st\.[a-z0-9]+\]\]\s*)+$/);
    }
  }
}
