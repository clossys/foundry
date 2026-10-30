import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Focused layout host: structural classes, no visual styling or reading-order overrides. */
function findings(source: string): string[] {
  const failures: string[] = [];
  const ast = ts.createSourceFile("layout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (/@(?:media|container)\b|matchMedia\s*\(/.test(source)) failures.push("raw query");
  if (/var\([^)]*,/.test(source)) failures.push("token fallback");
  if (/grid-auto-flow\s*:\s*dense|gridAutoFlow\s*:\s*["']dense|\b(?:row|column)-reverse\b/.test(source)) failures.push("reading order");
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const path = (node.moduleSpecifier as ts.StringLiteral).text;
      if (path === "@clossys/designer/tokens" || path === "react-aria-components" || /designer.*(?:src\/|\.\.\/)/.test(path)) failures.push("private visual import");
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (["style", "button", "select", "textarea", "img", "dialog", "input", "a"].includes(node.tagName.getText(ast))) failures.push("visual element");
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "dangerouslySetInnerHTML") failures.push("inline HTML");
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(ast).replace(/["']/g, "");
      if (/^(?:background|color|border|boxShadow|font|filter|backdrop|mask|opacity|order)/.test(key)) failures.push("visual or order style");
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "className") {
      const check = (value: ts.Node) => {
        if (ts.isStringLiteral(value)) for (const token of value.text.split(/\s+/)) {
          if (!/^(?:grid|flex|flex-col|content-center|content-start|gap-(?:md|lg|xl)|grid-cols-[1-4]|(?:col|row)-span-[1-4])$/.test(token)) failures.push(`class: ${token}`);
        }
        else if (ts.isJsxExpression(value) && value.expression) check(value.expression);
        else if (ts.isConditionalExpression(value)) { check(value.whenTrue); check(value.whenFalse); }
        else failures.push("uninspected class expression");
      };
      if (node.initializer) check(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return failures;
}
const root = new URL("./", import.meta.url);
const files = ["Bento.tsx", "SidebarContent.tsx", "Split.tsx", "Stack.tsx", "preview/structure.tsx"];

describe("layout structural purity", () => {
  it("has zero inline styles, width branches or observers in all actual Layout implementations and structural helper", () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, root), "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const styles: string[] = [];
      const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(ast) === "style") styles.push(node.getText(ast)); ts.forEachChild(node, visit); };
      visit(ast); expect(styles, file).toEqual([]);
      expect(source, file).not.toMatch(/\b(?:ResizeObserver|matchMedia|clientWidth|offsetWidth|getBoundingClientRect|columnsAt|breakpoint)\b|props\.(?:width|breakpointValues)/);
    }
  });
  it("keeps the actual selected Layout implementations free of local visual ownership or order overrides", () => {
    for (const file of files) expect(findings(readFileSync(new URL(file, root), "utf8")), file).toEqual([]);
  });
  it("rejects CSS order and raw media query regression samples", () => {
    expect(findings('import { TOKENS } from "@clossys/designer/tokens"')).toContain("private visual import");
    expect(findings('const x = <div className="grid-cols-5"/>')).toContain("class: grid-cols-5");
    expect(findings('const x = <div className="w-full"/>')).toContain("class: w-full");
    expect(findings('const x = <div className="min-w-0"/>')).toContain("class: min-w-0");
    expect(findings('const x = <div className="mx-auto"/>')).toContain("class: mx-auto");
    expect(findings('const x = <div className="col-span-5"/>')).toContain("class: col-span-5");
    expect(findings('const x = <div className="order-2"/>')).toContain("class: order-2");
    expect(findings('const x = <div style={{order: 2}}/>')).toContain("visual or order style");
    expect(findings('const query = "@media (min-width: 768px)"')).toContain("raw query");
    expect(findings('const query = window.matchMedia("(min-width: 768px)")')).toContain("raw query");
    expect(findings('const x = <div className="grid-flow-dense"/>')).toContain("class: grid-flow-dense");
    expect(findings('const x = <div style={{background: "red"}}/>')).toContain("visual or order style");
    expect(findings('const x = <div style={{gap: "var(--spacing-lg, 16px)"}}/>')).toContain("token fallback");
  });
});
