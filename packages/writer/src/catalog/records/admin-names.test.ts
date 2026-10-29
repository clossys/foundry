import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import inventory from "../__fixtures__/admin-name-inventory.json" with { type: "json" };
import meta from "./admin-meta.r1.en.json" with { type: "json" };
import studio from "./admin-studio.r1.en.json" with { type: "json" };
import voice from "./admin-voice.r1.en.json" with { type: "json" };
import common from "./common-labels.r1.en.json" with { type: "json" };
import { ADMIN_COMMON_COPY_EN } from "../../admin-common.js";
import terminology from "../admin-terminology.json" with { type: "json" };
import { loadWriterCatalog } from "../ia/index.js";
import { validateWriterRecord } from "../../model/validate.js";
import type { StringRecord, WriterLibrary, WriterRecord } from "../../model/types.js";
import { checkWriterLint } from "../../checks/lint/index.js";
import { writerLintTargets } from "../../checks/lint/targets.js";
import { checkWriterICU } from "../../checks/icu.js";
import { checkWriterLength } from "../../checks/length.js";
import { checkWriterExpansion, writerPseudoLocale } from "../../checks/expansion.js";
import { resolveCopyRef, pseudoLocalize } from "../../index.js";
import ts from "typescript";
import { formatLeaves } from "../../../../publisher/src/formats/slots/formats.js";

const unit = "A4-WR-ADMIN-NAMES";
const files = [meta, studio];
const all = [...voice.records, ...meta.records, ...studio.records, ...ADMIN_COMMON_COPY_EN.records] as StringRecord[];
const batches = files.flatMap(file => file.sourceBatches.filter(batch => batch.unit === unit));
const changedIds = new Set(batches.flatMap(batch => [...batch.recordIds, ...batch.revisions.map(row => row.recordId)]));
const canonicalId = (id: string) => common.usages.find(usage => usage.legacyRecordId === id)?.recordId ?? id;
const canonicalChangedIds = new Set([...changedIds].map(canonicalId));
const changed = all.filter(record => canonicalChangedIds.has(record.id));
const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const library = (records: WriterRecord[]): WriterLibrary => ({ manifest: {
  consumer: "admin-name-draft-review", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }],
  fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
}, locales: { en: { records: [...terminology.lexiconRecords as WriterRecord[], ...records], documents: [] } } });
const binding = (parent: string, id: string) => inventory.entries.find(entry => entry.parent === parent && entry.id === id)!;

function literalArray(name: string, path: string): string[] {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  let values: string[] | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      let value = node.initializer;
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
      if (ts.isCallExpression(value)) value = value.arguments[0]!;
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
      if (ts.isArrayLiteralExpression(value)) values = value.elements.map(element => (element as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source); expect(values, name).toBeDefined(); return values!;
}

describe("admin display-name drafts", () => {
  it("maps every listed value to exactly one unapproved record with no invented leaves", () => {
    const known = new Set(loadWriterCatalog().slots.map(slot => slot.id));
    expect(inventory.entries.length).toBeGreaterThan(400);
    expect(new Set(inventory.entries.map(entry => entry.cellId)).size).toBe(inventory.entries.length);
    for (const entry of inventory.entries) {
      const matches = all.filter(record => record.id === entry.recordId);
      expect(matches, entry.cellId).toHaveLength(1);
      expect(matches[0]).toMatchObject({ status: "draft", text: entry.text });
      expect(matches[0]).not.toHaveProperty("approval");
      const aliases = files.flatMap(file => file.bindings).filter(row => row.cellId === entry.cellId);
      expect(aliases, entry.cellId).toHaveLength(1); expect(aliases[0]!.recordId).toBe(entry.recordId);
      expect(known.has(matches[0]!.leaf), matches[0]!.leaf).toBe(true);
      expect(validateWriterRecord(matches[0]!, "strings"), matches[0]!.id).toEqual([]);
    }
    expect(new Set(all.map(record => record.id)).size).toBe(all.length);
    for (const batch of batches) for (const [path, digest] of Object.entries(batch.sourceFiles))
      expect(createHash("sha256").update(read(path)).digest("hex"), path).toBe(digest);
  });

  it("covers the source registries, layout options, screen sizes, milestones and plan headers", () => {
    const formatsPath = "packages/publisher/src/formats/contract.ts";
    for (const id of literalArray("FORMAT_IDS", formatsPath)) expect(binding("publisher.format", id), id).toBeDefined();
    for (const format of formatLeaves) for (const delivery of format.deliveries)
      expect(binding("publisher.delivery", delivery.id), `${format.id}/${delivery.id}`).toBeDefined();
    const layouts = JSON.parse(read("packages/publisher/src/layouts/slots/layouts.json"));
    for (const layout of layouts) {
      expect(binding("publisher.layout", layout.id), layout.id).toBeDefined();
      for (const config of layout.contract.configs) expect(binding(`publisher.layoutConfig.${layout.id}`, config.id), config.id).toBeDefined();
      for (const [axis, values] of Object.entries(layout.contract.members))
        for (const value of values as string[]) expect(binding(`publisher.layoutOption.${layout.id}.${axis}`, value), value).toBeDefined();
    }
    const frames = JSON.parse(read("packages/designer/src/catalog/slots/frames.json"));
    for (const frame of frames) {
      expect(binding("publisher.frame", frame.id), frame.id).toBeDefined();
      for (const value of frame.contract.members.names) expect(binding(`designer.frameOption.${frame.id}`, value), value).toBeDefined();
    }
    for (const id of ["mobile", "mobile-lg", "tablet", "tablet-lg", "desktop", "wide"]) {
      expect(binding("publisher.screenSize", id)).toBeDefined();
      expect(binding("publisher.breakpoint", `tokens.breakpoint.${id}`)).toBeDefined();
    }
    for (const id of literalArray("MILESTONE_IDS", "packages/publisher/src/planning/menu.ts")) expect(binding("publisher.milestone", id), id).toBeDefined();
    for (const name of ["CANDIDATE_STATES", "CANDIDATE_ORIGINS"]) for (const value of literalArray(name, "packages/publisher/src/content/vocabulary.ts")) expect(binding("admin.enum", value), value).toBeDefined();
    for (const name of ["SLOT_KINDS", "SECTION_INTENTS", "LINK_RELATIONS"]) for (const value of literalArray(name, "packages/publisher/src/content/vocabulary.ts")) expect(binding("publisher.enum", value), value).toBeDefined();
    for (const value of literalArray("PAGE_META_FIELDS", "packages/publisher/src/content/composition.ts"))
      expect(binding("publisher.contentKey", value), value).toBeDefined();
    const headers = [...read("packages/publisher/src/web/publisher/PublisherPlanView.tsx").matchAll(/const (\w+) = messages\?\.\w+ \?\? '/g)].map(match => match[1]!);
    for (const header of headers) expect(binding("publisher.planHeader", header), header).toBeDefined();
    for (let code = 1; code <= 16; code++) expect(binding("publisher.check", `LK${code}`)).toBeDefined();
    expect(binding("publisher.check", "DE2b")).toBeDefined();
    expect(binding("admin.account", "label").text).toBe("Account");
  });

  it("makes sibling display names unique while allowing shared questions and cross-parent copy", () => {
    const parents = new Map<string, string[]>();
    for (const entry of inventory.entries) if (!["instruction", "help", "error"].includes(entry.role)) {
      const names = parents.get(entry.parent) ?? []; names.push(normalize(entry.text)); parents.set(entry.parent, names);
    }
    for (const [parent, names] of parents) expect(new Set(names).size, parent).toBe(names.length);
    const pageNames = ["designer", "writer", "publisher"].map(page => binding("publisher.planPage", `/agents/${page}`));
    expect(pageNames.map(row => row.text)).toEqual(["Designer", "Writer", "Publisher"]);
    expect(new Set(pageNames.map(row => row.recordId)).size).toBe(3);
    const revisions = batches.flatMap(batch => batch.revisions);
    for (const [before, after] of [["Controls", ["Control colors", "Control sizes"]], ["Panels", ["Page panels", "Overlay panels"]]] as const)
      expect(revisions.filter(row => row.before === before).map(row => row.after).sort()).toEqual([...after].sort());
    expect(binding("publisher.setupQuestion", "deliveries.pptx.fidelity").recordId)
      .toBe(binding("publisher.setupQuestion", "deliveries.google-slides.fidelity").recordId);
  });

  it("has zero avoid-term, technical-id and ticket-code hits within the copy budgets", () => {
    const avoid = terminology.terms.flatMap(term => term.avoid);
    const escaped = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const record of changed) {
      for (const term of avoid) expect(record.text, `${record.id}: ${term}`).not.toMatch(new RegExp(`\\b${escaped(term)}\\b`, "i"));
      expect(record.text).not.toMatch(/\b(?:M[1-4]|DE\d+[a-z]?|LK\d+|(?:CP|PB|WR|DG|FR)-\d+)\b/i);
      expect(record.text).not.toMatch(/\b(?:frames|layouts|sections|tokens|brandAssets|content)\.[a-z]/);
      expect(record.text).toMatch(/^[A-Z]/);
      expect(record.text.length).toBeLessThanOrEqual(record.limits!.maxChars!);
    }
    for (const entry of inventory.entries) if (entry.role === "button") expect(entry.text.length).toBeLessThanOrEqual(terminology.budgets.button);
  });

  it("keeps actual Designer siblings and flat layer-board group names distinct", () => {
    const refs = new Map(studio.bindings.map(row => [row.cellId, row.recordId]));
    const name = (cell: string) => all.find(record => record.id === refs.get(cell))!.text;
    const unique = (parent: string, names: string[]) => expect(new Set(names.map(normalize)).size, parent).toBe(names.length);
    for (const layer of ["tokens", "assets", "components", "sections", "frames"]) {
      const tree = JSON.parse(read(`packages/designer/src/catalog/ia/${layer}.json`));
      const groups: string[] = [];
      unique(layer, tree.nodes.map((top: { id: string }) => name(`designer.ia.${layer}.${top.id}`)));
      for (const top of tree.nodes) {
        groups.push(name(`designer.ia.${layer}.${top.id}`));
        unique(`${layer}/${top.id}`, top.children.map((child: { id: string }) => name(`designer.ia.${layer}.${child.id}`)));
        for (const child of top.children) {
          groups.push(name(`designer.ia.${layer}.${child.id}`));
          unique(`${layer}/${top.id}/${child.id}`, child.leaves.map((id: string) => name(`designer.item.${id}`)));
        }
      }
      unique(`${layer} flat board`, groups);
    }
  });

  it("passes actual Writer lint, ICU, length and pseudo expansion for every authored or revised record", () => {
    expect(changed.length).toBeGreaterThan(340);
    expect(changedIds.size).toBe(364);
    expect(new Set(changed.map(record => record.id))).toEqual(canonicalChangedIds);
    for (const id of changedIds) {
      const record = changed.find(record => record.id === canonicalId(id))!;
      expect(record, id).toBeDefined();
      for (const usage of common.usages.filter(usage => usage.legacyRecordId === id)) {
        expect(record.status).toBe(usage.status);
        if (usage.limits.maxChars !== undefined) expect(record.limits?.maxChars).toBeLessThanOrEqual(usage.limits.maxChars);
      }
    }
    const content = library(changed);
    expect(checkWriterLint(content)).toEqual([]); expect(checkWriterICU(content)).toEqual([]);
    expect(checkWriterLength(content)).toEqual([]); expect(checkWriterExpansion(content)).toEqual([]);
    const linted = new Set(writerLintTargets(content).map(row => row.recordId));
    const pseudo = new Set(writerPseudoLocale(content).locales.flatMap(locale => locale.fields.map(field => field.recordId)));
    for (const record of changed) {
      expect(linted.has(record.id), record.id).toBe(true); expect(pseudo.has(record.id), record.id).toBe(true);
      for (const locale of ["en-XA", "ar-XB"] as const) expect(pseudoLocalize(record.text, locale).length).toBeGreaterThan(0);
    }
    expect(checkWriterLint(library([{ ...changed[0]!, text: "Please utilize this leaf." }]))).toContainEqual(expect.objectContaining({ code: "WR5" }));
  });

  it("never treats the drafts as approved production text", () => {
    const registry = { id: "admin-name-drafts", locale: "en", revision: "r1", source: { kind: "generated" as const, reference: "draft naming review" }, entries: changed.map(record => ({ id: record.id, text: record.text, context: record.context, status: record.status })) };
    for (const record of changed) {
      const result = resolveCopyRef(registry, { id: record.id, locale: "en" }, { target: "production" });
      expect(result.complete, record.id).toBe(false); expect(result.resolution).toBeUndefined();
    }
  });
});
