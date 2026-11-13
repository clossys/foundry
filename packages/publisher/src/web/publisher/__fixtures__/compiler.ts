import ts from "typescript";
import type { LayoutCompilerPort } from "../../../core/layout-source.js";

const kinds = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
export const fixtureCompiler: LayoutCompilerPort = {
  parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  kind: value => kinds.get((value as ts.Node).kind) ?? "Unknown",
  children: value => { const children: ts.Node[] = []; ts.forEachChild(value as ts.Node, child => { children.push(child); }); return children; },
};
