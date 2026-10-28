import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { buildPublisherBoard } from "../../content/board/build.js";
import { computeStageReport } from "../../content/stage-engine.js";
import { loadContentStore, writeContentStore } from "../../content/store/index.js";
import { readConsumerLibrarySnapshot } from "../../content/store/library.js";
import type { ContentStoreOptions } from "../../content/store/index.js";
import type { PublisherBoardModel } from "../../content/board/types.js";
import { CONTENT_TREE, loadContentTree } from "../../content/taxonomy.js";
import { PublisherBoard } from "./PublisherBoard.js";
import { boardFixture, boardWriterCopy, boardEvidence, boardLibraries, boardSlotIds } from "./__fixtures__/board.js";

// Only the external consumer-library read is replaced. PB4 persistence, snapshot
// validation, stage derivation, React SSR, and every Designer export remain real.
vi.mock("../../content/store/library.js", () => ({ readConsumerLibrarySnapshot: vi.fn() }));
const options = { designer: { root: "fixture-designer-library", catalog: {} } } as ContentStoreOptions;
const roots: string[] = [];
const stages = ["define", "assemble", "review", "approve", "publish"] as const;
const rows = (model: PublisherBoardModel) => model.lanes.flatMap(lane => lane.groups.flatMap(group => group.rows));
function render(model: PublisherBoardModel) {
  const html = renderToStaticMarkup(<PublisherBoard model={model} />);
  return { html, document: new JSDOM(html).window.document };
}
async function storedFixture() {
  const root = await mkdtemp(join(tmpdir(), "publisher-board-")); roots.push(root);
  const fixture = boardFixture();
  await writeContentStore(root, fixture);
  const loaded = await loadContentStore(root, options);
  const copy = boardWriterCopy(loaded.registry);
  const evidence = boardEvidence(loaded.registry);
  return { root, registry: loaded.registry, copy, evidence };
}
beforeEach(() => { vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue(boardLibraries()[0]!); });
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("Publisher board real-store rendering", () => {
  it("renders all four persisted slots in the default tree's order through Designer sections and Canvas", async () => {
    const fixture = await storedFixture();
    expect(fixture.registry.slots).toHaveLength(4);
    expect(fixture.registry.candidates).toHaveLength(4);
    expect(fixture.registry.candidates.find(candidate => candidate.id === "site-main")?.history).toHaveLength(2);
    const model = buildPublisherBoard({ ...fixture, locale: "en" });
    expect(model.ready).toBe(true); expect(model.needs).toEqual([]);
    expect(model.lanes.map(lane => lane.id)).toEqual(["websites", "documents"]);
    expect(model.lanes[0]!.groups.map(group => group.l2)).toEqual(["site", "admin", "auth"]);
    expect(model.lanes[1]!.groups.map(group => group.l2)).toEqual(["docs"]);
    const { document } = render(model);
    expect(document.querySelector("h1")?.textContent).toBe("Publishing workspace");
    expect(Array.from(document.querySelectorAll("h2, h3"), node => node.textContent)).toEqual([
      "Web experiences", "Public website", "Administration", "Authentication", "Written materials", "Documentation",
    ]);
    expect(document.querySelectorAll('[data-ds-layer="sections"][data-ds-leaf="sections.page-header"][data-ds-fill="foundry/sections.page-header"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-ds-leaf="sections.content"][data-ds-fill="foundry/sections.content"]')).toHaveLength(6);
    expect(document.querySelectorAll('[data-ds-leaf="sections.data-table"][data-ds-fill="foundry/sections.data-table"]')).toHaveLength(4);
    const canvas = document.querySelector('[data-canvas-surface][data-canvas-layout="flow"]');
    expect(canvas?.getAttribute("aria-label")).toBe("Publishing content canvas");
    expect(canvas?.querySelector("[data-canvas-world]")).not.toBeNull();
    expect(canvas?.textContent).toContain("Browse the content stages.");
    expect(document.querySelectorAll('[role="grid"], table')).toHaveLength(4);
    expect(Array.from(document.querySelectorAll('[role="columnheader"], th'), node => node.textContent)).toEqual(
      Array.from({ length: 4 }, () => ["Content slot", "Content candidate", "Definition", "Assembly", "Editorial review", "Owner approval", "Publication"]).flat(),
    );
    for (const row of rows(model)) {
      const rendered = Array.from(document.querySelectorAll('[role="row"], tr')).find(node =>
        Array.from(node.querySelectorAll('[role="gridcell"], [role="rowheader"], td, th')).some(cell => cell.textContent === row.candidateLabel));
      expect(rendered, row.candidateLabel).toBeDefined();
      expect(Array.from(rendered!.querySelectorAll('[role="gridcell"], [role="rowheader"], td, th'), cell => cell.textContent)).toEqual([
        row.slotLabel, row.candidateLabel, ...stages.map(stage => row.cells[stage].label),
      ]);
      if (row.candidateId !== null) {
        const candidate = fixture.registry.candidates.find(value => value.id === row.candidateId)!;
        const evidence = fixture.evidence.find(value => value.candidateId === row.candidateId);
        expect(row.report).toEqual(computeStageReport(candidate, evidence));
        expect(stages.map(stage => row.cells[stage].status)).toEqual(stages.map(stage => row.report!.stages[stage].status));
      }
    }
    const empty = rows(model).find(row => row.slotId === boardSlotIds.auth)!;
    expect(empty.candidateId).toBeNull(); expect(empty.report).toBeNull(); expect(empty.revision).toBeNull();
    expect(stages.map(stage => empty.cells[stage].status)).toEqual([null, null, null, null, null]);
    expect(empty.candidateLabel).toBe("Awaiting a candidate");
    expect(document.querySelector('button, input, textarea, select, [contenteditable="true"], a[href], [role="button"]')).toBeNull();
    expect(document.querySelector('[data-canvas-controls], [data-canvas-minimap], [data-canvas-panel]')).toBeNull();
  });

  it("reorders L1/L2 groups and moves a stored slot without rewriting identities or candidate history", async () => {
    const fixture = await storedFixture();
    const original = buildPublisherBoard({ ...fixture, locale: "en" });
    const history = fixture.registry.candidates.map(candidate => ({ id: candidate.id, slotId: candidate.slotId, history: candidate.history }));
    const slot = fixture.registry.slots.find(value => value.id === boardSlotIds.admin)!;
    const snapshotPaths = fixture.registry.candidates.flatMap(candidate => candidate.history.flatMap(revision => [
      join(fixture.root, "_registry", "candidates", candidate.slotId, candidate.id, `${revision.revision}.json`),
      join(fixture.root, "en", candidate.slotId, candidate.id, `${revision.revision}.copy.json`),
    ]));
    const bytesBefore = await Promise.all(snapshotPaths.map(path => readFile(path, "utf8")));
    const registry = { ...fixture.registry, slots: fixture.registry.slots.map(value => value.id === slot.id
      ? { ...value, l1: "documents", l2: "docs", position: { ...value.position, order: 99 } } : value) };
    await writeContentStore(fixture.root, registry);
    const loaded = await loadContentStore(fixture.root, options);
    const tree = loadContentTree({ ...CONTENT_TREE, nodes: [...CONTENT_TREE.nodes].reverse().map(node => ({ ...node, children: [...node.children].reverse() })) });
    const moved = buildPublisherBoard({ registry: loaded.registry, copy: fixture.copy, evidence: fixture.evidence, tree, locale: "en" });
    expect(moved.ready).toBe(true);
    expect(moved.lanes.map(lane => lane.id)).toEqual(["documents", "websites"]);
    expect(moved.lanes[1]!.groups.map(group => group.l2)).toEqual(["auth", "site"]);
    expect(rows(moved).map(row => row.id).sort()).toEqual(rows(original).map(row => row.id).sort());
    expect(loaded.registry.candidates.map(candidate => ({ id: candidate.id, slotId: candidate.slotId, history: candidate.history }))).toEqual(history);
    expect(await Promise.all(snapshotPaths.map(path => readFile(path, "utf8")))).toEqual(bytesBefore);
    expect(Array.from(render(moved).document.querySelectorAll("h2, h3"), node => node.textContent)).toEqual([
      "Written materials", "Documentation", "Web experiences", "Authentication", "Public website",
    ]);
    expect(moved.lanes[0]!.groups[0]!.rows.map(row => row.slotId)).toEqual([boardSlotIds.docs, boardSlotIds.admin]);
  });

  it("returns a Writer Need and no markup when required locale copy is absent", async () => {
    const fixture = await storedFixture();
    const model = buildPublisherBoard({ ...fixture, locale: "en", copy: fixture.copy.filter(field => field.key !== "stages.approve") });
    expect(model.ready).toBe(false);
    expect(model.needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "stages.approve" }));
    expect(render(model).html).toBe("");
  });

  it("renders an empty persisted inventory using the Writer title and Designer empty section", async () => {
    const root = await mkdtemp(join(tmpdir(), "publisher-board-")); roots.push(root);
    const registry = { ...boardFixture(), slots: [], candidates: [] };
    await writeContentStore(root, registry);
    const loaded = await loadContentStore(root, options);
    const model = buildPublisherBoard({ registry: loaded.registry, copy: boardWriterCopy(registry), locale: "en" });
    expect(model.ready).toBe(true); expect(model.lanes).toEqual([]);
    const { document } = render(model);
    const empty = document.querySelector('[data-ds-layer="sections"][data-ds-leaf="sections.empty-state"][data-ds-fill="foundry/sections.empty-state"]');
    expect(empty?.textContent).toContain("No content slots yet");
    expect(document.querySelector('[data-canvas-surface][data-canvas-layout="flow"]')?.contains(empty)).toBe(true);
    expect(document.querySelector('[data-ds-leaf="sections.data-table"], button, input')).toBeNull();
  });
});

describe("Publisher board composition boundary", () => {
  it("creates UI only through named Designer exports and keeps mutation callbacks out of the view", async () => {
    const source = await readFile(new URL("./PublisherBoard.tsx", import.meta.url), "utf8");
    const ast = ts.createSourceFile("PublisherBoard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const designerNames = new Set<string>();
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== "@clossys/designer/blocks") continue;
      const bindings = statement.importClause?.namedBindings;
      expect(bindings && ts.isNamedImports(bindings)).toBe(true);
      if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
        if (!specifier.isTypeOnly && !statement.importClause?.isTypeOnly) designerNames.add(specifier.name.text);
      }
    }
    const used = new Set<string>();
    const handlers: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(ast); used.add(name);
        expect(designerNames.has(name), `UI element ${name} must be a named Designer export`).toBe(true);
        for (const attribute of node.attributes.properties) {
          expect(ts.isJsxSpreadAttribute(attribute), "UI props must remain reviewable").toBe(false);
          if (!ts.isJsxAttribute(attribute)) continue;
          const prop = attribute.name.getText(ast);
          expect(["className", "style", "dangerouslySetInnerHTML"], name).not.toContain(prop);
          if (/^on[A-Z]/.test(prop)) {
            handlers.push(`${name}.${prop}`);
            const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
            expect(expression?.getText(ast)).toBe(prop === "onViewportChange" ? "setViewport" : "setSelection");
          }
        }
      }
      if (ts.isCallExpression(node)) expect(["createElement", "jsx", "jsxs", "jsxDEV"]).not.toContain(node.expression.getText(ast).split(".").at(-1));
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect([...used].sort()).toEqual(["CanvasSurface", "ContentSection", "DataTable", "EmptyState", "PageHeader"]);
    expect(handlers.sort()).toEqual(["CanvasSurface.onSelectionChange", "CanvasSurface.onViewportChange"]);
  });
});
