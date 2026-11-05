// @vitest-environment node
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { emittedIconLeaf, emittedIconLeafPaths } from "./__fixtures__/emitted-icon-leaf.js";

/**
 * Type-level check of the emitted icon call sites. The rewrite turns every shadcn glyph into
 * `<LibraryIcon asset=… />`, and the persist emitter writes the asset Icon leaf those calls
 * resolve to. A parse-only golden cannot see whether a call satisfies the leaf's props (the Icon
 * accessibility contract is a compile-time union), so this runs the TypeScript checker over the
 * real emitted leaf, the real emitted glyph module and every rewritten call site, with consumer
 * compiler options (strict, Bundler resolution).
 */
const designerSrc = resolve(import.meta.dirname, "..");
// Virtual files live inside the package so "react" resolves from its real node_modules.
const root = resolve(designerSrc, "__icon_typecheck__");
const bundles = loadCatalogBundles();

/** Every `<LibraryIcon … />` element in the materialized shadcn sources, as written. */
function emittedIconCalls(): { file: string; text: string }[] {
  const calls: { file: string; text: string }[] = [];
  for (const bundle of bundles.sourceBundles) for (const file of bundle.files.filter(file => file.path.endsWith(".tsx"))) {
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "LibraryIcon") calls.push({ file: file.path, text: node.getText(source) });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

function typecheck(files: Record<string, string>): string[] {
  const virtual = new Map(Object.entries(files).map(([path, content]) => [resolve(root, path), content]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, types: [],
    paths: { ...emittedIconLeafPaths },
  };
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = name => virtual.has(name) || fileExists.call(host, name);
  host.readFile = name => virtual.get(name) ?? readFile.call(host, name);
  host.directoryExists = name => [...virtual.keys()].some(path => dirname(path).startsWith(name)) || ts.sys.directoryExists(name);
  host.getSourceFile = (name, language, onError, create) => virtual.has(name)
    ? ts.createSourceFile(name, virtual.get(name)!, language, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    : getSourceFile.call(host, name, language, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const where = diagnostic.file ? `${diagnostic.file.fileName.replace(root + "/", "")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : "";
    return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

describe("emitted icon usage typechecks against the emitted asset Icon leaf", () => {
  const calls = emittedIconCalls();
  const assets = [...new Set(calls.map(call => /\basset="([^"]+)"/.exec(call.text)?.[1]).filter((asset): asset is string => !!asset))].sort();
  it("covers every rewritten icon call site", () => {
    // The shadcn sources a product library composes: the eight leaves whose glyphs the rewrite binds.
    expect([...new Set(calls.map(call => call.file.split("/")[1]))].sort()).toEqual(expect.arrayContaining(["breadcrumbs", "calendar", "checkbox", "combo-box", "dialog", "disclosure", "menu", "select"]));
    expect(calls.length).toBeGreaterThanOrEqual(18);
    expect(calls.every(call => /\basset="assets\.[a-z0-9-]+"/.test(call.text)), calls.map(call => call.text).join("\n")).toBe(true);
  });
  it("tsc reports no error for any call site", () => {
    const leaf = emittedIconLeaf(assets);
    expect(leaf.map(file => file.path).sort()).toEqual(["assets/glyphs.ts", "components/icon/index.ts"]);
    const sample = [
      'import { Icon as LibraryIcon } from "./components/icon/index.js";',
      "export const samples = [",
      ...calls.map(call => `  ${call.text.replace(/\s+/g, " ")}, // ${call.file}`),
      "];",
    ].join("\n") + "\n";
    expect(typecheck({ ...Object.fromEntries(leaf.map(file => [file.path, file.content])), "sample.tsx": sample })).toEqual([]);
  }, 60_000);
});
