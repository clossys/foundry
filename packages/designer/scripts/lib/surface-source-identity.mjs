import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSurfaceLeafContext } from "./surface-leaf-check.mjs";

const unwrap = node => {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const walk = (node, visit) => { if (visit(node) !== false) ts.forEachChild(node, child => walk(child, visit)); };
const object = entries => ({ kind: "object", entries });
const fn = (node, env) => ({ kind: "function", node, env });

// Run the real pure native importer against current TS source, never stale dist.
// Resolution is confined to source modules; third-party imports use normal Node resolution.
export function sourceModule(file, cache = new Map()) {
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const root = file.slice(0, file.indexOf(`${path.sep}packages${path.sep}`));
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [context => {
      const visit = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
        ? context.factory.createObjectLiteralExpression([
          context.factory.createPropertyAssignment("url", context.factory.createStringLiteral(pathToFileURL(file).href)),
          context.factory.createPropertyAssignment("dirname", context.factory.createStringLiteral(path.dirname(file))),
        ]) : ts.visitEachChild(node, visit, context);
      return node => ts.visitNode(node, visit);
    }] },
  }).outputText;
  const localRequire = specifier => {
    let target;
    if (specifier.startsWith("file:")) target = fileURLToPath(specifier).replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`);
    else if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
    else if (specifier.startsWith("@clossys/")) {
      const [scope, name, ...parts] = specifier.split("/");
      const directory = path.join(root, "packages", name), manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
      const entry = manifest.exports?.[parts.length ? "./" + parts.join("/") : "."];
      const output = typeof entry === "string" ? entry : entry?.import ?? entry?.default;
      if (!output) throw new Error(`Native source export missing: ${specifier}`);
      target = path.resolve(directory, output).replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`);
    } else return createRequire(file)(specifier);
    const candidates = target.endsWith(".js") ? [target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx")] : [target];
    const source = candidates.find(candidate => fs.existsSync(candidate));
    if (!source) throw new Error(`Native source dependency missing: ${specifier}`);
    return sourceModule(source, cache);
  };
  runInThisContext(`(function(exports,require,module){${output}\n})`, { filename: file })(module.exports, localRequire, module);
  return module.exports;
}

/** Replay every planned adoption with the real engine. Package pointers must exist;
 * source receipts and bytes must pass the same S2/provenance/hash guards as Studio.
 */
export async function checkPreparedDefaultAdoptions(repository, supplied) {
  const root = path.resolve(repository), cache = new Map();
  const native = sourceModule(path.join(root, "packages/designer/src/catalog-core/index.ts"), cache);
  const bundles = sourceModule(path.join(root, "packages/designer/src/catalog-bundles.ts"), cache);
  const surfaces = sourceModule(path.join(root, "packages/designer/src/library-cli/surface-catalog.ts"), cache);
  const libraryApi = sourceModule(path.join(root, "packages/designer/src/catalog-core/surface-library.ts"), cache);
  const prepared = supplied ?? await bundles.prepareCatalogSurfaceDefaults({
    catalog: { values: native.loadCatalog(), components: { slots: native.loadComponentRegistry().slots, fills: [] }, surfaces: surfaces.foundrySurfaceCatalog() },
    library: { source: { id: "surface-default-probe", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } },
    surfaceOptions: { packages: [], measurements: [] },
  }, { slots: surfaces.foundrySurfaceCatalog().slots.map(slot => slot.id), preference: native.DEFAULT_COMPONENT_PREFERENCE });
  const findings = [], rows = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "packages/designer/package.json"), "utf8"));
  const data = JSON.parse(fs.readFileSync(path.join(root, "packages/designer/src/catalog-bundles.data.json"), "utf8"));
  if (data.package.name !== manifest.name || data.package.version !== manifest.version) findings.push({ code: "stale-catalog-bundles", detail: "Offline bundle package identity differs from the shipped manifest" });
  for (const decision of prepared.plan.decisions) {
    const operation = { op: "adopt", slot: decision.slot, source: decision.source };
    const matching = prepared.surfaceBundles.filter(bundle => bundle.operation === operation.op && bundle.slot === operation.slot);
    const packages = prepared.input.catalog.surfaces.fills.filter(doc => {
      const meta = doc.$extensions["com.clossys.fill"];
      return meta.slot === operation.slot && meta.source === operation.source && meta.mode === "implementation" && libraryApi.isSurfacePackageEntry(libraryApi.surfaceEntryOf(doc));
    });
    const row = { slot: operation.slot, op: operation.op, source: operation.source, matchingBundles: matching.length, packageCandidates: packages.length };
    try {
      native.applyLibraryChange(prepared.input.catalog, prepared.input.library, { baseHash: native.libraryHash(prepared.input.library), changes: [{ portion: "surfaces", change: operation }], surfaceBundles: prepared.surfaceBundles }, { surfaceOptions: prepared.input.surfaceOptions });
      rows.push({ ...row, status: "PASS" });
    } catch (error) {
      const finding = { code: "default-adoption-source", leaf: operation.slot, ...row, detail: error.message };
      findings.push(finding); rows.push({ ...row, status: "FAIL", detail: error.message });
    }
  }
  if (!rows.length || rows.length !== prepared.plan.rows.filter(row => row.status !== "not-chosen").length) findings.push({ code: "default-adoption-inventory", detail: "Every planned default seat must have an adoption" });
  return { findings, rows };
}

/** Interpret the registry's data flow, retaining every entry before JS could overwrite it.
 * Only local source functions and the bounded Object/Array operations below are executable.
 * Renderer/sample bodies are values, never executed. Unsupported registry producers fail closed.
 */
export function createRegistryResolver(program, root) {
  const checker = program.getTypeChecker(), files = new Set();
  const location = node => {
    const source = node.getSourceFile(), point = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { file: path.relative(root, source.fileName).split(path.sep).join("/"), line: point.line + 1 };
  };
  const fail = (node, detail, code = "unresolved-source") => {
    let leaf = detail.match(/\b(?:sections|frames)\.[a-z][a-z0-9-]*/)?.[0];
    for (let parent = node; !leaf && parent; parent = parent.parent) if (ts.isPropertyAssignment(parent) && ts.isStringLiteralLike(parent.name) && /^(?:sections|frames)\./.test(parent.name.text)) leaf = parent.name.text;
    throw Object.assign(new Error(detail), { finding: { code, ...(leaf ? { leaf } : {}), ...location(node), detail } });
  };
  const symbol = node => {
    let value = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    const seen = new Set();
    while (value?.flags & ts.SymbolFlags.Alias && !seen.has(value)) { seen.add(value); value = checker.getAliasedSymbol(value); }
    return value;
  };
  const declarations = node => symbol(node)?.declarations?.filter(node => !ts.isTypeNode(node) && !ts.isPropertySignature(node)) ?? [];
  const force = value => value?.kind === "lazy" ? evaluate(value.node, value.env) : value;
  const get = (value, key, node) => {
    value = force(value);
    if (Array.isArray(value)) return force(value[Number(key)]);
    if (value?.kind !== "object") return fail(node, `Cannot resolve property ${key}`);
    const entries = value.entries.filter(entry => entry.key === key);
    if (entries.length > 1) fail(node, `Shadowed registration/property ${key}`, "shadowed-registration");
    return entries.length ? force(entries[0].value) : undefined;
  };
  function bind(name, value, env) {
    if (ts.isIdentifier(name)) env.set(name.text, value);
    else if (ts.isArrayBindingPattern(name)) name.elements.forEach((element, i) => { if (ts.isBindingElement(element)) bind(element.name, value[i], env); });
    else fail(name, "Unsupported registry binding");
  }
  function invoke(callable, args, node) {
    callable = force(callable);
    if (callable?.kind !== "function") fail(node, "Registry producer is not a resolved source function");
    const env = new Map(callable.env), body = callable.node.body;
    callable.node.parameters.forEach((parameter, i) => bind(parameter.name, parameter.dotDotDotToken ? args.slice(i) : args[i], env));
    if (!body) fail(node, "Registry producer has no source body");
    if (!ts.isBlock(body)) return evaluate(body, env);
    // Return expressions resolve local const bindings lazily. Dataset/sample validations
    // have no bearing on source identity and are not executed by this source checker.
    for (const statement of body.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer) bind(declaration.name, { kind: "lazy", node: declaration.initializer, env }, env);
    }
    const hasLoop = body.statements.some(ts.isForOfStatement);
    if (!hasLoop) {
      const returns = [];
      walk(body, node => {
        if (node !== body && ts.isFunctionLike(node)) return false;
        if (ts.isReturnStatement(node)) returns.push(node);
      });
      if (returns.length !== 1 || !returns[0].expression) fail(body, "Registry producer needs one resolved return expression");
      return evaluate(returns[0].expression, env);
    }
    // The actual merge helper is interpreted, including its checks and nested loops.
    function execute(statement) {
      if (ts.isBlock(statement)) { for (const child of statement.statements) { const result = execute(child); if (result?.returned) return result; } }
      else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bind(declaration.name, evaluate(declaration.initializer, env), env);
      else if (ts.isForOfStatement(statement)) {
        const values = evaluate(statement.expression, env);
        if (!Array.isArray(values)) fail(statement, "Registry loop input is unknown");
        for (const value of values) { bind(statement.initializer.declarations[0].name, value, env); const result = execute(statement.statement); if (result?.returned) return result; }
      } else if (ts.isIfStatement(statement)) {
        const condition = evaluate(statement.expression, env);
        if (typeof condition !== "boolean") fail(statement, "Unknown registry condition");
        if (condition) return execute(statement.thenStatement);
        if (statement.elseStatement) return execute(statement.elseStatement);
      } else if (ts.isThrowStatement(statement)) {
        const expression = statement.expression;
        const message = ts.isNewExpression(expression) ? evaluate(expression.arguments?.[0], env) : "Registry producer threw";
        fail(statement, String(message), /two renderers/.test(message) ? "duplicate-implementation" : "invalid-registration");
      } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const { left, right } = statement.expression;
        if (!ts.isElementAccessExpression(left)) fail(left, "Unsupported registry assignment");
        const target = evaluate(left.expression, env), key = evaluate(left.argumentExpression, env);
        if (target?.kind !== "object" || typeof key !== "string") fail(left, "Unknown registry assignment target");
        target.entries.push({ key, value: evaluate(right, env), node: statement });
      } else if (ts.isReturnStatement(statement)) return { returned: true, value: evaluate(statement.expression, env) };
      else fail(statement, "Unsupported registry statement");
    }
    const result = execute(body);
    if (!result?.returned) fail(body, "Registry producer did not return");
    return result.value;
  }
  function evaluate(input, env = new Map(), active = new Set()) {
    const node = unwrap(input);
    if (!node) return undefined;
    files.add(node.getSourceFile().fileName);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) return fn(node, env);
    if (ts.isIdentifier(node)) {
      if (env.has(node.text)) return force(env.get(node.text));
      if (active.has(node)) fail(node, "Cyclic source binding");
      active.add(node);
      const candidates = declarations(node);
      if (candidates.length !== 1) fail(node, `Missing or ambiguous source ${node.text}`);
      const declaration = candidates[0];
      if (ts.isVariableDeclaration(declaration)) return evaluate(declaration.initializer, env, active);
      if (ts.isFunctionDeclaration(declaration)) return fn(declaration, env);
      fail(node, `Unknown registry value ${node.text}`);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element => ts.isSpreadElement(element) ? evaluate(element.expression, env) : [evaluate(element, env)]);
    if (ts.isObjectLiteralExpression(node)) {
      const entries = node.properties.flatMap(property => {
      if (ts.isSpreadAssignment(property)) {
        const source = evaluate(property.expression, env);
        if (source?.kind !== "object") fail(property, "Unresolved registry spread");
        return source.entries;
      }
      const key = ts.isComputedPropertyName(property.name) ? evaluate(property.name.expression, env) : property.name.text;
      if (typeof key !== "string") fail(property, "Unknown registry key");
      const value = ts.isMethodDeclaration(property) ? fn(property, env) : { kind: "lazy", node: ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, env };
      return [{ key, value, node: property }];
      });
      const keys = new Set();
      for (const entry of entries) {
        if (keys.has(entry.key) && /^(?:sections|frames)\./.test(entry.key)) fail(entry.node, `Shadowed registration ${entry.key}`, "shadowed-registration");
        keys.add(entry.key);
      }
      return object(entries);
    }
    if (ts.isPropertyAccessExpression(node)) return get(evaluate(node.expression, env), node.name.text, node);
    if (ts.isElementAccessExpression(node)) return get(evaluate(node.expression, env), evaluate(node.argumentExpression, env), node);
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => String(evaluate(span.expression, env)) + span.literal.text).join("");
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return !evaluate(node.operand, env);
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(node.operatorToken.kind)) {
      const same = evaluate(node.left, env) === evaluate(node.right, env);
      return node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? same : !same;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && !symbol(callee.expression)?.declarations?.some(declaration => declaration.getSourceFile().fileName.startsWith(root + path.sep) && !declaration.getSourceFile().fileName.includes("/node_modules/"))) {
        const args = node.arguments.map(argument => evaluate(argument, env));
        if (callee.name.text === "freeze") return args[0];
        if (callee.name.text === "entries" && args[0]?.kind === "object") return args[0].entries.map(entry => [entry.key, force(entry.value)]);
        if (callee.name.text === "fromEntries" && Array.isArray(args[0])) return object(args[0].map(([key, value]) => ({ key, value, node })));
        if (callee.name.text === "hasOwn" && args[0]?.kind === "object") return args[0].entries.some(entry => entry.key === args[1]);
        fail(node, `Unsupported Object.${callee.name.text} producer`);
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "map") {
        const values = evaluate(callee.expression, env), callback = evaluate(node.arguments[0], env);
        if (!Array.isArray(values)) fail(node, "Unknown registry map source");
        return values.map((value, index) => invoke(callback, [value, index], node));
      }
      return invoke(evaluate(callee, env), node.arguments.map(argument => evaluate(argument, env)), node);
    }
    fail(node, `Unsupported registry expression ${ts.SyntaxKind[node.kind]}`);
  }
  return { evaluate, force, get, declarations, symbol, files, location, fail };
}

/** Source identities, not UI names: barrels, aliases and transparent adapters converge here. */
/** Check registration objects before JavaScript flattens duplicate fields/spreads. */
export function requireUniqueRecord(resolver, expression) {
  const record = resolver.evaluate(expression);
  if (record?.kind !== "object") resolver.fail(expression, "Registration record is unresolved");
  const keys = new Set();
  for (const entry of record.entries) {
    if (keys.has(entry.key)) resolver.fail(entry.node, `Shadowed catalog registration field ${entry.key}`, "shadowed-registration");
    keys.add(entry.key);
  }
  return record;
}

function checkCatalogConstructors(program, resolver, root) {
  const catalog = program.getSourceFile(path.join(root, "packages/designer/src/library-cli/surface-catalog.ts"));
  const factory = catalog.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "foundrySurfaceCatalog");
  const records = [], returns = [];
  walk(factory.body, node => {
    if (node !== factory.body && ts.isFunctionLike(node)) return false;
    if (ts.isReturnStatement(node)) returns.push(node);
    if (ts.isCallExpression(node) && node.expression.getText() === "Object.freeze") records.push(node);
  });
  if (records.length !== 1 || returns.length !== 1 || !returns[0].expression) resolver.fail(factory, "Live catalog needs one registration record and return");
  const writer = records[0].parent, cache = resolver.symbol(returns[0].expression), writes = [];
  if (!ts.isBinaryExpression(writer) || writer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionEqualsToken || resolver.symbol(writer.left) !== cache) resolver.fail(records[0], "Catalog record does not supply the returned cache");
  walk(catalog, node => { if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && resolver.symbol(node.left) === cache) writes.push(node); });
  if (writes.length !== 1 || writes[0] !== writer || cache?.declarations?.length !== 1 || cache.declarations[0].initializer) resolver.fail(records[0], "Catalog cache has another source writer");
  const record = requireUniqueRecord(resolver, records[0]);
  if (!["slots", "fills"].every(key => record.entries.some(entry => entry.key === key))) resolver.fail(records[0], "Catalog record needs slots and fills");
  const bundleSource = program.getSourceFile(path.join(root, "packages/designer/src/catalog-bundles.ts"));
  const prepare = bundleSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "prepareCatalogSurfaceDefaults"), outputs = [];
  walk(prepare.body, node => { if (node !== prepare.body && ts.isFunctionLike(node)) return false; if (ts.isReturnStatement(node)) outputs.push(node); });
  if (outputs.length !== 1 || !outputs[0].expression) resolver.fail(prepare, "Bundle preparation needs one resolved output record");
  requireUniqueRecord(resolver, outputs[0].expression);
}

export async function checkSurfaceSourceIdentity(repository) {
  const root = path.resolve(repository), context = createSurfaceLeafContext(root), { program, fills } = context;
  const resolver = createRegistryResolver(program, root), findings = [], inventory = [];
  const key = node => `${path.relative(root, node.getSourceFile().fileName).split(path.sep).join("/")}#${node.name?.getText() ?? ts.SyntaxKind[node.kind]}:${node.getStart()}`;
  const add = (code, leaf, node, detail) => findings.push({ code, leaf, ...resolver.location(node), detail });
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const slots = ["sections", "frames"].flatMap(layer => json(`packages/designer/src/catalog/slots/${layer}.json`).map(row => row.id));
  const registered = new Set(slots);
  for (const diagnostic of program.getSyntacticDiagnostics()) findings.push({ code: "invalid-source-syntax", ...(diagnostic.file ? { file: path.relative(root, diagnostic.file.fileName) } : {}), detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") });
  const iaLeaves = nodes => nodes.flatMap(node => [...(node.leaves ?? []), ...iaLeaves(node.children ?? [])]);
  const ia = ["sections", "frames"].flatMap(layer => iaLeaves(json(`packages/designer/src/catalog/ia/${layer}.json`).nodes));
  if (registered.size !== slots.length || new Set(ia).size !== ia.length || [...ia].sort().join() !== [...slots].sort().join()) findings.push({ code: "catalog-inventory-mismatch", detail: "Native IA leaves and slot inventory must agree without duplicate registrations" });
  let offers = [];
  try {
    // This is the live catalog used by CLI, disk boundary and Studio cells. Its
    // source offers count even when absent from the package JSON/runtime tables.
    checkCatalogConstructors(program, resolver, root);
    const live = sourceModule(path.join(root, "packages/designer/src/library-cli/surface-catalog.ts")).foundrySurfaceCatalog();
    offers = live.fills.map(doc => {
      const meta = doc.$extensions["com.clossys.fill"], entry = Object.values(doc[meta.slot.split(".")[0]])[0];
      return { id: meta.id, leaf: meta.slot, impl: entry.impl, pin: meta.pin ?? entry.pin };
    });
    const liveSlots = live.slots.map(slot => slot.id);
    if (new Set(liveSlots).size !== liveSlots.length || [...liveSlots].sort().join() !== [...slots].sort().join()) findings.push({ code: "catalog-inventory-mismatch", detail: "Live surface catalog slots differ from registered source slots" });
    for (const offer of offers) if (!registered.has(offer.leaf)) findings.push({ code: "unregistered-offer", leaf: offer.leaf, detail: offer.id });
    for (const leaf of slots) {
      const candidates = offers.filter(offer => offer.leaf === leaf);
      if (candidates.length !== 1) findings.push({ code: candidates.length ? "duplicate-implementation" : "missing-source", leaf, detail: `Live surface catalog has ${candidates.length} enabled offers`, candidates });
      const descriptor = fills.find(fill => fill.leaf === leaf);
      if (descriptor && candidates.length === 1) {
        const stored = json(descriptor.descriptor).$extensions["com.clossys.fill"];
        if (["package", "version", "export"].some(field => candidates[0].pin?.[field] !== stored.pin?.[field])) findings.push({ code: "catalog-source-mismatch", leaf, detail: "Live importer pin differs from package descriptor pin" });
        const [subpath, name] = stored.pin?.export?.split("#") ?? [];
        const implementation = candidates[0].impl;
        if (implementation?.kind !== "package" || implementation.module !== stored.pin?.package + (subpath === "." ? "" : subpath?.slice(1)) || implementation.export !== name) findings.push({ code: "catalog-source-mismatch", leaf, detail: "Live package implementation and canonical source pointer differ" });
      }
    }
  } catch (error) { findings.push(error.finding ?? { code: "unresolved-source", detail: `Live catalog: ${error.message}` }); }
  const entry = program.getSourceFile(path.join(root, "packages/designer/src/runtime/index.ts"));
  const registry = entry.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations).find(node => node.name.getText() === "surfaceRuntimeRenderers");
  let routes;
  try {
    const value = resolver.evaluate(registry?.initializer);
    if (value?.kind !== "object") throw new Error("Surface registry did not resolve to an object");
    routes = value.entries;
  } catch (error) { findings.push(error.finding ?? { code: "unresolved-source", detail: error.message }); routes = []; }
  const byLeaf = new Map();
  for (const route of routes) {
    const rows = byLeaf.get(route.key) ?? []; rows.push(route); byLeaf.set(route.key, rows);
    if (!registered.has(route.key)) add("unregistered-route", route.key, route.node, "Runtime route has no registered surface leaf");
  }
  // Registered component leaves are terminal boundaries. No component internals are
  // scanned or judged by this gate; their independent gate owns those implementations.
  const componentFile = path.join(root, "packages/designer/src/runtime/component-leaf.tsx");
  const componentBoundaries = new Set(), checker = program.getTypeChecker();
  for (const file of fs.readdirSync(path.join(root, "packages/designer/src/catalog/fills"), { recursive: true }).filter(file => file.endsWith(".json"))) {
    const meta = json(`packages/designer/src/catalog/fills/${file}`).$extensions?.["com.clossys.fill"];
    if (!meta?.slot?.startsWith("components.") || !meta.pin?.package || !meta.pin.export) continue;
    for (const owner of ["designer", "publisher"]) {
      const directory = path.join(root, "packages", owner), manifest = json(`packages/${owner}/package.json`);
      if (manifest.name !== meta.pin.package) continue;
      const [subpath, name] = meta.pin.export.split("#"), target = manifest.exports?.[subpath];
      const output = typeof target === "string" ? target : target?.import ?? target?.default;
      if (typeof output !== "string") continue;
      let sourcePath = path.resolve(directory, output).replace(/\/dist\//, "/src/").replace(/\.[cm]?js$/, ".ts");
      if (!fs.existsSync(sourcePath)) sourcePath = sourcePath.replace(/\.ts$/, ".tsx");
      const source = program.getSourceFile(sourcePath), module = source && checker.getSymbolAtLocation(source);
      let symbol = module && checker.getExportsOfModule(module).find(symbol => symbol.name === name);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol?.declarations ?? []) componentBoundaries.add(key(declaration));
    }
  }
  function reaches(render, canonical) {
    const seen = new Set();
    const surfaceBoundaries = new Set(fills.flatMap(fill => fill.packageRoots.map(key)));
    const bodyReturns = node => {
      const expressions = [];
      if (!node?.body) return expressions;
      if (!ts.isBlock(node.body)) return [node.body];
      walk(node.body, child => {
        if (child !== node.body && ts.isFunctionLike(child)) return false;
        if (ts.isReturnStatement(child) && child.expression) expressions.push(child.expression);
      });
      return expressions;
    };
    function callable(expression, env, aliases = new Set()) {
      expression = unwrap(expression);
      if (!expression || aliases.has(expression)) return [];
      aliases.add(expression);
      if (ts.isIdentifier(expression) && env.has(expression.text)) {
        try { const value = resolver.force(env.get(expression.text)); if (value?.kind === "function") return [value]; } catch { return []; }
      }
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return [fn(expression, env)];
      return resolver.declarations(ts.isPropertyAccessExpression(expression) ? expression.name : expression).flatMap(declaration => {
        if (componentBoundaries.has(key(declaration))) return [];
        if (!declaration.getSourceFile().fileName.startsWith(root + path.sep) || declaration.getSourceFile().fileName.includes("/node_modules/")) return [];
        if (ts.isFunctionDeclaration(declaration) && declaration.body) return [fn(declaration, env)];
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) return callable(declaration.initializer, env, aliases);
        return [];
      });
    }
    function match(expression) {
      return resolver.declarations(ts.isPropertyAccessExpression(expression) ? expression.name : expression).find(declaration => canonical.has(key(declaration)));
    }
    // A canonical block can dispatch to its own private variant components
    // (Matrix -> LibraryBoardSection). Those same declarations remain one
    // implementation when the JSON adapter selects the identical variant.
    // Selected component leaves and other registered surfaces stop this walk.
    const queue = fills.flatMap(fill => fill.packageRoots).filter(node => canonical.has(key(node))), owned = new Set();
    while (queue.length) {
      const node = queue.shift();
      if (owned.has(node)) continue;
      owned.add(node);
      for (const expression of bodyReturns(ts.isVariableDeclaration(node) ? unwrap(node.initializer) : node)) walk(expression, child => {
        const tag = ts.isJsxElement(child) ? child.openingElement.tagName : ts.isJsxSelfClosingElement(child) ? child.tagName : child === unwrap(expression) && ts.isCallExpression(child) ? child.expression : undefined;
        if (!tag) return;
        for (const declaration of resolver.declarations(tag)) {
          if (componentBoundaries.has(key(declaration))) continue;
          if (surfaceBoundaries.has(key(declaration)) && !canonical.has(key(declaration))) continue;
          if (ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isCallExpression(unwrap(declaration.initializer)) && resolver.declarations(unwrap(declaration.initializer).expression).some(node => node.getSourceFile().fileName === componentFile)) continue;
          if (!declaration.getSourceFile().fileName.startsWith(root + path.sep) || declaration.getSourceFile().fileName.includes("/node_modules/")) continue;
          if (ts.isFunctionDeclaration(declaration) && declaration.body || ts.isVariableDeclaration(declaration) && declaration.initializer && (ts.isArrowFunction(unwrap(declaration.initializer)) || ts.isFunctionExpression(unwrap(declaration.initializer)))) {
            canonical.add(key(declaration)); queue.push(declaration);
          }
        }
      });
    }
    function inspect(node, env) {
      node = unwrap(node);
      if (!node || seen.has(node)) return undefined;
      seen.add(node); resolver.files.add(node.getSourceFile().fileName);
      if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isParameter(node)) return undefined;
      if (ts.isCallExpression(node)) {
        if (resolver.declarations(node.expression).some(declaration => declaration.getSourceFile().fileName === componentFile && declaration.name?.getText() === "componentLeaf")) return undefined;
        const target = match(node.expression);
        if (target) return [key(target)];
        for (const value of callable(node.expression, env)) { const trace = inspectFunction(value); if (trace) return trace; }
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
        const target = match(tag);
        if (target) return [key(target)];
        for (const value of callable(tag, env)) { const trace = inspectFunction(value); if (trace) return trace; }
      }
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        // Resolve values used by the rendered return, never an unused function's
        // body or an import mentioned elsewhere in the adapter.
        for (const declaration of resolver.declarations(ts.isPropertyAccessExpression(node) ? node.name : node)) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer && !ts.isArrowFunction(unwrap(declaration.initializer)) && !ts.isFunctionExpression(unwrap(declaration.initializer))) {
            const trace = inspect(declaration.initializer, env); if (trace) return trace;
          }
        }
        return undefined;
      }
      if (ts.isFunctionLike(node)) return undefined;
      let result;
      ts.forEachChild(node, child => { if (!result) result = inspect(child, env); });
      return result;
    }
    function inspectFunction(value) {
      for (const expression of bodyReturns(value.node)) {
        const trace = inspect(expression, value.env);
        if (trace) return [key(value.node), ...trace];
      }
    }
    const expressions = bodyReturns(render.node).filter(expression => {
      expression = unwrap(expression);
      if (!ts.isCallExpression(expression)) return true;
      const targets = callable(expression.expression, render.env);
      // A source-proven throw is a refused input, not another UI implementation.
      return !targets.length || !targets.every(target => target.node.body && ts.isBlock(target.node.body) && target.node.body.statements.length === 1 && ts.isThrowStatement(target.node.body.statements[0]));
    });
    const branches = expressions.map(expression => { seen.clear(); return inspect(expression, render.env); });
    return { delegation: branches.length && branches.every(Boolean) ? [key(render.node), ...new Set(branches.flat())] : undefined, canonicalGraph: [...owned].map(key), unproven: expressions.filter((_, index) => !branches[index]) };
  }
  const native = new Map(), nativeOutputs = [];
  try {
    const importer = path.join(root, "packages/designer/src/importers/specimen-sections.ts");
    const generated = sourceModule(importer).specimenSectionSourceCatalog();
    const registryFile = program.getSourceFile(path.join(root, "packages/designer/src/studio/specimen-registry.ts"));
    const registryNode = registryFile.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations).find(node => node.name.getText() === "studioSpecimenLeaves");
    const definitions = resolver.evaluate(registryNode.initializer);
    if (!Array.isArray(definitions)) resolver.fail(registryNode, "Native specimen registry is unknown");
    const studio = program.getSourceFile(path.join(root, "packages/designer/src/studio/index.ts"));
    const checker = program.getTypeChecker(), studioExports = checker.getExportsOfModule(checker.getSymbolAtLocation(studio));
    for (const doc of generated.fills) {
      const meta = doc.$extensions["com.clossys.fill"], implementation = Object.values(doc.sections)[0].impl;
      const emitted = generated.upstream.filter(file => file.path === implementation.entry);
      const candidates = definitions.filter(definition => resolver.get(definition, "id", registryNode) === meta.slot);
      if (native.has(meta.slot) || emitted.length !== 1 || candidates.length !== 1) resolver.fail(registryNode, `Duplicate/missing native source for ${meta.slot}`, "duplicate-implementation");
      const render = resolver.get(candidates[0], "render", registryNode);
      if (render?.kind !== "function") resolver.fail(registryNode, `Native runtime source missing for ${meta.slot}`);
      // Inspect the actual emitted import/return chain rather than guessing from a name table.
      const ast = ts.createSourceFile(implementation.entry, emitted[0].content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const exported = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === implementation.export && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
      const returns = [];
      if (exported?.body) walk(exported.body, node => {
        if (node !== exported.body && ts.isFunctionLike(node)) return false;
        if (ts.isReturnStatement(node)) returns.push(node);
      });
      const drawing = returns.filter(node => node.parent === exported.body);
      const props = exported?.parameters[0]?.name;
      // The emitted adapter's reason/context NEED path is a refused binding.
      // Every other return must be the one canonical JSX implementation.
      const refusedBinding = node => {
        const call = unwrap(node.expression), parent = node.parent;
        if (!call || !props) return false;
        return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(props) && call.expression.expression.getText() === props.text && call.expression.name.text === "need" && call.arguments.length === 1 && ts.isIfStatement(parent) && ts.isBinaryExpression(parent.expression) && parent.expression.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isStringLiteral(parent.expression.left) && parent.expression.left.text === "reason" && parent.expression.right.getText() === call.arguments[0].getText();
      };
      if (drawing.length !== 1 || !ts.isJsxSelfClosingElement(drawing[0].expression) || returns.some(node => node !== drawing[0] && !refusedBinding(node))) resolver.fail(registryNode, `Native importer has independent/unknown render path for ${meta.slot}`, "competing-implementation");
      const rootReturn = drawing[0];
      const tag = rootReturn.expression.tagName.getText();
      const imports = ast.statements.filter(ts.isImportDeclaration).flatMap(statement => statement.moduleSpecifier.text === "@clossys/designer/studio" && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.filter(item => item.name.text === tag).map(item => (item.propertyName ?? item.name).text) : []);
      if (imports.length !== 1) resolver.fail(registryNode, `Native importer render identity unknown for ${meta.slot}`);
      const publicSymbol = studioExports.find(symbol => symbol.name === imports[0]);
      const declarations = (publicSymbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(publicSymbol) : publicSymbol)?.declarations?.filter(node => !ts.isFunctionDeclaration(node) || node.body) ?? [];
      const exportedRender = declarations.length === 1 ? resolver.evaluate(ts.isVariableDeclaration(declarations[0]) ? declarations[0].initializer : declarations[0]) : undefined;
      if (exportedRender?.kind !== "function" || key(exportedRender.node) !== key(render.node)) resolver.fail(registryNode, `Native importer and registry compete for ${meta.slot}`, "competing-implementation");
      const live = offers.filter(offer => offer.leaf === meta.slot);
      if (live.length === 1 && (live[0].impl?.kind !== "source" || live[0].impl.entry !== implementation.entry || live[0].impl.export !== implementation.export)) resolver.fail(registryNode, `Live native offer and source importer differ for ${meta.slot}`, "catalog-source-mismatch");
      native.set(meta.slot, { meta, render, canonical: exportedRender.node, importer: path.relative(root, importer), entry: implementation.entry });
      nativeOutputs.push({ file: implementation.entry, sha256: createHash("sha256").update(emitted[0].content).digest("hex") });
    }
    for (const definition of definitions) {
      const id = resolver.get(definition, "id", registryNode);
      if (!native.has(id)) resolver.fail(registryNode, `Native registry has no source candidate for ${id}`, "missing-source");
    }
  } catch (error) { findings.push(error.finding ?? { code: "unresolved-source", detail: error.message }); }
  for (const leaf of slots) {
    const descriptors = fills.filter(fill => fill.leaf === leaf), candidates = byLeaf.get(leaf) ?? [];
    if (native.has(leaf)) {
      const source = native.get(leaf);
      if (descriptors.length || candidates.length) add("duplicate-implementation", leaf, source.render.node, "Native and package surface routes both claim this leaf");
      inventory.push({ leaf, fill: source.meta.id, descriptor: source.importer, canonical: key(source.canonical), runtime: key(source.render.node), sourceEntry: source.entry });
      continue;
    }
    if (descriptors.length !== 1) { findings.push({ code: "descriptor-count", leaf, detail: `Expected one descriptor, received ${descriptors.length}` }); continue; }
    const fill = descriptors[0], canonical = [...new Map(fill.packageRoots.filter(node => !ts.isFunctionDeclaration(node) || node.body).map(node => [key(node), node])).values()];
    if (canonical.length !== 1) { findings.push({ code: "unresolved-source", leaf, detail: `Expected one canonical export, received ${canonical.length}` }); continue; }
    if (candidates.length !== 1) { findings.push({ code: candidates.length ? "duplicate-implementation" : "missing-route", leaf, detail: `Expected one runtime route, received ${candidates.length}` }); continue; }
    try {
      const route = candidates[0], value = resolver.force(route.value), routeLeaf = resolver.get(value, "leaf", route.node), render = resolver.get(value, "render", route.node);
      if (routeLeaf !== leaf || render?.kind !== "function") resolver.fail(route.node, "Route leaf/render source is unresolved", "unresolved-source");
      const proof = reaches(render, new Set(canonical.map(key))), delegation = proof.delegation;
      if (!delegation) for (const branch of proof.unproven.length ? proof.unproven : [render.node]) add("competing-implementation", leaf, branch, `Runtime return does not delegate to canonical ${key(canonical[0])}: ${branch.getText().slice(0, 240)}`);
      inventory.push({ leaf, fill: fill.id, descriptor: fill.descriptor, canonical: key(canonical[0]), canonicalGraph: proof.canonicalGraph, runtime: key(render.node), delegation, route: resolver.location(route.node) });
    } catch (error) { findings.push({ leaf, ...(error.finding ?? { code: "unresolved-source", detail: error.message }) }); }
  }
  for (const fill of fills) if (!registered.has(fill.leaf)) findings.push({ code: "unregistered-descriptor", leaf: fill.leaf, detail: fill.descriptor });
  let defaultAdoptions = [], shippingDefaults;
  try {
    const defaults = await checkPreparedDefaultAdoptions(root);
    defaultAdoptions = defaults.rows; findings.push(...defaults.findings);
    // Execute the shipped Producer caller, including its ordinary package evidence
    // reader and component/default dependency closure, against current source modules.
    const shipping = await sourceModule(path.join(root, "packages/producer/src/server/selection-defaults.ts")).prepareStudioSelection();
    const adopted = shipping.input.library.surfaces.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot.startsWith("sections.specimen-"));
    shippingDefaults = { sourceBundles: shipping.surfaceBundles.length, nativeAdopted: adopted.length, surfacesAdopted: shipping.input.library.surfaces.fills.length };
    const planner = sourceModule(path.join(root, "packages/designer/src/catalog-core/index.ts"));
    const replay = await checkPreparedDefaultAdoptions(root, { ...shipping, plan: planner.planSurfaceDefaults({ catalog: shipping.input.catalog.surfaces, slots: adopted.map(doc => doc.$extensions["com.clossys.fill"].slot), preference: planner.DEFAULT_COMPONENT_PREFERENCE }) });
    findings.push(...replay.findings.map(finding => ({ ...finding, caller: "Producer.prepareStudioSelection" })));
    if (adopted.length !== native.size || shipping.surfaceBundles.length !== native.size) findings.push({ code: "shipping-default-inventory", detail: "Shipped Studio preparation must retain every native specimen and its bundle", ...shippingDefaults });
  } catch (error) { findings.push({ code: "shipping-default-adoption", detail: error.message }); }
  const sourceFiles = new Set([...resolver.files, ...fills.map(fill => path.join(root, fill.descriptor)), ...["sections", "frames"].map(layer => path.join(root, `packages/designer/src/catalog/slots/${layer}.json`)), ...["package.json", "package-lock.json", "packages/designer/package.json", "packages/publisher/package.json"].map(file => path.join(root, file))]);
  // Hash the complete candidate source universe as well as the gate itself. A green
  // report cannot be reused after an unvisited new competing source file is added.
  const collect = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) collect(file); else if (/\.(?:[cm]?tsx?|mjs|json)$/.test(file)) sourceFiles.add(file); } };
  collect(path.join(root, "packages/designer/src")); collect(path.join(root, "packages/designer/scripts"));
  collect(path.join(root, "packages/publisher/src"));
  collect(path.join(root, "packages/producer/src")); collect(path.join(root, "packages/producer/scripts")); collect(path.join(root, "packages/producer/studio"));
  sourceFiles.add(path.join(root, "packages/producer/package.json"));
  const sources = [...sourceFiles].filter(file => file.startsWith(root + path.sep) && !file.includes("/node_modules/")).sort().map(file => ({ file: path.relative(root, file).split(path.sep).join("/"), sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
  return { status: findings.length ? "FAIL" : "PASS", counts: { registered: slots.length, sections: slots.filter(leaf => leaf.startsWith("sections.")).length, frames: slots.filter(leaf => leaf.startsWith("frames.")).length, resolved: inventory.length, packageRoutes: routes.length, nativeRoutes: native.size, catalogOffers: offers.length, defaultAdoptions: defaultAdoptions.length, preparedSourceBundles: defaultAdoptions.filter(row => row.matchingBundles === 1).length, packageDefaultCandidates: defaultAdoptions.filter(row => row.packageCandidates === 1).length }, findings, defaultAdoptions, shippingDefaults, inventory: slots.map(leaf => ({ ...(inventory.find(row => row.leaf === leaf) ?? { leaf }), status: !inventory.some(row => row.leaf === leaf) || offers.filter(offer => offer.leaf === leaf).length !== 1 || findings.some(finding => finding.leaf === leaf || !finding.leaf) ? "FAIL" : "PASS", offers: offers.filter(offer => offer.leaf === leaf), findings: findings.filter(finding => finding.leaf === leaf) })), sources, nativeOutputs, sourceHash: createHash("sha256").update(JSON.stringify({ sources, nativeOutputs })).digest("hex") };
}
