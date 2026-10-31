#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import assert from "node:assert/strict";
import ts from "typescript";

// Source-only report generation: no build, network, runtime rendering or materialization.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const read = path => readFileSync(resolve(root, path), "utf8");
const json = path => JSON.parse(read(path));
const args = process.argv.slice(2);
assert(args.length === 1 && ["--check", "--write"].includes(args[0]), "usage: components-coverage.mjs --check|--write");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(src).href + "/")) {
      const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(target)) return { url: target.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(src).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")), shortCircuit: true };
    return next(url, context);
  },
});
const { buildComponentsConsumption } = await import(pathToFileURL(resolve(src, "catalog-core/consumption.ts")).href);
const { stableStringify } = await import(pathToFileURL(resolve(src, "catalog-core/stable.ts")).href);
const { importShadcnAriaComponents } = await import(pathToFileURL(resolve(src, "importers/shadcn-aria-components.ts")).href);
const inventory = Object.fromEntries(["themes", "assets", "components"].map(layer => [layer, json(`src/catalog/slots/${layer}.json`)]));
for (const [layer, count] of [["themes", 42], ["assets", 45], ["components", 57]]) {
  const ids = inventory[layer].map(slot => slot.id).sort();
  assert.equal(ids.length, count, `${layer} leaf count changed`);
  assert.equal(new Set(ids).size, count, `${layer} duplicate leaf`);
  assert.deepEqual(ids, [...json(`src/catalog/ia/${layer}.leaf-freeze.json`).leafIds].sort(), `${layer} signed leaf inventory changed`);
}
const docs = ["foundry", "shadcn@aria"].flatMap(source => readdirSync(resolve(src, `catalog/fills/${source}`)).filter(name => /^components\.(?!coverage\.)[^/]+\.json$/.test(name)).sort().map(name => json(`src/catalog/fills/${source}/${name}`)));
const fills = docs.flatMap(doc => Object.values(doc.components).map(fill => ({ ...fill, id: doc.$extensions["com.clossys.fill"].id, conforms: doc.$extensions["com.clossys.fill"].conforms, evidence: doc.$extensions["com.clossys.fill"].evidence })));
assert.equal(new Set(fills.map(fill => fill.id)).size, fills.length, "duplicate component descriptor");

const printer = ts.createPrinter({ removeComments: true });
const modules = new Map();
const localPath = (file, specifier) => {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(file), specifier.replace(/\.js$/, ""));
  return [base + ".ts", base + ".tsx", resolve(base, "index.ts")].find(path => existsSync(path));
};
const names = node => ts.isIdentifier(node) ? [node.text] : ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) ? node.elements.flatMap(element => ts.isBindingElement(element) ? names(element.name) : []) : [];
function moduleInfo(file) {
  if (modules.has(file)) return modules.get(file);
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const info = { ast, declarations: new Map(), imports: new Map(), exports: new Map() };
  modules.set(file, info);
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
      const target = localPath(file, statement.moduleSpecifier.text);
      if (!target) continue;
      const clause = statement.importClause;
      if (clause.name) info.imports.set(clause.name.text, { file: target, name: "default" });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly) info.imports.set(binding.name.text, { file: target, name: binding.propertyName?.text ?? binding.name.text });
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) info.imports.set(clause.namedBindings.name.text, { file: target, name: "*" });
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const target = statement.moduleSpecifier ? localPath(file, statement.moduleSpecifier.text) : file;
      for (const binding of statement.exportClause.elements) if (!binding.isTypeOnly && target) info.exports.set(binding.name.text, { file: target, name: binding.propertyName?.text ?? binding.name.text });
    }
    const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) for (const name of names(declaration.name)) {
      // Keep one declaration, not unrelated siblings in the same const statement.
      info.declarations.set(name, ts.factory.updateVariableStatement(statement, statement.modifiers, ts.factory.updateVariableDeclarationList(statement.declarationList, [declaration])));
      if (exported) info.exports.set(name, { file, name });
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      info.declarations.set(statement.name.text, statement);
      if (exported) info.exports.set(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name.text, { file, name: statement.name.text });
    }
  }
  return info;
}
function exportTarget(file, name, seen = new Set()) {
  const key = `${file}#${name}`;
  if (seen.has(key)) throw new Error("Cyclic export alias");
  seen.add(key);
  const target = moduleInfo(file).exports.get(name);
  assert(target, `Missing package export ${relative(root, file)}#${name}`);
  return target.file === file && target.name === name ? target : exportTarget(target.file, target.name, seen);
}
const pointerTarget = pointer => {
  const match = /^\.\/(components|charts|shell)#([A-Za-z][A-Za-z0-9]*)/.exec(pointer);
  assert(match, "Invalid package pointer");
  return exportTarget(resolve(src, match[1], "index.ts"), match[2]);
};
const owners = new Map();
for (const fill of fills.filter(fill => fill.source === "foundry")) for (const pointer of [fill.pin.export, ...Object.values(fill.propMap)]) {
  const target = pointerTarget(pointer), key = `${target.file}#${target.name}`;
  owners.set(key, [...new Set([...(owners.get(key) ?? []), fill.slot])]);
}
// Data tables and glyph-provider defaults are dependency injection boundaries. Reading
// their entire inventory would falsely attribute every token/glyph to every caller.
const boundaries = new Set([resolve(src, "tokens/tokens.ts"), resolve(src, "components/glyph-context.ts")]);
function scanPackage(fill) {
  const selected = new Map(), seen = new Set(), components = new Set();
  function visit(file, name) {
    if (boundaries.has(file)) return;
    const key = `${file}#${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    for (const slot of owners.get(key) ?? []) if (slot !== fill.slot) components.add(slot);
    const info = moduleInfo(file);
    if (name === "*") { for (const symbol of info.exports.keys()) { const target = exportTarget(file, symbol); visit(target.file, target.name); } return; }
    const node = info.declarations.get(name);
    if (!node) return;
    if (!selected.has(file)) selected.set(file, new Map());
    selected.get(file).set(name, printer.printNode(ts.EmitHint.Unspecified, node, info.ast));
    const references = new Set();
    const walk = node => {
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
      if (ts.isIdentifier(node)) references.add(node.text);
      ts.forEachChild(node, walk);
    };
    walk(node);
    for (const symbol of references) {
      const imported = info.imports.get(symbol);
      if (imported) {
        if (imported.name === "*") visit(imported.file, "*");
        else { const target = exportTarget(imported.file, imported.name); visit(target.file, target.name); }
      } else if (info.declarations.has(symbol)) visit(file, symbol);
    }
  }
  for (const pointer of [fill.pin.export, ...Object.values(fill.propMap)]) { const target = pointerTarget(pointer); visit(target.file, target.name); }
  return { fill: fill.id, files: [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([file, snippets]) => ({ path: relative(root, file).split("\\").join("/"), content: [...snippets].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n") })), components: [...components].sort() };
}
const fixture = "src/importers/__fixtures__/shadcn-aria";
const upstream = importShadcnAriaComponents({
  items: readdirSync(resolve(root, fixture)).filter(name => name.endsWith(".json")).map(name => json(`${fixture}/${name}`)).filter(item => item.type === "registry:ui"),
  styles: { path: "apps/v4/registry/styles/style-nova.css", content: read(`${fixture}/style-nova.css`) },
  notice: { path: "LICENSE.md", content: read(`${fixture}/LICENSE.md`) },
});
const scans = fills.map(fill => {
  if (fill.source === "foundry") return scanPackage(fill);
  const rewritten = upstream.rewrites[fill.item];
  assert(rewritten, `Missing rewrite inventory for ${fill.id}`);
  // A scan is bound to the descriptor's exact rewritten bytes, including blockers.
  assert.deepEqual(rewritten.outputSha256, fill.outputSha256, `Stale source descriptor ${fill.id}`);
  assert.deepEqual(JSON.parse(JSON.stringify(rewritten.issues)), fill.blockers, `Stale blocker inventory ${fill.id}`);
  return { fill: fill.id, files: rewritten.files.map(file => {
    const ast = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return { path: file.path, content: printer.printFile(ast) };
  }), components: rewritten.reads.components };
});
const input = { ...inventory, fills, sourceScans: scans,
  themeCss: read("styles/theme.css") + "\n" + read("styles/theme-keys.css"),
  foundryCoverage: json("src/catalog/fills/foundry/components.coverage.json").coverage,
  shadcnReceipt: json("src/catalog/fills/shadcn@aria/components.coverage.json").receipt,
};
const report = buildComponentsConsumption(input);
const bytes = stableStringify(report);
assert.equal(bytes, stableStringify(buildComponentsConsumption({ ...input, fills: [...input.fills].reverse(), sourceScans: [...scans].reverse() })), "Nondeterministic component report");
const target = resolve(src, "catalog/reports/components-consumption.json");
if (args[0] === "--write") { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
else assert.equal(readFileSync(target, "utf8"), bytes, "Component report is stale; run components-coverage.mjs --write");
console.log(JSON.stringify({ mode: args[0], freshness: "current", inventory: { themes: inventory.themes.length, assets: inventory.assets.length, components: inventory.components.length }, ...report.summary, conformance: "unmeasured" }));
