// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopyResolver } from "@clossys/writer";
import { approvedCopyEntry, copyRefFixtureAt } from "../__fixtures__/copy-ref.js";
import { buildPublisherBoard } from "./build.js";
import { buildPublisherInspector } from "./inspector-model.js";
import { writerLabel, type PublisherBoardCopyResolver } from "./copy.js";
import { boardFixture, boardWriterCopy } from "../../web/publisher-v2/__fixtures__/board.js";
import { inspectorFixture } from "../../web/publisher-v2/inspector/__fixtures__/inspector.js";
import { PublisherBoard } from "../../web/publisher-v2/PublisherBoard.js";
import { PublisherInspector } from "../../web/publisher-v2/inspector/PublisherInspector.js";
import type { CopyField } from "../composition.js";
import { createContentRevision } from "../revisions.js";

const pseudo: PublisherBoardCopyResolver = ref => ({ ref, text: `[[${ref.id}]]`, locale: ref.locale!, servedLocale: ref.locale!, chain: [ref.locale!], recordId: "fixture", entryId: ref.id, revision: "1", source: { kind: "consumer", reference: "fixture" } });
const refs = (fields: readonly CopyField[]): CopyField[] => fields.map(field => ({ key: field.key, locale: field.locale, source: "writer", ref: { id: `fixture.${field.key}` } }));
afterEach(cleanup);
function wrapped(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
}
describe("Writer refs in read-only Publisher models", () => {
  it("renders the actual Designer-based board and inspector with no inline label projection", () => {
    const registry = { ...boardFixture(), slots: [], candidates: [] };
    const copy = refs(boardWriterCopy(registry)), before = structuredClone(copy);
    const model = buildPublisherBoard({ registry, locale: "en", copy, copyResolver: pseudo });
    expect(model.ready).toBe(true); expect(model.labels.title).toBe("[[fixture.board.title]]");
    const view = render(<PublisherBoard model={model} />); wrapped(view.container);
    const input = inspectorFixture();
    const inspector = buildPublisherInspector({ ...input, registry: { ...input.registry, candidates: [] }, copy: refs(input.copy), copyResolver: pseudo });
    expect(inspector.ready).toBe(true);
    view.rerender(<PublisherInspector model={inspector} />); wrapped(view.container);
    expect(copy).toEqual(before);
  });
  it("reports missing/refused/throwing resolver copy as Needs without inline English fallback", () => {
    const registry = boardFixture(), copy = refs(boardWriterCopy(registry));
    for (const copyResolver of [undefined, () => undefined, () => { throw new Error("private diagnostic"); }]) {
      const board = buildPublisherBoard({ registry, locale: "en", copy, copyResolver });
      expect(board.ready).toBe(false); expect(board.labels.title).toBe("");
      expect(board.needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "board.title" }));
      expect(JSON.stringify(board)).not.toContain("private diagnostic");
    }
  });
  it("forwards the same host resolver to each declared locale's ref-only candidate body", () => {
    const input = inspectorFixture(), before = structuredClone(input);
    const candidates = input.registry.candidates.map(candidate => {
      const composition = candidate.composition && { ...candidate.composition, sections: candidate.composition.sections.map(section => ({ ...section, fields: section.fields.map(field => ({ key: field.key, locale: field.locale, source: "writer" as const, ref: { id: `fixture.body.${candidate.id}.${field.locale}.${field.key}` } })) })) };
      const next = { ...candidate, composition };
      const snapshot = createContentRevision(next, candidate.revision, candidate.updatedAt);
      return { ...next, history: candidate.history.map(row => row.revision === candidate.revision ? snapshot : row) };
    });
    const reviews = input.reviews!.map(report => ({ ...report, digest: candidates.find(candidate => candidate.id === report.candidateId)!.history.find(row => row.revision === report.revision)!.digest }));
    const resolver = vi.fn(pseudo);
    const model = buildPublisherInspector({ ...input, registry: { ...input.registry, candidates }, copy: refs(input.copy), copyResolver: resolver, reviews, releases: [] });
    expect(model.ready).toBe(true);
    expect(JSON.stringify(model.candidates)).toContain("[[fixture.body.");
    expect(resolver.mock.calls.some(([ref]) => ref.id.startsWith("fixture.body.") && ref.locale === "fr")).toBe(true);
    expect(input).toEqual(before);
  });
  it("uses the real Writer engine for approved ICU labels and refuses a draft fixture", () => {
    const registry = { id: "fixture", locale: "en", revision: "r1", source: { kind: "consumer" as const, reference: "fixture" }, entries: [approvedCopyEntry("fixture.count", "{count, plural, one {# item} other {# items}}", ["count"]), { id: "fixture.draft", text: "Draft", context: "Fixture", placeholders: [], status: "draft" as const }] };
    const resolver = createCopyResolver(registry, { now: new Date(copyRefFixtureAt) });
    const field: CopyField = { key: "count", locale: "en", source: "writer", ref: { id: "fixture.count", values: { count: 2 } } };
    const before = structuredClone(field);
    expect(writerLabel(field, "en", resolver)).toBe("2 items");
    expect(writerLabel({ key: "draft", locale: "en", source: "writer", ref: { id: "fixture.draft" } }, "en", resolver)).toBeUndefined();
    expect(field).toEqual(before); expect(registry.entries[1]!.status).toBe("draft");
  });
  it("checks resolution identity and locale trace, and snapshots callback inputs", () => {
    const field: CopyField = { key: "label", source: "writer", locale: "en", ref: { id: "fixture.label", values: { count: 1 } } };
    const resolver = vi.fn(ref => { (ref.values as Record<string, unknown>).count = 9; return pseudo(ref); });
    expect(writerLabel(field, "en", resolver)).toBe("[[fixture.label]]");
    expect(field.ref!.values!.count).toBe(1);
    expect(writerLabel(field, "en", ref => ({ ...pseudo(ref)!, ref: { id: "wrong", locale: "en" } }))).toBeUndefined();
    expect(writerLabel(field, "en", ref => ({ ...pseudo(ref)!, chain: [] }))).toBeUndefined();
  });
});
