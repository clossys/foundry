#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import ts from "typescript";

const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ownSource = path.join(ownRoot, "packages/designer/src");
// Use the package's adoption integrity functions, including their hash domain;
// a separate approximation would accept descriptors the native resolver rejects.
const nativeHook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(ownSource).href + "/")) {
      const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (fs.existsSync(target)) return { url: target.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(ownSource).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(fs.readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
    return next(url, context);
  },
});
const { assertComponentDescriptor, componentDescriptorHash, verifyComponentOutput } = await import(pathToFileURL(path.join(ownSource, "catalog-core/resolve-components.ts")).href);
const { surfaceEntryOf, surfaceDescriptorHash, surfacePackageDescriptorHash, verifySurfaceFiles } = await import(pathToFileURL(path.join(ownSource, "catalog-core/surface-library.ts")).href);
nativeHook.deregister();
const hash = value => createHash("sha256").update(value).digest("hex");
const stable = value => JSON.stringify(value, (_, row) => row && typeof row === "object" && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const keyOf = node => `${node.getSourceFile().fileName}:${node.pos}:${node.end}`;
const unwrap = node => node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) ? unwrap(node.expression) : node;
const nameOf = slot => slot.split(".")[1].split("-").map(word => word[0].toUpperCase() + word.slice(1)).join("");
const entryOf = doc => {
  const meta = doc?.$extensions?.["com.clossys.fill"], rows = meta && Object.values(doc[meta.slot?.split(".")[0]] ?? {});
  if (!meta || rows.length !== 1 || rows[0].slot !== meta.slot) throw new Error("Invalid whole-leaf document");
  return { meta, descriptor: rows[0] };
};
const contained = (root, target) => {
  const result = path.resolve(root, target);
  if (path.relative(root, result).startsWith("..") || path.isAbsolute(target)) throw new Error(`Source escapes its library: ${target}`);
  return result;
};
const regular = file => {
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error(`Not a regular source file: ${file}`);
  return file;
};
function catalogDocuments(repository) {
  const root = path.join(repository, "packages/designer/src/catalog/fills"), result = [];
  for (const source of fs.readdirSync(root, { withFileTypes: true })) if (source.isDirectory()) {
    for (const leaf of fs.readdirSync(path.join(root, source.name))) if (/^(components|sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(leaf)) {
      const file = path.join(root, source.name, leaf), doc = json(file);
      if (doc.$extensions?.["com.clossys.fill"]?.mode === "reference") continue;
      result.push({ file, document: doc, ...entryOf(doc) });
    }
  }
  if (!result.length) throw new Error("Missing component/section/frame catalog");
  return result;
}

/** TypeScript's symbol graph supplies aliases and re-exports. Render edges are
 * JSX tags and React factories; imports or metadata alone never supply an edge. */
export function createImportGraph({ roots, repository = ownRoot, sources = {}, sourceBase = repository, resolveRepositoryPackages = true }) {
  const manifests = new Map();
  const packageDirectory = path.join(repository, "packages");
  if (fs.existsSync(packageDirectory)) for (const name of fs.readdirSync(packageDirectory)) {
    const directory = path.join(packageDirectory, name), file = path.join(directory, "package.json");
    if (fs.existsSync(file)) { const manifest = json(file); manifests.set(manifest.name, { directory, manifest }); }
  }
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, allowJs: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  function local(base) {
    const bare = base.replace(/\.[cm]?jsx?$/, "");
    for (const file of [...new Set([base, ...[".tsx", ".ts", ".jsx", ".js", ".json"].map(ext => bare + ext), path.join(bare, "index.tsx"), path.join(bare, "index.ts")])]) if (fs.existsSync(file) && fs.statSync(file).isFile()) return regular(file);
  }
  function resolveModule(specifier, from) {
    if (specifier.startsWith(".")) return local(path.resolve(path.dirname(from), specifier));
    const mapping = Object.keys(sources).sort((a, b) => b.length - a.length).find(key => key === specifier || key.endsWith("/") && specifier.startsWith(key));
    if (mapping) return local(path.resolve(sourceBase, sources[mapping], mapping.endsWith("/") ? specifier.slice(mapping.length) : ""));
    // Inspect the runtime export beside the actual importing consumer. The
    // declaration-only TypeScript export does not prove executable adoption.
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    for (let directory = path.dirname(from);;) {
      const packageRoot = path.join(directory, "node_modules", packageName), manifestFile = path.join(packageRoot, "package.json");
      if (fs.existsSync(manifestFile)) {
        const manifest = json(manifestFile), subpath = "." + specifier.slice(packageName.length);
        let target = typeof manifest.exports === "string" ? (subpath === "." ? manifest.exports : undefined) : manifest.exports?.[subpath] ?? (subpath === "." ? manifest.exports : undefined);
        while (target && typeof target === "object") target = target.import ?? target.node ?? target.default;
        if (target === undefined && !manifest.exports) target = subpath === "." ? manifest.module ?? manifest.main ?? "index.js" : subpath;
        if (typeof target === "string") return local(path.resolve(packageRoot, target));
        return undefined;
      }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    const owner = resolveRepositoryPackages && [...manifests].find(([name]) => specifier === name || specifier.startsWith(name + "/"));
    if (owner) {
      const [name, { directory, manifest }] = owner, subpath = "." + specifier.slice(name.length);
      const target = manifest.exports?.[subpath];
      const exported = typeof target === "string" ? target : target?.import ?? target?.default;
      if (typeof exported === "string") return local(path.resolve(directory, exported.replace(/^\.\/dist\//, "./src/")));
    }
    return ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName;
  }
  host.resolveModuleNames = (names, from) => names.map(specifier => {
    const file = resolveModule(specifier, from);
    return file ? { resolvedFileName: file, extension: file.endsWith(".tsx") ? ts.Extension.Tsx : file.endsWith(".json") ? ts.Extension.Json : file.endsWith(".js") ? ts.Extension.Js : ts.Extension.Ts } : undefined;
  });
  const program = ts.createProgram(roots.map(regular), options, host), checker = program.getTypeChecker();
  function symbol(node) {
    let value = checker.getSymbolAtLocation(node), seen = new Set();
    while (value?.flags & ts.SymbolFlags.Alias) {
      if (seen.has(value)) throw new Error("Import/re-export alias cycle");
      seen.add(value); value = checker.getAliasedSymbol(value);
    }
    return value;
  }
  function declarations(node) { return symbol(node)?.declarations ?? []; }
  function exported(file, name) {
    const source = program.getSourceFile(file), module = source && checker.getSymbolAtLocation(source);
    const target = module && checker.getExportsOfModule(module).find(item => item.name === name);
    if (!target) throw new Error(`Unresolved export ${name} from ${file}`);
    let current = target, seen = new Set();
    while (current.flags & ts.SymbolFlags.Alias) {
      if (seen.has(current)) throw new Error(`Re-export cycle: ${name}`);
      seen.add(current); current = checker.getAliasedSymbol(current);
    }
    const result = current.declarations ?? [];
    if (!result.length || result.some(node => /\.d\.[cm]?ts$/.test(node.getSourceFile().fileName))) throw new Error(`Export has no inspectable implementation: ${name}`);
    return result;
  }
  function importedFactory(node, names) {
    node = unwrap(node);
    const local = ts.isPropertyAccessExpression(node) ? node.expression : node;
    for (const declaration of checker.getSymbolAtLocation(local)?.declarations ?? []) {
      let statement = declaration;
      while (statement.parent && !ts.isImportDeclaration(statement)) statement = statement.parent;
      if (!ts.isImportDeclaration(statement) || !["react", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(statement.moduleSpecifier.text)) continue;
      const name = ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : ts.isPropertyAccessExpression(node) ? node.name.text : "";
      if (names.includes(name)) return true;
    }
    return false;
  }
  function renderClosure(rootDeclarations, { boundaries = new Map() } = {}) {
    const seen = new Set(), active = new Set(), reached = new Set(), findings = [], files = new Set(), edges = [];
    const fail = (node, detail) => findings.push({ file: node.getSourceFile().fileName, detail });
    function target(expression, caller) {
      expression = unwrap(expression);
      if (!expression) return;
      if (ts.isStringLiteralLike(expression)) return;
      if (ts.isConditionalExpression(expression)) { target(expression.whenTrue, caller); target(expression.whenFalse, caller); return; }
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) { visit(expression, caller); return; }
      if (ts.isCallExpression(expression)) {
        if (importedFactory(expression.expression, ["forwardRef", "memo"])) { target(expression.arguments[0], caller); return; }
        if (expression.expression.getText() === "Object.assign") { target(expression.arguments[0], caller); return; }
        fail(expression, "Unsupported component factory or dynamic render binding"); return;
      }
      const resolved = declarations(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
      if (!resolved.length) { fail(expression, "Unresolved rendered component binding"); return; }
      for (const declaration of resolved) {
        if (ts.isParameter(declaration) || ts.isBindingElement(declaration) || ts.isPropertySignature(declaration) || ts.isElementAccessExpression(expression)) { fail(expression, "Unsupported dynamic component binding"); continue; }
        edges.push({ from: caller.getSourceFile().fileName, to: declaration.getSourceFile().fileName });
        visit(declaration, expression);
      }
    }
    function visit(node, reference = node) {
      const key = keyOf(node), boundary = boundaries.get(key);
      if (boundary) { reached.add(boundary); files.add(node.getSourceFile().fileName); return; }
      if (active.has(key)) { fail(reference, "Render alias/declaration cycle"); return; }
      if (seen.has(key)) return;
      seen.add(key); active.add(key); files.add(node.getSourceFile().fileName);
      if (/\.d\.[cm]?ts$/.test(node.getSourceFile().fileName)) { fail(reference, "Rendered implementation is declaration-only"); active.delete(key); return; }
      if (ts.isVariableDeclaration(node)) {
        if (!node.initializer) fail(node, "Component has no initializer"); else target(node.initializer, node);
        active.delete(key); return;
      }
      function walk(child) {
        if (ts.isTypeNode(child) || ts.isImportDeclaration(child) || ts.isExportDeclaration(child)) return;
        if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
          const tag = child.tagName;
          if (!(ts.isIdentifier(tag) && /^[a-z]/.test(tag.text))) target(tag, child);
        }
        if (ts.isCallExpression(child)) {
          if (importedFactory(child.expression, ["createElement", "jsx", "jsxs", "jsxDEV"])) target(child.arguments[0], child);
          else if (child.expression.kind === ts.SyntaxKind.ImportKeyword) fail(child, "Dynamic import in render closure requires extraction support");
          // Local functions may return JSX and are part of the rendered closure.
          else for (const declaration of declarations(child.expression)) if ((ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) && !declaration.getSourceFile().fileName.includes("/node_modules/") && declaration !== node) visit(declaration, child);
        }
        ts.forEachChild(child, walk);
      }
      walk(node); active.delete(key);
    }
    for (const declaration of rootDeclarations) visit(declaration);
    return { reached: [...reached].sort(), files: [...files].sort(), edges, findings };
  }
  return { program, checker, exported, declarations, resolveModule, renderClosure };
}

/** Validate a real emitted CompositeResolved library and its actual index graph.
 * This is source/import evidence; it makes no browser or CSS conformance claim. */
export function checkFillSourceImports(options = {}) {
  const repository = path.resolve(options.repository ?? ownRoot), violations = [], unverified = [];
  const report = { gate: "fill-source-imports", inputHead: null, expectedHead: options.sourceHead ?? null, inputHashes: {}, scope: { kind: "native-consumer", site: options.site ?? null, library: options.library ?? null, leaves: 0 }, violations, unverified, leaves: [] };
  const fail = (code, detail, slot) => violations.push({ code, ...(slot ? { slot } : {}), detail });
  try {
    const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    report.inputHead = actualHead;
    if (!options.sourceHead || !/^[a-f0-9]{40}$/.test(options.sourceHead)) throw new Error("Exact --source-head is required");
    if (actualHead !== options.sourceHead) throw new Error("Stale source head: supplied head differs from checked repository HEAD");
    if (!options.site || !options.library || !options.contract) throw new Error("Native --site, --library and --contract are required; metadata defaults cannot establish imports");
    const site = fs.realpathSync(options.site), library = fs.realpathSync(options.library), contractFile = regular(path.resolve(options.contract));
    if (path.relative(site, library).startsWith("..")) throw new Error("Native library must be inside the consumer root");
    const contract = json(contractFile);
    const observe = file => { report.inputHashes[path.relative(site, file)] = hash(fs.readFileSync(file)); };
    observe(contractFile);
    if (contract.version !== 1 || Object.keys(contract).sort().join(",") !== "pages,sources,version" || !contract.sources || Array.isArray(contract.sources) || !Array.isArray(contract.pages) || !contract.pages.length || contract.pages.some(page => typeof page !== "string" || !page)) throw new Error("Invalid ConsumerDogfoodContract: version, sources, nonempty pages required");
    for (const [module, target] of Object.entries(contract.sources)) if (typeof target !== "string" || !target || module.startsWith(".") || /^(?:@clossys\/designer(?:\/|$)|react(?:-aria-components)?(?:\/|$)|next\/)/.test(module)) throw new Error("Unsupported project source mapping for a library/framework module");
    const profile = json(regular(path.join(library, "resolved.json"))), catalog = catalogDocuments(repository), selected = [];
    observe(path.join(library, "resolved.json"));
    if (!profile.components?.components || !profile.components.selectionHash) throw new Error("Missing native CompositeResolved.components selection");
    for (const [slot, component] of Object.entries(profile.components.components)) {
      if (!component.descriptor || component.slot !== slot || stable(component.impl) !== stable(component.descriptor.impl)) throw new Error(`Resolved component differs from descriptor: ${slot}`);
      selected.push({ slot, descriptor: component.descriptor, origin: component.origin, index: path.join(library, "component-index.ts"), exported: nameOf(slot) });
    }
    for (const [slot, row] of Object.entries(profile.surfaces?.fills ?? {})) {
      const { descriptor } = entryOf(row.document);
      if (descriptor.slot !== slot) throw new Error(`Resolved surface slot differs: ${slot}`);
      selected.push({ slot, descriptor, origin: descriptor.origin, index: path.join(library, "surface-index.ts"), exported: nameOf(slot) });
    }
    if (!selected.length) throw new Error("Empty native leaf selection");
    const pages = contract.pages.map(page => contained(path.dirname(contractFile), page));
    const roots = [...new Set([...pages, ...selected.map(row => row.index)])];
    const graph = createImportGraph({ roots, repository, sources: contract.sources, sourceBase: path.dirname(contractFile), resolveRepositoryPackages: false });
    const boundaries = new Map(), plans = [];
    for (const row of selected) {
      try {
        const document = json(regular(path.join(library, "fills", `${row.slot}.json`))), adopted = entryOf(document);
        observe(path.join(library, "fills", `${row.slot}.json`));
        const source = row.origin?.kind === "adopted" ? row.origin.source ?? row.origin.base?.source : row.origin?.kind === "package" ? row.origin.source : undefined;
        if (!source) throw new Error("Unsupported or missing selected source origin");
        const registration = catalog.filter(item => item.meta.slot === row.slot && item.meta.source === source);
        if (registration.length !== 1) throw new Error("Missing or ambiguous catalog source registration");
        const registered = registration[0].descriptor;
        observe(registration[0].file);
        if (adopted.meta.slot !== row.slot || stable(adopted.descriptor.impl) !== stable(row.descriptor.impl) || stable(registered.impl) !== stable(row.descriptor.impl)) throw new Error("Selected source differs from catalog or native fill decision");
        if (row.slot.startsWith("components.")) {
          assertComponentDescriptor(row.descriptor);
          if (row.origin.kind !== "adopted" || row.origin.sha256 !== componentDescriptorHash(row.descriptor) || stable(adopted.descriptor) !== stable({ ...row.descriptor, origin: row.origin })) throw new Error("Native adoption descriptor/origin differs from its exact selected fill");
          if (row.descriptor.impl.kind === "source") verifyComponentOutput(row.descriptor, profile.components.files);
        } else {
          const native = surfaceEntryOf(document);
          if (stable(native) !== stable(row.descriptor)) throw new Error("Native surface selection differs from its exact fill document");
          if (native.impl.kind === "package") {
            if (native.origin?.kind !== "package" || native.origin.descriptorHash !== surfacePackageDescriptorHash(native) || stable(native.origin.pin) !== stable(registration[0].meta.pin)) throw new Error("Native surface package adoption identity differs");
          } else {
            if (native.origin?.kind !== "adopted" || native.origin.descriptorHash !== surfaceDescriptorHash(native)) throw new Error("Unsupported or stale native surface adoption descriptor");
            verifySurfaceFiles(native, profile.surfaces.files);
          }
        }
        if (row.descriptor.impl.kind === "source") {
          const receipts = registered.outputSha256;
          if (!Array.isArray(receipts) || !receipts.length) throw new Error("Catalog source has no exact output provenance");
          for (const receipt of receipts) {
            const file = regular(contained(library, receipt.path));
            if (hash(fs.readFileSync(file)) !== receipt.sha256) throw new Error(`Actual source bytes differ from adopted source: ${receipt.path}`);
            observe(file);
          }
          row.target = regular(contained(library, row.descriptor.impl.entry));
        } else if (row.descriptor.impl.kind === "package") {
          const pin = registration[0].meta.pin ?? registered.pin;
          if (!pin?.package || !pin.export || `${pin.package}/${pin.export.split("#")[0].slice(2)}` !== row.descriptor.impl.module || pin.export.split("#")[1] !== row.descriptor.impl.export) throw new Error("Catalog package export pin differs from implementation");
          row.target = graph.resolveModule(row.descriptor.impl.module, row.index);
          if (!row.target) throw new Error("Unresolved selected package implementation");
          let owner = path.dirname(row.target), actualPackage;
          for (;;) {
            const file = path.join(owner, "package.json");
            if (fs.existsSync(file)) { actualPackage = json(file); break; }
            const parent = path.dirname(owner); if (parent === owner) break; owner = parent;
          }
          if (actualPackage?.name !== pin.package || actualPackage.version !== pin.version) throw new Error("Actual imported package differs from exact catalog package pin");
        } else throw new Error("Unsupported implementation binding");
        const expected = graph.exported(row.target, row.descriptor.impl.export), roots = graph.exported(row.index, row.exported);
        for (const declaration of expected) boundaries.set(keyOf(declaration), `${source}/${row.slot}`);
        plans.push({ ...row, roots, expected: `${source}/${row.slot}` });
      } catch (error) { fail("source-provenance", error.message, row.slot); }
    }
    for (const plan of plans) {
      const result = graph.renderClosure(plan.roots, { boundaries });
      for (const file of result.files) observe(file);
      if (!result.reached.includes(plan.expected)) fail("source-import-mismatch", `Actual render imports do not reach ${plan.expected}; reached ${result.reached.join(", ") || "none"}`, plan.slot);
      for (const finding of result.findings) fail("unsupported-render-binding", finding.detail, plan.slot);
      report.leaves.push({ slot: plan.slot, declared: plan.expected, imported: result.reached, files: result.files.map(file => path.relative(site, file)), edges: result.edges.map(edge => ({ from: path.relative(site, edge.from), to: path.relative(site, edge.to) })) });
    }
    for (const page of pages) {
      const result = graph.renderClosure(graph.exported(page, "default"), { boundaries });
      for (const file of result.files) observe(file);
      if (!result.reached.length) fail("unresolved-page-selection", `Page has no proven selected render import: ${path.relative(site, page)}`);
      for (const finding of result.findings) fail("unsupported-page-binding", `${path.relative(site, page)}: ${finding.detail}`);
    }
    report.scope = { kind: "native-consumer", site, library, leaves: selected.length };
    report.limits = ["Source/import graph only; browser render execution and CSS coverage are separate gates."];
  } catch (error) { fail("input-or-extraction", error.message); unverified.push("Native selection/import coverage was not established."); }
  report.ok = violations.length === 0;
  report.exitStatus = report.ok ? 0 : violations.some(row => row.code === "input-or-extraction") ? 2 : 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--help") { console.log("Usage: check-fill-source-imports.mjs --site ROOT --library EMITTED_LIBRARY --contract DOGFOOD_JSON --source-head SHA [--json] [--report FILE]\nRequires native resolved.json, fills/*.json and generated component/surface indexes. Exit 0: proven source imports; 1: violations; 2: missing/stale/unsupported input. Catalog-only invocation remains red until native selection inputs are supplied."); process.exit(0); }
      if (arg === "--json") continue;
      const key = { "--site": "site", "--library": "library", "--contract": "contract", "--source-head": "sourceHead", "--head": "sourceHead", "--repository": "repository", "--report": "report" }[arg];
      if (!key || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${arg}`);
      options[key] = args[++index];
    }
    const report = checkFillSourceImports(options);
    const output = JSON.stringify(report, null, 2) + "\n";
    if (options.report) fs.writeFileSync(options.report, output);
    process.stdout.write(output); process.exitCode = report.exitStatus;
  } catch (error) { console.log(JSON.stringify({ gate: "fill-source-imports", inputHead: options.sourceHead ?? null, scope: "unresolved", violations: [{ code: "arguments", detail: error.message }], unverified: ["Native input not checked."], ok: false, exitStatus: 2 })); process.exitCode = 2; }
}
