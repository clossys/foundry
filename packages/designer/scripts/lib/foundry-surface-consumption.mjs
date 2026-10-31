// Descriptor measurements are separate from the frozen historical report gate.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { classifyPrivateInternalReads } from "./private-internal-reads.mjs";
import { createSurfaceSourceScanner } from "./surface-source-scan.mjs";

// Boundary-message uses this public export as an adaptation anchor. Its private
// adapter is not the implementation rendered by an ordinary EmptyState import.
// Only the real export's bound, spread provenance value can establish ownership;
// caller permissions, descriptor notes, comments and arbitrary strings cannot.
function nativeEmptyState(graph, packageName, read) {
  const target = graph.pointer(packageName, "./blocks#EmptyState");
  const provenance = graph.pointer(packageName, "./catalog-core/provenance-attrs#dsAttrs");
  if (!target || target.name !== "EmptyState" || !target.file.endsWith("/blocks/EmptyState.tsx") || provenance?.file !== target.file.replace(/blocks\/EmptyState\.tsx$/, "catalog-core/provenance-attrs.ts") || provenance.name !== "dsAttrs") return undefined;
  const ast = ts.createSourceFile(target.file, read(target.file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = ast.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "../catalog-core/provenance-attrs.js" || statement.importClause?.isTypeOnly) return [];
    const bindings = statement.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(item => !item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === "dsAttrs").map(item => item.name.text) : [];
  });
  if (imported.length !== 1) return undefined;
  const stamps = ast.statements.flatMap(statement => !ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const) ? [] : statement.declarationList.declarations.filter(declaration => {
    const call = declaration.initializer;
    return ts.isIdentifier(declaration.name) && call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === imported[0] && call.arguments.length === 3 && call.arguments.every((arg, index) => ts.isStringLiteral(arg) && arg.text === ["sections", "sections.empty-state", "foundry/sections.empty-state"][index]);
  }).map(declaration => declaration.name.text));
  const fn = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === target.name && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  if (stamps.length !== 1 || !fn?.body) return undefined;
  let spread = false, shadowed = false;
  const boundNames = node => ts.isIdentifier(node) ? [node.text] : ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) ? node.elements.flatMap(element => ts.isBindingElement(element) ? boundNames(element.name) : []) : [];
  const walk = node => {
    if (ts.isJsxSpreadAttribute(node) && ts.isIdentifier(node.expression) && node.expression.text === stamps[0]) spread = true;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && boundNames(node.name).some(name => name === stamps[0] || name === imported[0])) shadowed = true;
    ts.forEachChild(node, walk);
  };
  walk(fn);
  return spread && !shadowed ? target : undefined;
}

export function measureFoundrySurfaces(root, buildSurfaceConsumption) {
  const repo = resolve(root, "../.."), src = resolve(root, "src");
  const read = path => readFileSync(resolve(root, path), "utf8");
  const json = path => JSON.parse(read(path));
  const inventory = Object.fromEntries(["themes", "assets", "components", "sections", "frames"].map(layer => [layer, json(`src/catalog/slots/${layer}.json`)]));
  const docs = readdirSync(resolve(src, "catalog/fills/foundry")).filter(file => /^(?:components|sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(file)).sort().map(file => json(`src/catalog/fills/foundry/${file}`));
  const metadata = doc => doc.$extensions["com.clossys.fill"];
  const packageRoots = ["designer", "publisher"].map(name => ({ name: JSON.parse(readFileSync(resolve(repo, `packages/${name}/package.json`), "utf8")).name, root: `packages/${name}/src` }));
  const packages = Object.fromEntries(packageRoots.map(row => [row.name, row.root]));
  const cache = new Map();
  const sourceRead = path => {
    if (!packageRoots.some(row => path.startsWith(row.root + "/")) || !/\.[cm]?tsx?$/.test(path) || /\.(?:test|check|spec|stories)\./.test(path)) return undefined;
    if (cache.has(path)) return cache.get(path);
    const absolute = resolve(repo, path);
    if (!existsSync(absolute)) return undefined;
    if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new Error("Surface source must be a regular repository file");
    const content = readFileSync(absolute, "utf8"); cache.set(path, content); return content;
  };
  const graph = createSurfaceSourceScanner({ read: sourceRead, packages });
  const designer = packageRoots[0].name;
  const native = nativeEmptyState(graph, designer, sourceRead);
  const sameTarget = target => native && target?.file === native.file && target?.name === native.name;
  const nativeRegistered = docs.some(doc => {
    const meta = metadata(doc);
    return meta.slot === "sections.empty-state" && meta.pin?.package === designer && sameTarget(graph.pointer(meta.pin.package, meta.pin.export));
  });
  for (const doc of docs) {
    const meta = metadata(doc), entry = Object.values(doc[meta.slot.split(".")[0]])[0];
    const pointers = [meta.pin?.export, ...(meta.slot.startsWith("components.") ? Object.values(entry.propMap ?? {}) : [])];
    for (const pointer of pointers) if (typeof pointer === "string") {
      const target = graph.pointer(meta.pin?.package, pointer);
      if (nativeRegistered && meta.slot === "sections.boundary-message" && meta.pin?.package === designer && sameTarget(target)) continue;
      graph.addOwner(target, meta.slot);
    }
  }
  const fills = docs.map(metadata).filter(meta => /^(?:sections|frames)\./.test(meta.slot)).map(meta => ({ id: meta.id, slot: meta.slot, source: meta.source, pin: meta.pin }));
  if (new Set(fills.map(row => row.slot)).size !== fills.length) throw new Error("Duplicate surface measurement");
  const sourceScans = fills.map(fill => graph.scan({ fill: fill.id, packageName: fill.pin?.package, pointer: fill.pin?.export }));
  const input = { ...inventory, fills, sourceScans, themeCss: read("styles/theme.css") + "\n" + read("styles/theme-keys.css") };
  // Observe the unchanged raw scan before consulting permission metadata.
  const rawReport = buildSurfaceConsumption(input);
  const annotations = fills.map(fill => {
    const slot = inventory.frames.find(slot => slot.id === fill.slot);
    const scan = sourceScans.find(scan => scan.fill === fill.id);
    const packageRoot = packages[fill.pin?.package];
    if (!slot?.contract.allowedReads.privateInternal) return { scan, witnesses: [] };
    return classifyPrivateInternalReads({ scan, declarations: slot.contract.allowedReads.privateInternal, packageRoot, read: sourceRead,
      scanAssets: (file, content) => buildSurfaceConsumption({ ...input, fills: [fill], sourceScans: [{ fill: fill.id, files: [{ path: file, content }] }] }).fills[0].scannedReads.assets });
  });
  const report = annotations.some(row => row.witnesses.length) ? buildSurfaceConsumption({ ...input, sourceScans: annotations.map(row => row.scan) }) : rawReport;
  for (const row of report.fills) {
    const annotation = annotations[fills.findIndex(fill => fill.id === row.id)];
    if (annotation.witnesses.length) {
      row.rawScannedReads = rawReport.fills.find(raw => raw.id === row.id).scannedReads;
      row.privateInternalReads = annotation.witnesses;
    }
  }
  const measurements = Object.fromEntries(report.fills.map(row => {
    if (row.scanStatus !== "lower-bound" || !row.sourceFiles.length) throw new Error(`Surface source measurement unavailable: ${row.slot}`);
    const scan = sourceScans.find(scan => scan.fill === row.id);
    return [row.slot, { pin: row.pin, consumption: { scanStatus: row.scanStatus, sourceFiles: scan.files.map(file => ({ path: file.path, sha256: createHash("sha256").update(sourceRead(file.path)).digest("hex") })), scannedReads: row.scannedReads, scannedComposes: row.scannedComposes, ...(row.privateInternalReads ? { rawScannedReads: row.rawScannedReads, privateInternalReads: row.privateInternalReads } : {}), unresolved: row.unresolved } }];
  }));
  return { measurements, report, input };
}
