#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createLeafAnalyzer, createSurfaceLeafContext } from "./lib/surface-leaf-check.mjs";

const commonActions = ["Explorer", "Inspector", "Source", "Checks", "Needs"];
// A241.1/A242 assertions, never a runtime manifest or a rendering input.
const requiredSections = new Map([["Explorer", "sections.explorer"], ["Inspector", "sections.record-detail"], ["Source", "sections.content"], ["Checks", "sections.status-list"], ["Needs", "sections.task-list"]]);
const requiredLabels = new Map([
  ["director", commonActions],
  ["designer", commonActions],
  ["writer", commonActions],
  ["publisher", commonActions],
  ["home", ["Needs"]],
]);
const unwrap = node => node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) ? unwrap(node.expression) : node;
const literal = node => {
  node = unwrap(node);
  if (node && ts.isStringLiteralLike(node)) return node.text;
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
};
const within = (node, parent) => Boolean(node && parent && node.getSourceFile() === parent.getSourceFile() && node.pos >= parent.pos && node.end <= parent.end);
const propertyName = node => node?.name && (ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText());

/** Actual registered fills and source roots, resolved by the A237 authority. */
export function createStudioModuleCatalog(catalogRoot, options) {
  const context = createSurfaceLeafContext(catalogRoot, options);
  const sections = new Map();
  for (const fill of context.fills) if (fill.leaf.startsWith("sections.")) {
    const current = sections.get(fill.leaf) ?? { roots: [], fills: [] };
    current.roots.push(...fill.packageRoots, ...fill.runtimeRoots);
    current.fills.push(fill.id);
    sections.set(fill.leaf, current);
  }
  return { ...context, sections };
}

/** Follow actual value symbols, including import aliases and local wrappers. */
export function hasValueProvenance(program, expression, targetFile, targetExport) {
  const checker = program.getTypeChecker(), seen = new Set();
  const target = path.resolve(targetFile);
  const unalias = value => value?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(value) : value;
  const source = program.getSourceFile(target), module = source && checker.getSymbolAtLocation(source);
  const exported = targetExport && unalias(module && checker.getExportsOfModule(module).find(symbol => symbol.name === targetExport));
  if (targetExport && !exported) return false;
  function visit(node) {
    if (!node || seen.has(node) || ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return false;
    seen.add(node);
    if (!targetExport && path.resolve(node.getSourceFile().fileName) === target) return true;
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    for (const declaration of symbol?.declarations ?? []) {
      let imported = declaration;
      while (imported.parent && !ts.isImportDeclaration(imported) && !ts.isSourceFile(imported)) imported = imported.parent;
      if (ts.isImportDeclaration(imported) && (imported.importClause?.isTypeOnly || ts.isImportSpecifier(declaration) && declaration.isTypeOnly)) return false;
    }
    const aliases = new Set();
    while (symbol?.flags & ts.SymbolFlags.Alias && !aliases.has(symbol)) { aliases.add(symbol); symbol = checker.getAliasedSymbol(symbol); }
    if (targetExport && (symbol === exported || exported.declarations?.includes(node))) return true;
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isParameter(declaration) || ts.isPropertySignature(declaration)) continue;
      if (visit(declaration)) return true;
    }
    let found = false;
    ts.forEachChild(node, child => { if (visit(child)) found = true; });
    return found;
  }
  return visit(expression);
}

/**
 * One adapter seam for the native Publisher contract. `pages` and `actions`
 * carry AST nodes, not another copy of manifest values. Each page supplies
 * role, node, actionsNode, and actions[{node, fields:{semanticName: ASTNode}}].
 * Semantic fields are id/label/icon/defaultOpen/moduleSection/moduleSource.
 * This is NOT a
 * proposed Publisher schema. The native adapter must map its published fields.
 *
 * `sections` is the shared catalog resolver's Map<leaf, {roots: Declaration[]}>.
 * `consumers` supplies pageRole/sourceFile/bindings[{node}], where bindings are
 * the native action/module host expressions discovered by that same adapter.
 * Missing native adapters are reported by the CLI, never qualified as empty.
 */
export function analyzeStudioPageModules({ program, root, studioSourceRoot, manifestFile, publisherProjectionFile, publisherProjectionExport, pages, sections, consumers, analyzer: sharedAnalyzer, leafAnalyzerOptions = {} }) {
  const findings = [], measuredModules = new Set(), measuredPages = new Set();
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  const add = (rule, node, detail, page) => {
    const source = node?.getSourceFile(), position = source && source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ rule, file: source ? relative(source.fileName) : relative(manifestFile), line: position ? position.line + 1 : 1, detail, ...(page ? { page } : {}) });
  };
  const manifestSource = program.getSourceFile(path.resolve(manifestFile));
  const projectionSource = program.getSourceFile(path.resolve(publisherProjectionFile));
  if (!manifestSource || !projectionSource) {
    add("missing-native-authority", undefined, "Both the native Publisher manifest and its value projection must be present in the program");
    return { status: "MISSING", coverage: { pages: 0, modules: 0 }, findings };
  }
  const analyzer = sharedAnalyzer ?? createLeafAnalyzer({ ...leafAnalyzerOptions, program, root });
  const nativeFieldNames = new Set();
  for (const page of pages) {
    const role = page.role, expected = requiredLabels.get(role);
    if (!expected || measuredPages.has(role)) { add("page-identity", page.node, "Unknown or duplicate Studio page identity", role); continue; }
    measuredPages.add(role);
    if (page.node?.getSourceFile() !== manifestSource || !within(page.actionsNode, page.node) || !ts.isArrayLiteralExpression(page.actionsNode)) {
      add("manifest-source-provenance", page.node, "Page actions must come from the exact native Publisher manifest node", role);
      continue;
    }
    const originalActions = page.actionsNode.elements;
    if (originalActions.length !== page.actions.length || page.actions.some((action, index) => action.node !== originalActions[index])) add("manifest-action-coverage", page.actionsNode, "The adapter must measure every native action exactly once and in order", role);
    const labels = [], identities = new Set(), pageModules = new Set();
    for (const action of page.actions) {
      if (!within(action.node, page.actionsNode) || !ts.isObjectLiteralExpression(action.node)) { add("manifest-source-provenance", action.node, "Action is not a native manifest object", role); continue; }
      const values = {};
      for (const [field, node] of Object.entries(action.fields)) {
        if (!within(node, action.node) || literal(node) === undefined) add("manifest-field-provenance", node, `Action ${field} must be a literal from its own native manifest object`, role);
        else values[field] = literal(node);
        if (node?.parent && ts.isPropertyAssignment(node.parent)) nativeFieldNames.add(propertyName(node.parent));
      }
      for (const field of ["id", "label", "icon"]) if (typeof values[field] !== "string" || !values[field].trim()) add("action-field-shape", action.node, `A nonempty ${field} is required`, role);
      if (identities.has(values.id)) add("duplicate-action", action.node, "Action identity must be unique on its page", role);
      identities.add(values.id);
      labels.push(values.label);
      if (values.intent !== undefined) add("removed-apps-action", action.node, "A241.1 removes Apps and its external-action exception", role);
      if (values.defaultOpen !== (role !== "home" && values.label === "Explorer")) add("module-default-state", action.node, "Only Explorer on agent pages is open by default", role);
      const leaf = values.moduleSection, registered = typeof leaf === "string" && leaf.startsWith("sections.") && sections.get(leaf);
      if (requiredSections.get(values.label) !== leaf) add("page-module-mapping", action.node, "A242 requires the existing registered section for this action", role);
      if (values.moduleSource !== undefined && (typeof values.moduleSource !== "string" || !values.moduleSource.trim())) add("action-field-shape", action.node, "An optional module source must be a nonempty native identity", role);
      if (!registered || !registered.roots?.length) { add("unregistered-module-section", action.node, "The action must resolve to a registered section with resolved source declarations", role); continue; }
      const moduleIdentity = JSON.stringify([leaf, values.moduleSource ?? null]);
      if (pageModules.has(moduleIdentity)) add("duplicate-module-section", action.node, "Each page action must toggle its own section/source instance", role);
      pageModules.add(moduleIdentity);
      if (!measuredModules.has(leaf)) {
        measuredModules.add(leaf);
        const report = analyzer.analyze(registered.roots);
        if (!report.files.length) add("unmeasured-module-body", action.node, "Registered module source was not measured", role);
        for (const finding of report.findings) findings.push({ ...finding, page: role, moduleSection: leaf });
      }
    }
    if (labels.length !== expected.length || expected.some(label => labels.filter(value => value === label).length !== 1)) add("page-action-contract", page.actionsNode, `A241.1 requires exactly: ${expected.join(", ")}`, role);
  }
  for (const role of requiredLabels.keys()) if (!measuredPages.has(role)) add("missing-studio-page", undefined, `Studio page was not measured: ${role}`, role);
  const consumerRoles = new Set();
  for (const consumer of consumers) {
    const source = consumer.sourceFile, role = consumer.pageRole;
    const reachable = new Set(reachableStudioDeclarations(program, source, studioSourceRoot));
    consumerRoles.add(role);
    const rel = path.relative(studioSourceRoot, source.fileName);
    if (!requiredLabels.has(role) || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || program.getSourceFile(source.fileName) !== source) { add("consumer-source-provenance", source, "Consumer must be an actual source file under the selected Studio source root", role); continue; }
    if (!consumer.bindings.length) add("missing-manifest-consumption", source, "No action/module host expression was measured", role);
    for (const binding of consumer.bindings) {
      if (!reachable.has(binding.node) || !hasValueProvenance(program, binding.node, manifestFile) || !hasValueProvenance(program, binding.node, publisherProjectionFile, publisherProjectionExport)) add("manifest-consumption-provenance", binding.node, "Action/module expressions must resolve through the native Publisher action export to the manifest", role);
      if (publisherProjectionExport) {
        const seen = new Set(), checker = program.getTypeChecker();
        function inspectIndexes(node) {
          if (!node || seen.has(node) || ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
          seen.add(node);
          if (ts.isElementAccessExpression(node) && hasValueProvenance(program, node.expression, publisherProjectionFile, publisherProjectionExport)) {
            const key = literal(node.argumentExpression);
            if (typeof key === "string" && key !== role) add("wrong-page-manifest-consumption", node, `This ${role} consumer selects actions for ${key}`, role);
            else if (key === undefined && !hasValueProvenance(program, node.argumentExpression, manifestFile)) add("unproven-page-manifest-key", node, "A dynamic action page key must derive from native manifest route identity", role);
          }
          let symbol = checker.getSymbolAtLocation(node);
          if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          for (const declaration of symbol?.declarations ?? []) {
            const file = declaration.getSourceFile().fileName, relative = path.relative(studioSourceRoot, file);
            if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
            if (declaration.initializer) inspectIndexes(declaration.initializer);
            if (declaration.body) inspectIndexes(declaration.body);
          }
          ts.forEachChild(node, inspectIndexes);
        }
        inspectIndexes(binding.node);
      }
    }
    function visit(node) {
      if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isStringLiteralLike(node) && (/^sections\.[a-z][a-z0-9-]*$/.test(node.text) || ["Reload cells", "Open Home"].includes(node.text))) add("inline-page-module-literal", node, "Studio page code must consume manifest actions/modules", role);
      if (ts.isObjectLiteralExpression(node)) {
        const fields = node.properties.filter(property => ts.isPropertyAssignment(property) && literal(property.initializer) !== undefined).map(propertyName).filter(name => nativeFieldNames.has(name));
        if (fields.length >= 3) add("inline-page-action-literal", node, "An inline object repeats the native action property shape", role);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const role of requiredLabels.keys()) if (!consumerRoles.has(role)) add("missing-page-consumer", undefined, `No Studio consumer measured for ${role}`, role);
  return { status: findings.length ? "FINDINGS" : "MEASURED", coverage: { pages: measuredPages.size, modules: measuredModules.size }, findings };
}

const property = (node, name) => node && ts.isObjectLiteralExpression(node) ? node.properties.find(row => ts.isPropertyAssignment(row) && propertyName(row) === name)?.initializer : undefined;
const jsonObject = source => source?.statements.find(ts.isExpressionStatement)?.expression;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

/** Native H1 entry.actions / pageActions contract, retained by 2d68fae. */
export function adaptPublishedStudioActions({ program, manifestFile, studioSourceRoot }) {
  // Bind compiler-created nodes before helpers read their parent/source links.
  program.getTypeChecker();
  const source = program.getSourceFile(path.resolve(manifestFile)), document = jsonObject(source);
  const entries = property(property(document, "map"), "entries"), projected = property(document, "pageActions");
  if (!entries || !ts.isArrayLiteralExpression(entries) || !projected || !ts.isObjectLiteralExpression(projected)) return { status: "MISSING", detail: "Native projection.map.entries and projection.pageActions are required" };
  const pages = [], findings = [];
  function inspectKilledApps(node) {
    if (ts.isStringLiteralLike(node) && (node.text === "apps" || /^\/apps(?:[/?#]|$)/.test(node.text) || node.text === "open-app-dev-server" || node.text === "open-selected-app-dev-server")) findings.push({ rule: "removed-apps-surface", detail: "A241.1 removes Apps from routes, navigation, commands, children, and actions", line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    ts.forEachChild(node, inspectKilledApps);
  }
  inspectKilledApps(document);
  for (const node of entries.elements) {
    if (literal(property(node, "kind")) !== "page") continue;
    const role = literal(property(node, "id")), actionsNode = property(node, "actions");
    if (!actionsNode || !ts.isArrayLiteralExpression(actionsNode)) return { status: "MISSING", detail: `Native Publisher entry.actions is missing for ${role}` };
    const actions = actionsNode.elements.map(action => {
      const fields = {};
      for (const key of ["id", "label", "icon", "defaultOpen", "intent"]) { const node = property(action, key); if (node) fields[key] = node; }
      const module = property(action, "module");
      for (const [semantic, native] of [["moduleSection", "section"], ["moduleSource", "source"]]) { const node = property(module, native); if (node) fields[semantic] = node; }
      return { node: action, fields };
    });
    const projection = property(projected, role);
    if (!projection || !equal(JSON.parse(actionsNode.getText(source)), JSON.parse(projection.getText(source)))) return { status: "FINDINGS", detail: `Native projected actions disagree with Publisher entry.actions for ${role}` };
    pages.push({ role, node, actionsNode, actions });
  }
  const routes = property(document, "routes");
  if (!routes || !ts.isArrayLiteralExpression(routes)) return { status: "MISSING", detail: "Native Studio routes are required to identify actual page consumers" };
  const consumers = [];
  for (const route of routes.elements) {
    const pageRole = literal(property(route, "instanceId")), entry = property(route, "entry"), file = literal(property(entry, "file"));
    if (typeof file !== "string" || !file.startsWith("studio/")) return { status: "FINDINGS", detail: "Native route must identify a Studio source file" };
    const filename = path.resolve(studioSourceRoot, file.slice("studio/".length)), sourceFile = program.getSourceFile(filename);
    if (!sourceFile) return { status: "MISSING", detail: `Actual Studio route source missing: ${file}` };
    const bindings = [];
    for (const reachable of reachableStudioDeclarations(program, sourceFile, studioSourceRoot)) {
      const node = reachable;
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && hasValueProvenance(program, node.tagName, path.join(studioSourceRoot, "generated/studio-map.ts"), "studioPageActions")) bindings.push({ node: node.tagName });
      if (ts.isJsxAttribute(node) && ["actions", "modules"].includes(node.name.getText()) && node.initializer && ts.isJsxExpression(node.initializer)) bindings.push({ node: node.initializer.expression });
      if (ts.isElementAccessExpression(node) && hasValueProvenance(program, node.expression, path.join(studioSourceRoot, "generated/studio-map.ts"), "studioPageActions")) bindings.push({ node });
    }
    consumers.push({ pageRole, sourceFile, bindings });
  }
  return { status: "ADAPTED", pages, consumers, findings };
}

/** Follow local value declarations reached from a route, including component wrappers. */
function reachableStudioDeclarations(program, sourceFile, studioSourceRoot) {
  const checker = program.getTypeChecker(), seen = new Set(), nodes = [];
  function visit(node) {
    if (!node || seen.has(node) || ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    seen.add(node); nodes.push(node);
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) {
        const typeOnly = symbol.declarations?.some(row => ts.isImportSpecifier(row) && (row.isTypeOnly || row.parent.parent.isTypeOnly));
        if (typeOnly) return;
        symbol = checker.getAliasedSymbol(symbol);
      }
      for (const declaration of symbol?.declarations ?? []) {
        const relative = path.relative(studioSourceRoot, declaration.getSourceFile().fileName);
        if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) visit(declaration);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile); return nodes;
}

/** Exact 2d68fae shape: entry.body -> pageBodies; A244 removes container selection. */
export function adaptPublishedStudioBodies({ program, manifestFile }) {
  program.getTypeChecker();
  const source = program.getSourceFile(path.resolve(manifestFile)), document = jsonObject(source);
  const entries = property(property(document, "map"), "entries"), projected = property(document, "pageBodies");
  if (!entries || !ts.isArrayLiteralExpression(entries) || !projected || !ts.isObjectLiteralExpression(projected)) return { status: "MISSING", detail: "Native projection.map.entries and projection.pageBodies are required", pages: [], findings: [] };
  const pages = [], findings = [];
  const add = (rule, node, detail, page) => findings.push({ rule, page, file: source.fileName, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, detail });
  for (const node of entries.elements) {
    if (literal(property(node, "kind")) !== "page") continue;
    const role = literal(property(node, "id")), body = property(node, "body"), projection = property(projected, role);
    if (role === "home") { if (body || projection) add("home-body-declaration", body ?? projection, "Home has no IA body declaration", role); continue; }
    if (!requiredLabels.has(role)) { add("page-identity", node, "Unknown Studio body page", role); continue; }
    if (!body || !ts.isObjectLiteralExpression(body)) { add("missing-native-page-body", node, "Agent Publisher entry.body is required", role); continue; }
    if (!projection || !equal(JSON.parse(body.getText(source)), JSON.parse(projection.getText(source)))) add("native-body-projection-drift", body, "Native pageBodies must exactly project this entry.body", role);
    const bands = property(body, "bands"), row = property(body, "row"), columns = property(row, "columns");
    const expected = { L0: "sections.section-header", L1: "sections.section-header", L2: "sections.cards" };
    if (literal(property(body, "template")) !== "ia-scroll") add("page-body-template", body, "Agent body template must be ia-scroll", role);
    if (!bands || !ts.isObjectLiteralExpression(bands) || !equal(Object.fromEntries(bands.properties.map(field => [propertyName(field), literal(field.initializer)])), expected)) add("page-body-bands", bands ?? body, "A244 bands bind L0/L1 to section-header and L2 to cards", role);
    if (!columns || !ts.isArrayLiteralExpression(columns) || !equal(columns.elements.map(literal), ["title", "specimen", "status", "version", "usedBy", "linkOut"])) add("page-body-columns", columns ?? body, "Native row metadata columns must preserve the Publisher contract", role);
    for (const [object, allowed] of [[body, ["template", "bands", "row"]], [row, ["specimen", "columns"]]]) if (object && ts.isObjectLiteralExpression(object)) for (const field of object.properties) if (!allowed.includes(propertyName(field))) add("superseded-body-field", field, "A244 body has no container selection, layout, or authored span override", role);
    const specimen = property(row, "specimen");
    if (specimen && !/^sections\.specimen-[a-z0-9-]+$/.test(literal(specimen) ?? "")) add("invalid-body-specimen", specimen, "An authored specimen must be an exact sections.specimen-* identity", role);
    pages.push({ role, node, bodyNode: body, bandsNode: bands, specimenNode: specimen });
  }
  for (const role of ["director", "designer", "writer", "publisher"]) if (!pages.some(page => page.role === role)) add("missing-native-page-body", document, `No native body measured for ${role}`, role);
  for (const field of projected.properties) if (!["director", "designer", "writer", "publisher"].includes(propertyName(field))) add("unexpected-projected-body", field, "Only agent bodies are projected", propertyName(field));
  return { status: findings.length ? "FINDINGS" : "ADAPTED", pages, findings };
}

/** Measure actual route-reachable JSX; names and dynamic values grant no section authority. */
export function inspectUnboundStudioPageBodies({ program, studioSourceRoot, root = studioSourceRoot, manifestFile, consumers, sections = new Map(), analyzer: sharedAnalyzer, leafAnalyzerOptions = {} }) {
  const adapted = manifestFile && adaptPublishedStudioBodies({ program, manifestFile });
  const findings = adapted ? [...adapted.findings] : [];
  if (!adapted || adapted.status === "MISSING") findings.push({ rule: "missing-native-body-binding-contract", detail: adapted?.detail ?? "Explicit native Publisher manifest is required to measure body bindings" });
  const projectionFile = path.join(studioSourceRoot, "generated/studio-map.ts");
  const checker = program.getTypeChecker(), frame = program.getSourceFile(path.join(studioSourceRoot, "components/StudioFrame.tsx"));
  const frameModule = frame && checker.getSymbolAtLocation(frame);
  const frameExport = frameModule && checker.getExportsOfModule(frameModule).find(symbol => symbol.name === "StudioFrame");
  const unalias = symbol => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const analyzer = sharedAnalyzer ?? createLeafAnalyzer({ ...leafAnalyzerOptions, program, root });
  const measured = new Set();
  for (const page of adapted?.pages ?? []) {
    const leaves = ["L0", "L1", "L2"].map(level => ({ node: property(page.bandsNode, level), leaf: literal(property(page.bandsNode, level)) }));
    if (page.specimenNode) leaves.push({ node: page.specimenNode, leaf: literal(page.specimenNode) });
    for (const { node, leaf } of leaves) {
      const registered = sections.get(leaf);
      if (!registered?.roots?.length) { findings.push({ rule: "unregistered-body-section", page: page.role, detail: `Native body leaf has no resolved registered source: ${leaf ?? "missing"}` }); continue; }
      if (measured.has(leaf)) continue;
      measured.add(leaf);
      const report = analyzer.analyze(registered.roots);
      if (!report.files.length) findings.push({ rule: "unmeasured-body-section", page: page.role, detail: `Native body leaf was not measured: ${leaf}` });
      findings.push(...report.findings.map(finding => ({ ...finding, page: page.role, bodySection: leaf })));
    }
  }
  for (const consumer of consumers) {
    const body = adapted?.pages.find(page => page.role === consumer.pageRole), bindings = [];
    const nodes = reachableStudioDeclarations(program, consumer.sourceFile, studioSourceRoot);
    const add = (rule, node, detail) => { const source = node.getSourceFile(); findings.push({ rule, file: source.fileName, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, page: consumer.pageRole, detail }); };
    for (const node of nodes) {
      const direct = ts.isElementAccessExpression(node) && hasValueProvenance(program, node.expression, projectionFile, "studioPageBodies");
      const projected = ts.isCallExpression(node) && hasValueProvenance(program, node.expression, projectionFile, "studioPageBody");
      if (direct || projected) {
        const key = direct ? node.argumentExpression : node.arguments[0], value = literal(key);
        if (value !== undefined && value !== consumer.pageRole) add("wrong-page-body-consumption", node, "Body binding selects another page");
        else if (value === undefined && (!manifestFile || !hasValueProvenance(program, key, manifestFile))) add("unproven-page-body-key", node, "Dynamic body keys must derive from native manifest route identity");
        else if (!manifestFile || !hasValueProvenance(program, node, manifestFile)) add("body-consumption-provenance", node, "Body expressions must resolve to the native manifest");
        else bindings.push(node);
        if (projected) {
          const specimen = literal(node.arguments[1]), registered = typeof specimen === "string" && /^sections\.specimen-/.test(specimen) && sections.get(specimen);
          if (!registered?.roots?.length) add("unproven-bound-specimen", node, "The bound specimen must resolve to one registered Designer specimen leaf; dynamic values alone do not prove it");
          else if (!measured.has(specimen)) {
            measured.add(specimen);
            const report = analyzer.analyze(registered.roots);
            if (!report.files.length) add("unmeasured-body-section", node, `Bound specimen source was not measured: ${specimen}`);
            findings.push(...report.findings.map(finding => ({ ...finding, page: consumer.pageRole, bodySection: specimen })));
          }
          if (body?.specimenNode && literal(body.specimenNode) !== specimen) add("conflicting-bound-specimen", node, "Bound specimen disagrees with authored native body specimen");
        }
      }
    }
    if (body && !bindings.length) add("missing-native-body-consumption", consumer.sourceFile, "Native body exists but no route-reachable studioPageBodies/studioPageBody value binding was measured");
    for (const node of nodes) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = unalias(checker.getSymbolAtLocation(node.tagName));
        if (!frameExport || tag !== unalias(frameExport) || !hasValueProvenance(program, node.tagName, frame.fileName, "StudioFrame")) {
          const nativeAttribute = node.attributes.properties.some(attribute => {
            if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return false;
            const expression = unwrap(attribute.initializer.expression);
            if (!expression || !ts.isPropertyAccessExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
            const group = expression.expression.name.text, key = expression.name.text, owner = expression.expression.expression;
            if (!bindings.some(binding => binding === owner)) return false;
            const leaf = group === "bands" ? literal(property(body?.bandsNode, key)) : group === "row" && key === "specimen" ? literal(body?.specimenNode) ?? (ts.isCallExpression(owner) ? literal(owner.arguments[1]) : undefined) : undefined;
            return sections.get(leaf)?.roots?.some(root => tag?.declarations?.includes(root)) ?? false;
          });
          if (!nativeAttribute) add(/^[a-z]/.test(node.tagName.getText()) ? "raw-page-body-element" : "unbound-page-section", node, `${node.tagName.getText()} has no measured native Publisher body/level section binding`);
        }
      }
    }
  }
  return findings;
}

const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.isSymbolicLink() || ["node_modules", ".next", "dist", "build"].includes(entry.name)) return [];
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?tsx?$/.test(file) && !/\.(?:test|spec)\./.test(file) ? [file] : [];
});
const missing = findings => ({ schemaVersion: 1, status: "MISSING", coverage: { pages: 0, modules: 0 }, findings, limits: ["Actual native Studio/module source must be available; semantic fixtures do not qualify adoption."] });

/** Explicit roots allow native Studio and the registered catalog to be distinct. */
export function checkStudioPageModules({ studioSourceRoot, catalogRoot, manifestPath } = {}) {
  const findings = [];
  for (const [name, value] of Object.entries({ studioSourceRoot, catalogRoot, manifestPath })) {
    if (!value || !fs.existsSync(value) || (name === "manifestPath" ? !fs.statSync(value).isFile() : !fs.statSync(value).isDirectory())) findings.push({ rule: "missing-input", detail: `Explicit existing ${name} with the correct file/directory kind is required` });
  }
  if (findings.length) return missing(findings);
  const projectionFile = path.join(studioSourceRoot, "generated/studio-map.ts");
  if (!fs.existsSync(projectionFile)) return missing([{ rule: "missing-native-projection", detail: "Actual generated/studio-map.ts is required" }]);
  const context = createStudioModuleCatalog(catalogRoot, { sourceRoots: [...sourceFiles(studioSourceRoot), path.resolve(manifestPath)] });
  const adapted = adaptPublishedStudioActions({ program: context.program, manifestFile: manifestPath, studioSourceRoot });
  if (adapted.status !== "ADAPTED") return { ...missing([{ rule: "native-action-projection", detail: adapted.detail }]), status: adapted.status };
  const report = analyzeStudioPageModules({ ...context, root: path.resolve(catalogRoot), studioSourceRoot: path.resolve(studioSourceRoot), manifestFile: path.resolve(manifestPath), publisherProjectionFile: projectionFile, publisherProjectionExport: "studioPageActions", pages: adapted.pages, consumers: adapted.consumers });
  const bodies = adaptPublishedStudioBodies({ program: context.program, manifestFile: path.resolve(manifestPath) });
  report.findings.push(...adapted.findings, ...inspectUnboundStudioPageBodies({ ...context, studioSourceRoot: path.resolve(studioSourceRoot), manifestFile: path.resolve(manifestPath), consumers: adapted.consumers }));
  report.status = bodies.status === "MISSING" ? "MISSING" : report.findings.length ? "FINDINGS" : "MEASURED";
  return { schemaVersion: 1, ...report, limits: ["Static source measurement does not qualify installed adoption, responsive layout, or runtime specimen item counts. Dynamic specimen selection remains unproven without registered leaf identity."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const value = flag => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
  const report = checkStudioPageModules({ studioSourceRoot: value("--studio-source-root"), catalogRoot: value("--catalog-root"), manifestPath: value("--manifest") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "MISSING" ? 2 : report.findings.length ? 1 : 0;
}
