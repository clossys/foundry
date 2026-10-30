#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const allLayers = ["components", "sections", "frames"];
const filesBelow = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesBelow(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const value = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
const sourcePath = file => file.replace(/\/dist\//, "/src/").replace(/\.[cm]?js$/, ".ts");

/** Inventory declaration identities, never source labels or public barrel names. */
export function checkOneLeafSource(repository, layers = allLayers) {
  if (!layers.length || layers.some(layer => !allLayers.includes(layer))) throw new Error("Invalid inventory layers");
  const root = path.resolve(repository), directory = path.join(root, "packages/designer"), catalog = path.join(directory, "src/catalog");
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  const findings = [], leaves = new Map(), names = new Map();
  const add = (rule, leaf, detail, file) => findings.push({ rule, leaf, detail, ...(file ? { file: relative(file) } : {}) });
  const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
  const roster = read(path.join(catalog, "rules/source-roster.json"));
  for (const layer of layers) {
    const slots = read(path.join(catalog, `slots/${layer}.json`));
    if (!Array.isArray(slots) || !slots.length || !Array.isArray(roster[layer]) || !roster[layer].length) throw new Error(`Missing or empty ${layer} catalog/roster input`);
    for (const slot of slots) {
      if (typeof slot.id !== "string" || !slot.id.startsWith(`${layer}.`) || leaves.has(slot.id)) throw new Error(`Invalid or duplicate catalog id ${slot.id}`);
      leaves.set(slot.id, { leaf: slot.id, implementations: new Map(), descriptors: [], offers: [] });
    }
    for (const row of roster[layer]) for (const leaf of row.leaves ?? []) {
      if (!leaves.has(leaf)) { add("unknown-roster-leaf", leaf, "Roster leaf is absent from catalog"); continue; }
      for (const offer of row.offers ?? []) if (offer.leaves?.includes(leaf)) leaves.get(leaf).offers.push(offer.source);
    }
  }
  const owners = ["designer", "publisher"].map(name => {
    const directory = path.join(root, "packages", name);
    return { directory, manifest: read(path.join(directory, "package.json")) };
  });
  const sources = owners.flatMap(owner => filesBelow(path.join(owner.directory, "src"))).filter(file => /\.[cm]?tsx?$/.test(file) && !/(?:\.(?:test|spec|stories|check)\.|\/__(?:fixtures|golden)__\/)/.test(file));
  if (!sources.length) throw new Error("Empty source inventory");
  const program = ts.createProgram(sources, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true, resolveJsonModule: true });
  const checker = program.getTypeChecker();
  for (const file of sources) {
    const source = program.getSourceFile(file);
    if (!source || source.parseDiagnostics.length) add("invalid-source-input", "*", source ? ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ") : "Source absent from parsed program", file);
  }
  const symbolOf = node => {
    let symbol = checker.getSymbolAtLocation(node); const seen = new Set();
    while (symbol?.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) { seen.add(symbol); symbol = checker.getAliasedSymbol(symbol); }
    return symbol;
  };
  const declarations = node => symbolOf(node)?.declarations ?? [];
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  };
  // A direct alias is one source. A function with its own logic/markup is an
  // implementation, even if its public name or provenance matches another.
  function identity(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (ts.isVariableDeclaration(node)) {
      const expression = unwrap(node.initializer);
      if (!expression) return [];
      if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) return declarations(expression).flatMap(item => identity(item, seen));
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return identity(expression, seen);
      if (ts.isCallExpression(expression) && /^(?:React\.)?(?:memo|forwardRef)$/.test(expression.expression.getText())) return identity(unwrap(expression.arguments[0]), seen);
      if (ts.isCallExpression(expression) && expression.expression.getText() === "Object.assign") return declarations(expression.arguments[0]).flatMap(item => identity(item, seen));
    }
    if (!(ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node))) return [];
    const body = node.body, statements = body && ts.isBlock(body) ? body.statements : [];
    const returned = unwrap(statements.length === 1 && ts.isReturnStatement(statements[0]) ? statements[0].expression : body && !ts.isBlock(body) ? body : undefined);
    if (returned && (ts.isJsxSelfClosingElement(returned) || ts.isJsxElement(returned))) {
      const tag = ts.isJsxElement(returned) ? returned.openingElement.tagName : returned.tagName;
      const forwarded = declarations(tag).flatMap(item => identity(item, seen));
      if (forwarded.length) return forwarded;
    }
    let rendered = false;
    const visit = child => { if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child) || ts.isCallExpression(child) && /(?:^|\.)(?:createElement|jsx|jsxs)$/.test(child.expression.getText())) rendered = true; ts.forEachChild(child, visit); };
    visit(node);
    if (!rendered) {
      // Forwarding shims commonly return a call or a single JSX component.
      const expression = returned;
      if (expression && ts.isCallExpression(expression)) return declarations(expression.expression).flatMap(item => identity(item, seen));
      return [];
    }
    const source = node.getSourceFile();
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    return [{ key: `${relative(source.fileName)}:${node.getStart(source)}`, file: relative(source.fileName), line, name: node.name?.getText() ?? node.parent?.name?.getText() ?? "render" }];
  }
  function exported(file, name) {
    if (!fs.existsSync(file)) file = file.replace(/\.ts$/, ".tsx");
    if (!fs.existsSync(file)) return [];
    const source = program.getSourceFile(file);
    if (!source || source.parseDiagnostics.length) return [];
    const symbol = checker.getSymbolAtLocation(source);
    let target = symbol && checker.getExportsOfModule(symbol).find(item => item.name === name);
    if (target?.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
    return (target?.declarations ?? []).flatMap(item => identity(item));
  }
  function packageEntry(impl, pin) {
    const owner = owners.find(row => impl?.module === row.manifest.name || impl?.module?.startsWith(`${row.manifest.name}/`) || row.manifest.name === pin?.package);
    if (!owner) return [];
    const subpath = impl?.module ? `.${impl.module.slice(owner.manifest.name.length)}` || "." : pin.export?.split("#")[0];
    const target = owner.manifest.exports?.[subpath];
    const output = typeof target === "string" ? target : target?.import ?? target?.default;
    return typeof output === "string" ? exported(sourcePath(path.resolve(owner.directory, output)), impl?.export ?? pin.export?.split("#")[1]) : [];
  }
  const insert = (leaf, entries, evidence) => {
    const row = leaves.get(leaf);
    for (const item of entries) { const existing = row.implementations.get(item.key); if (existing) existing.evidence.push(evidence); else row.implementations.set(item.key, { ...item, evidence: [evidence] }); }
  };
  const fillFiles = filesBelow(path.join(catalog, "fills")).filter(file => file.endsWith(".json"));
  if (!fillFiles.length) throw new Error("Empty fill descriptor inventory");
  for (const file of fillFiles) {
    const doc = read(file), meta = doc.$extensions?.["com.clossys.fill"];
    if (!meta || !layers.some(layer => meta.slot?.startsWith(`${layer}.`)) || meta.mode !== "implementation") continue;
    if (!leaves.has(meta.slot)) { add("unknown-fill-leaf", meta.slot, meta.id, file); continue; }
    // Never-offered upstream references are still inspected for valid inputs,
    // but do not manufacture a selectable native implementation.
    if (roster.never?.includes(meta.source)) continue;
    const row = leaves.get(meta.slot); row.descriptors.push({ file: relative(file), source: meta.source });
    const layer = meta.slot.split(".")[0], entries = Object.values(doc[layer] ?? {}).filter(item => item.slot === meta.slot && item.source === meta.source);
    if (!entries.length) add("missing-fill-implementation", meta.slot, `${meta.id}: no matching descriptor implementation`, file);
    for (const entry of entries) {
      for (const input of entry.consumption?.sourceFiles ?? []) if (!fs.existsSync(path.resolve(root, input.path))) add("missing-source-input", meta.slot, input.path, file);
      const impl = entry.impl;
      if (impl?.export) { const ids = names.get(impl.export) ?? new Set(); ids.add(meta.slot); names.set(impl.export, ids); }
      const resolved = impl?.kind === "package" ? packageEntry(impl, entry.pin ?? meta.pin) : impl?.kind === "source" && typeof impl.entry === "string" ? exported(path.join(directory, "src/components/preview-runtime", impl.entry), impl.export) : [];
      if (!resolved.length) add("unresolved-fill-source", meta.slot, `${meta.id}: ${JSON.stringify(impl)}`, file);
      insert(meta.slot, resolved, relative(file));
    }
  }
  // Inventory all native top-level exports with a descriptor's declared export
  // identity. This catches copied bodies even when the copy is not in a barrel.
  for (const file of sources) {
    const source = program.getSourceFile(file); if (!source) continue;
    for (const statement of source.statements) {
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const candidates = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
      for (const candidate of candidates) for (const leaf of names.get(candidate.name?.getText()) ?? []) insert(leaf, identity(candidate), `native export ${relative(file)}`);
    }
  }
  function renderRoots(expression, seen = new Set()) {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return [];
    seen.add(expression);
    if (ts.isCallExpression(expression) && expression.expression.getText() === "Object.freeze") return renderRoots(expression.arguments[0], seen);
    if (ts.isObjectLiteralExpression(expression)) {
      const render = expression.properties.find(item => item.name?.getText() === "render");
      if (render && ts.isPropertyAssignment(render)) return renderRoots(render.initializer, seen);
      if (render && ts.isMethodDeclaration(render)) return identity(render);
      if (render && ts.isShorthandPropertyAssignment(render)) return (checker.getShorthandAssignmentValueSymbol(render)?.declarations ?? []).flatMap(item => identity(item));
      return [];
    }
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return identity(expression);
    return declarations(expression).flatMap(item => ts.isVariableDeclaration(item) ? renderRoots(item.initializer, seen) : identity(item));
  }
  for (const file of sources.filter(file => file.includes("/designer/src/runtime/"))) {
    const source = program.getSourceFile(file); if (!source) continue;
    const visit = node => {
      if (ts.isPropertyAssignment(node)) {
        const leaf = value(node.name);
        if (leaves.has(leaf)) insert(leaf, renderRoots(node.initializer), `runtime registration ${relative(file)}`);
      }
      if (ts.isObjectLiteralExpression(node)) {
        const leaf = node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText() === "leaf");
        const render = node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText() === "render");
        const id = leaf && value(leaf.initializer);
        if (leaves.has(id) && render) insert(id, renderRoots(render.initializer), `runtime registration ${relative(file)}`);
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  const inventory = [...leaves.values()].map(row => {
    if (!roster[row.leaf.split(".")[0]].some(entry => entry.leaves?.includes(row.leaf))) add("missing-roster-leaf", row.leaf, "Catalog leaf is absent from source roster");
    for (const source of new Set(row.offers)) if (!row.descriptors.some(item => item.source === source)) add("missing-offered-fill", row.leaf, source);
    const implementations = [...row.implementations.values()].sort((a, b) => a.key.localeCompare(b.key));
    if (!implementations.length) add("missing-leaf-source", row.leaf, "No resolvable native implementation");
    if (implementations.length > 1) add("duplicate-leaf-source", row.leaf, implementations.map(item => `${item.file}:${item.line}#${item.name}`).join(", "));
    return { leaf: row.leaf, offers: [...new Set(row.offers)], descriptors: row.descriptors, implementations };
  });
  const inputs = [...new Set([...sources, ...fillFiles, path.join(catalog, "rules/source-roster.json"), ...layers.map(layer => path.join(catalog, `slots/${layer}.json`)), ...owners.map(owner => path.join(owner.directory, "package.json"))])].sort();
  const inputHashes = inputs.map(file => ({ file: relative(file), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
  return { schemaVersion: 1, gate: "PROC-1", ok: findings.length === 0, scope: { kind: layers.length === 1 ? layers[0] : "components+sections+frames", layers, leaves: [...leaves.keys()] }, inputHashes, violations: findings, unverified: [], exitStatus: findings.length ? 1 : 0, coverage: { kind: layers.length === 1 ? layers[0] : "components+sections+frames", leaves: leaves.size, descriptors: inventory.reduce((sum, row) => sum + row.descriptors.length, 0), sourceFiles: sources.length }, inventory, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let inputHead = null;
  try {
    const args = process.argv.slice(2), index = args.indexOf("--root"), headIndex = args.indexOf("--source-head"), scopeIndex = args.indexOf("--scope");
    if (args.includes("--help")) { console.log("Usage: check-one-leaf-source.mjs [--root repository] [--scope components] [--source-head exact-sha] [--json]\nH3 PROC-1 inventories components only and their real implementation identities. Sections/frames require the separate H1 gate; this gate supplies no surface coverage. JSON: gate,inputHead,scope,violations,unverified,exitStatus,coverage,inventory. Exits: 0 verified; 1 violations; 2 missing/invalid/stale input."); process.exit(0); }
    if (args.some((arg, i) => !["--root", "--source-head", "--scope", "--json"].includes(arg) && !(index >= 0 && i === index + 1) && !(headIndex >= 0 && i === headIndex + 1) && !(scopeIndex >= 0 && i === scopeIndex + 1))) throw new Error("Unknown argument; use --help");
    if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith("--"))) throw new Error("--root needs a repository path");
    if (scopeIndex >= 0 && args[scopeIndex + 1] !== "components") throw new Error("H3 --scope must be components; H1 owns sections and frames");
    const root = index >= 0 ? args[index + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    inputHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (headIndex >= 0 && (!/^[a-f0-9]{40}$/.test(args[headIndex + 1] ?? "") || args[headIndex + 1] !== inputHead)) throw new Error("--source-head must match the current exact repository HEAD");
    const report = { ...checkOneLeafSource(root, ["components"]), inputHead };
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else { console.log(`PROC-1: ${report.coverage.leaves} leaves; ${report.coverage.descriptors} descriptors; ${report.findings.length} findings`); for (const finding of report.findings) console.log(`${finding.rule} ${finding.leaf}: ${finding.detail}`); }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) { if (process.argv.includes("--json")) console.log(JSON.stringify({ gate: "PROC-1", inputHead, ok: false, scope: { kind: "components", layers: ["components"] }, violations: [], unverified: [error.message], exitStatus: 2 })); else console.error(`PROC-1 input failure: ${error.message}`); process.exitCode = 2; }
}
