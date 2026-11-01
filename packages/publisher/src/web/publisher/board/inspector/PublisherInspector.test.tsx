// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildPublisherBoard } from "../../../content/board/build.js";
import { buildPublisherInspector } from "../../../content/board/inspector-model.js";
import { PublisherInspector, PublisherBoardInspector } from "./PublisherInspector.js";
import { inspectorFixture } from "./__fixtures__/inspector.js";
import { boardFixture, boardWriterCopy } from "../__fixtures__/board.js";

describe("Designer-only inspector", () => {
  it("renders every category, both locales, and no mutation controls", () => {
    const model = buildPublisherInspector(inspectorFixture());
    const html = renderToStaticMarkup(<PublisherInspector model={model} />);
    const element = document.createElement("div"); element.innerHTML = html;
    expect(element.textContent).toContain("Bonjour");
    expect(element.textContent).toContain("Finish the heading");
    for (const value of ["Candidate detail", "Revision history", "r1", "r2", "Locale copy en", "Locale copy fr", "Approval record", "Approval differs", "Release history", "example-target"]) expect(element.textContent).toContain(value);
    expect(element.querySelectorAll('[data-ds-leaf="sections.record-detail"]').length).toBeGreaterThan(5);
    expect(element.querySelector("button, input, textarea, select, a[href], [contenteditable]")).toBeNull();
    expect(renderToStaticMarkup(<PublisherInspector model={{ ...model, ready: false }} />)).toBe("");
  });
  it("opens the selected slot's inspector from a board candidate using a Designer button", async () => {
    const input = inspectorFixture(), registry = boardFixture();
    const board = buildPublisherBoard({ registry, copy: boardWriterCopy(registry), locale: "en" });
    const model = { ...board, lanes: board.lanes.map(lane => ({ ...lane, groups: lane.groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row, slotId: row.candidateId?.startsWith("site-") ? input.slotId : row.slotId })) })) })) };
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(<PublisherBoardInspector model={model} input={input} />));
      expect(container.textContent).not.toContain("Content inspector");
      const button = [...container.querySelectorAll("button")].find(node => node.textContent === "Writer: Homepage current")!;
      expect(button).toBeDefined();
      await act(async () => button.click());
      expect(container.textContent).toContain("Content inspector");
      expect(container.textContent).toContain("Bonjour");
    } finally { await act(async () => root.unmount()); container.remove(); globals.IS_REACT_ACT_ENVIRONMENT = false; }
  });
  it("uses named Designer exports for all inspector drawing", async () => {
    const source = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "PublisherInspector.tsx"), "utf8");
    const ast = ts.createSourceFile("inspector.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const allowed = new Set(["PublisherBoard", "PublisherInspector"]);
    for (const node of ast.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("@clossys/designer/")) {
      const names = node.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) for (const name of names.elements) allowed.add(name.name.text);
    }
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        expect(allowed.has(node.tagName.getText(ast))).toBe(true);
        for (const prop of node.attributes.properties) if (ts.isJsxAttribute(prop)) expect(["style", "className", "dangerouslySetInnerHTML"]).not.toContain(prop.name.getText(ast));
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  });
});
