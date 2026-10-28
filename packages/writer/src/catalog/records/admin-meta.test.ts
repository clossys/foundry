import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SemanticContent } from "../../../../designer/src/components/SemanticContent.js";
import voice from "./admin-voice.r1.en.json" with { type: "json" };
import terminology from "../admin-terminology.json" with { type: "json" };
import { validateWriterRecord } from "../../model/validate.js";
import type { StringRecord, WriterLibrary, WriterRecord } from "../../model/types.js";
import { loadWriterCatalog } from "../ia/index.js";
import { checkWriterLint } from "../../checks/lint/index.js";
import { writerLintTargets } from "../../checks/lint/targets.js";
import { checkWriterICU } from "../../checks/icu.js";
import { checkWriterLength } from "../../checks/length.js";
import { checkWriterExpansion, writerPseudoLocale } from "../../checks/expansion.js";
import { resolveCopyRef } from "../../resolve.js";

interface Review {
  recordId: string; cellId: string; before: string; after: string; rationale: string; budget: number;
  source: { commit: string; path: string; line: number }; scope: string;
}
interface Envelope {
  version: number; revision: number; state: string; locale: string; activation: string; sourceCommit: string;
  sourceFiles: Record<string, string>; records: StringRecord[]; reviews: Review[];
  needs: { recordId?: string; cellId: string; severity: string; status: string; message: string }[];
  bindings: { cellId: string; recordId: string; target: string; kind: string }[];
  coverage: { kind: string; productionBound: number; proposedBindings: number };
  sourceBatches?: { unit: string; sourceCommit: string; recordIds: string[]; sourceFiles: Record<string, string> }[];
}
const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const draft = (name: string): Envelope => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const files = ["admin-meta.r1.en.json", "admin-studio.r1.en.json"] as const;
const library = (records: WriterRecord[]): WriterLibrary => ({
  manifest: { consumer: "admin-meta-draft-review", messageSyntax: "icu-mf1", defaultLocale: "en",
    locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: { en: { records: [...terminology.lexiconRecords as WriterRecord[], ...records], documents: [] } },
});

// This is a planned-binding fixture, not an assertion about the three production pages.
// Each semantic field resolves a CopyRef before rendering through Foundry content.
function bindingFixture(envelope: Envelope, resolve: (id: string) => string, literal?: string): string {
  return renderToStaticMarkup(createElement(SemanticContent, { as: "section" },
    ...envelope.bindings.map(binding => createElement(SemanticContent, { as: "p", key: binding.cellId,
      "data-binding": binding.cellId }, resolve(binding.recordId))),
    createElement(SemanticContent, { as: "code", "data-copy-value": "technical" }, "components.button"),
    literal === undefined ? null : createElement(SemanticContent, { as: "p" }, literal)));
}
function unwrapped(markup: string): string[] {
  const { document, NodeFilter } = new JSDOM("").window;
  const element = document.createElement("section"); element.innerHTML = markup;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const failures: string[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode, value = node.textContent?.trim() ?? "";
    if (node.parentElement?.closest('[data-copy-value="technical"]')) continue;
    if (value && !/^\[\[st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}\]\]$/.test(value)) failures.push(value);
  }
  return failures;
}

for (const file of files) describe(file, () => {
  it("adds only unapproved draft strings with evidence and one rationale per record", () => {
    const envelope = draft(file), known = new Set(loadWriterCatalog().slots.map(slot => slot.id));
    expect(envelope).toMatchObject({ version: 1, revision: 1, state: "draft", locale: "en", activation: "none",
      sourceCommit: "cf91e48ecf01ebc20c00b1e00c2fe887acd537ae" });
    expect(envelope.records.length).toBeGreaterThan(0);
    expect(envelope.reviews).toHaveLength(envelope.records.length);
    expect(new Set(envelope.reviews.map(row => row.cellId)).size).toBe(envelope.records.length);
    for (const record of envelope.records) {
      expect(record.status).toBe("draft"); expect(record).not.toHaveProperty("approval");
      expect(known.has(record.leaf), record.leaf).toBe(true);
      expect(validateWriterRecord(record, "strings"), record.id).toEqual([]);
      const review = envelope.reviews.find(row => row.recordId === record.id)!;
      expect(review).toBeDefined(); expect(review.after).toBe(record.text);
      expect(review.rationale.length).toBeGreaterThan(25); expect(review.before.length).toBeGreaterThan(0);
      expect(review.scope).toBe("draft only"); expect(review.budget).toBe(record.limits?.maxChars);
      const batch = envelope.sourceBatches?.find(batch => batch.recordIds.includes(record.id));
      expect(review.source.commit).toBe(batch?.sourceCommit ?? envelope.sourceCommit);
      expect(review.source.line).toBeGreaterThan(0);
      expect(review.source.line).toBeLessThanOrEqual(read(review.source.path).split("\n").length);
      expect(envelope.needs).toContainEqual(expect.objectContaining({ recordId: record.id, status: "Need" }));
    }
    for (const [path, digest] of Object.entries(envelope.sourceFiles))
      expect(createHash("sha256").update(read(path)).digest("hex"), path).toBe(digest);
  });

  it("runs actual lint, ICU, length and pseudo expansion over every new record", () => {
    const records = draft(file).records, content = library(records);
    expect(checkWriterLint(content)).toEqual([]); expect(checkWriterICU(content)).toEqual([]);
    expect(checkWriterLength(content)).toEqual([]); expect(checkWriterExpansion(content)).toEqual([]);
    const targets = new Set(writerLintTargets(content).map(target => target.recordId));
    const fields = new Set(writerPseudoLocale(content).locales.flatMap(locale => locale.fields.map(field => field.recordId)));
    for (const record of records) { expect(targets.has(record.id), record.id).toBe(true); expect(fields.has(record.id), record.id).toBe(true); }
    expect(checkWriterLint(library([{ ...records[0]!, text: "Please utilize this leaf." }]))).toContainEqual(expect.objectContaining({ code: "WR5" }));
    expect(checkWriterICU(library([{ ...records[0]!, text: "{total, plural, one {item}}" }]))).toContainEqual(expect.objectContaining({ code: "WR8" }));
    expect(checkWriterExpansion(library([{ ...records[0]!, text: "Open", args: [], limits: { maxChars: 4 } }]))).toContainEqual(expect.objectContaining({ code: "WR9" }));
  });

  it("hand-rolls its planned fields through a pseudo resolver with zero unwrapped text", () => {
    const envelope = draft(file), known = new Set([...voice.records, ...files.flatMap(file => draft(file).records)].map(record => record.id));
    const calls: string[] = [];
    const pseudo = (id: string) => { if (!known.has(id)) throw new Error(`Need: missing Writer record ${id}`); calls.push(id); return `[[${id}]]`; };
    expect(envelope.bindings.length).toBeGreaterThanOrEqual(envelope.records.length);
    expect(new Set(envelope.bindings.map(row => row.cellId)).size).toBe(envelope.bindings.length);
    expect(unwrapped(bindingFixture(envelope, pseudo))).toEqual([]);
    expect(calls).toEqual(envelope.bindings.map(row => row.recordId));
    for (const record of envelope.records) expect(calls).toContain(record.id);
    expect(unwrapped(bindingFixture(envelope, pseudo, "Loading…"))).toEqual(["Loading…"]);
    expect(() => pseudo("st.0000000000")).toThrow("Need: missing Writer record");
    expect(envelope.coverage).toMatchObject({ kind: "planned binding fixture; not rendered-page coverage", productionBound: 0,
      proposedBindings: envelope.bindings.length });
  });

  it("refuses every new draft for production", () => {
    const records = draft(file).records;
    const registry = { id: file, locale: "en", revision: "r1", source: { kind: "generated" as const, reference: "draft copy review" },
      entries: records.map(record => ({ id: record.id, text: record.text, context: record.context, status: record.status })) };
    for (const record of records) {
      const result = resolveCopyRef(registry, { id: record.id, locale: "en" }, { target: "production" });
      expect(result.complete, record.id).toBe(false); expect(result.resolution).toBeUndefined();
    }
  });
});

it("uses globally unique opaque IDs without changing existing admin voice records", () => {
  const additions = files.flatMap(file => draft(file).records);
  const ids = [...voice.records, ...terminology.lexiconRecords, ...additions].map(record => record.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it("covers metadata, shell states and preview/action proposals for all three routes", () => {
  const envelope = draft(files[0]);
  for (const page of ["designer", "writer", "publisher"])
    for (const field of ["title", "description", "shareTitle", "shareDescription", "navLabel", "emptyTitle", "emptyBody", "loading", "error"])
      expect(envelope.bindings.some(row => row.cellId === `admin.${page}.${field}`), `${page}.${field}`).toBe(true);
  expect(envelope.needs.some(row => row.cellId === "WR-META.PREVIEW-STATUS-SOURCE")).toBe(true);
  for (const action of ["openItem", "closeItem", "inspectFormat", "closeFormat", "openFormatOwner", "commerce", "applyConfiguration", "resetConfiguration"])
    expect(envelope.bindings.some(row => row.cellId === `publisher.actions.${action}`), action).toBe(true);
});

it("covers actual IA groups and every registered item with a display-name binding", () => {
  const envelope = draft(files[1]);
  for (const layer of ["tokens", "assets", "components", "sections", "frames"]) {
    const tree = JSON.parse(read(`packages/designer/src/catalog/ia/${layer}.json`));
    for (const l1 of tree.nodes) {
      expect(envelope.bindings.some(row => row.cellId === `designer.ia.${layer}.${l1.id}`)).toBe(true);
      for (const l2 of l1.children) expect(envelope.bindings.some(row => row.cellId === `designer.ia.${layer}.${l2.id}`)).toBe(true);
    }
    const slots = JSON.parse(read(`packages/designer/src/catalog/slots/${layer}.json`));
    for (const slot of slots) expect(envelope.bindings.some(row => row.cellId === `designer.item.${slot.id}`), slot.id).toBe(true);
  }
});

it("supplies a resolved-count formatter, each supported check name and each check-message variant", () => {
  const envelope = draft(files[1]);
  expect(envelope.bindings.some(row => row.cellId === "designer.scorecard.resolvedCount")).toBe(true);
  for (let code = 1; code <= 10; code++) expect(envelope.bindings.some(row => row.cellId === `designer.check.C${code}`)).toBe(true);
  const path = "packages/designer/src/catalog-core/check.ts";
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const messages: { code: string; line: number; expression: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "add"
      && node.arguments.length >= 4 && ts.isStringLiteral(node.arguments[0]!) && /^C\d+$/.test(node.arguments[0]!.text)) {
      // Binding metadata wraps the same diagnostic expression; it does not rewrite it.
      const diagnostic = node.arguments[3]!;
      const message = ts.isObjectLiteralExpression(diagnostic)
        ? diagnostic.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name) && property.name.text === "message")!.initializer
        : diagnostic;
      if (ts.isObjectLiteralExpression(diagnostic)) {
        const copy = diagnostic.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name) && property.name.text === "copy")!;
        const reference = (copy.initializer as ts.ObjectLiteralExpression).properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "id")!;
        const index = messages.length;
        const proposed = envelope.reviews.filter(row => row.cellId.startsWith("designer.finding."));
        expect((reference.initializer as ts.StringLiteral).text).toBe(proposed[index]!.recordId);
      }
      messages.push({ code: node.arguments[0]!.text, line: source.getLineAndCharacterOfPosition(message.getStart()).line + 1,
        expression: message.getText(source) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const proposed = envelope.reviews.filter(row => row.cellId.startsWith("designer.finding."));
  expect(envelope.bindings.filter(row => row.kind === "finding")).toHaveLength(messages.length);
  for (const [index, message] of messages.entries()) {
    expect(proposed[index]).toMatchObject({ cellId: `designer.finding.${message.code}.${String(index + 1).padStart(2, "0")}`,
      source: { path, line: message.line }, sourceExpression: message.expression });
  }
  expect(envelope.needs.some(row => row.cellId === "WR-META.STRUCTURED-FINDING-ARGS")).toBe(true);
});
