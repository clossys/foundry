#!/usr/bin/env node
/** Retain canonical specimen bodies and their genuine declaration closure as portable source.
 * This is source assembly only: all native import, consumption and compiler guards still run.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSurfaceSourceScanner } from './lib/surface-source-scan.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profilePath = process.argv[2];
if (!profilePath) throw new Error('Usage: materialize-specimen-sources.mjs <captured-public-profile.json>');
const captured = JSON.parse(readFileSync(profilePath, 'utf8'));
const profile = captured.profile ?? captured;
const selected = profile.components.components;
const hash = text => createHash('sha256').update(text).digest('hex');
const printer = ts.createPrinter({ removeComments: true });
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const print = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source);
const configPath = join(root, 'packages/designer/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options;
const entries = { '@clossys/designer/blocks': 'blocks/index.ts', '@clossys/designer/studio': 'studio/index.ts', '@clossys/designer/components': 'components/index.ts', '@clossys/designer/catalog': 'catalog-core/index.ts' };
const sourceRoot = join(root, 'packages/designer/src');
const baseProgram = ts.createProgram(Object.values(entries).map(path => join(sourceRoot, path)), options);
const baseChecker = baseProgram.getTypeChecker();
const unalias = (checker, value) => { if (!(value?.flags & ts.SymbolFlags.Alias)) return value; const target = checker.getAliasedSymbol(value); return target.declarations?.length ? target : value; };
const importer = baseProgram.getSourceFile(join(sourceRoot, 'importers/specimen-sections.ts'));
const registry = importer.statements.filter(ts.isVariableStatement).flatMap(row => [...row.declarationList.declarations]).find(row => row.name.getText(importer) === 'SPECIMEN_SECTION_EXPORTS');
const literal = node => {
  if (ts.isAsExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(row => [row.name.getText(importer).replaceAll('"', ''), literal(row.initializer)]));
  throw new Error('Canonical registration is no longer literal data');
};
const rows = literal(registry.initializer);
const tokenPath = 'packages/designer/src/studio/specimen-token-assets.tsx';
const layoutPath = 'packages/designer/src/studio/specimen-layouts.tsx';
const contentPath = 'packages/designer/src/studio/specimen-content.tsx';
const viewportPath = 'packages/designer/src/studio/specimen-viewports.tsx';
const projections = new Map(), overrides = new Map(), receipts = [];
const sourceName = file => relative(root, file.fileName).split('\\').join('/');
const importedFacade = baseProgram.getSourceFile(join(sourceRoot, 'runtime/component-leaf.tsx')).statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'componentLeaf');
const facadeSymbol = baseChecker.getSymbolAtLocation(importedFacade.name);
const publicValues = new Map();
for (const [module, path] of Object.entries(entries)) {
  if (module !== '@clossys/designer/catalog') continue;
  const source = baseProgram.getSourceFile(join(sourceRoot, path));
  for (const exported of baseChecker.getExportsOfModule(baseChecker.getSymbolAtLocation(source))) {
    const symbol = unalias(baseChecker, exported);
    if (symbol?.flags & ts.SymbolFlags.Value) publicValues.set(symbol, { module, name: exported.name });
  }
}
const dataset = baseProgram.getSourceFile(join(sourceRoot, 'studio/specimen-dataset.ts'));
const tokenData = dataset.statements.filter(ts.isVariableStatement).flatMap(row => [...row.declarationList.declarations]).find(row => row.name.getText(dataset) === 'tokens');
const tokenObject = ts.isAsExpression(tokenData.initializer) ? tokenData.initializer.expression : tokenData.initializer;
const sampleText = tokenObject.properties.find(row => row.name.getText(dataset) === 'sampleText').initializer;
if (!ts.isStringLiteral(sampleText)) throw new Error('Canonical sampleText is no longer a literal');
const sampleSymbol = unalias(baseChecker, baseChecker.getSymbolAtLocation(baseProgram.getSourceFile(join(sourceRoot, 'studio/specimen-token-assets.tsx')).statements.filter(ts.isImportDeclaration).find(row => row.moduleSpecifier.text === './specimen-dataset.js').importClause.namedBindings.elements[0].name));
for (const source of baseProgram.getSourceFiles().filter(file => file.fileName.startsWith(sourceRoot + '/'))) {
  const path = sourceName(source), bindings = new Map(), sourceBindings = new Map();
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
    const call = declaration.initializer;
    if (unalias(baseChecker, baseChecker.getSymbolAtLocation(call.expression)) === facadeSymbol) {
      const [slotNode, partNode] = call.arguments;
      if (!slotNode || !ts.isStringLiteral(slotNode) || partNode && !ts.isStringLiteral(partNode)) throw new Error('Unknown canonical facade call');
      const slot = slotNode.text, chosen = selected[slot], name = slot.slice(11).split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('');
      if (!chosen) continue;
      let exported = name, selector;
      if (partNode) {
        const secondary = chosen.descriptor.secondaryExports?.find(row => row.name === partNode.text);
        if (secondary) exported = secondary.name;
        else {
          const member = Object.entries(chosen.propMap).find(([, pointer]) => pointer.endsWith('#' + chosen.impl.export + '.' + partNode.text));
          if (!member || member[0].split('.').length !== 2) continue;
          selector = member[0].split('.');
        }
      }
      bindings.set(declaration.name.text, { slot, name: exported, local: declaration.name.text, selector });
      receipts.push({ source: path, declaration: declaration.name.text, sha256: hash(declaration.getText(source)), slot, name: exported, ...(selector ? { selector } : {}) });
    }
    if (ts.isIdentifier(call.expression) && call.expression.text === 'specimenComponent' && call.arguments[1] && ts.isStringLiteral(call.arguments[1])) {
      const target = selected[call.arguments[1].text];
      if (target) sourceBindings.set(declaration.name.text, target.origin.kind === 'adopted' ? target.origin.source : target.descriptor.source);
    }
  }
  const collectSources = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'specimenComponent' && node.initializer.arguments[1] && ts.isStringLiteral(node.initializer.arguments[1])) {
      const target = selected[node.initializer.arguments[1].text];
      if (target) sourceBindings.set(node.name.text, target.origin.kind === 'adopted' ? target.origin.source : target.descriptor.source);
    }
    ts.forEachChild(node, collectSources);
  };
  collectSources(source);
  projections.set(path, bindings);
  const transformed = ts.transform(source, [context => {
    const knownBoolean = node => node.kind === ts.SyntaxKind.TrueKeyword ? true : node.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
    const visit = node => {
      if (path === tokenPath && ts.isPropertyAccessExpression(node) && node.name.text === 'sampleText' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'tokens' && ts.isIdentifier(node.expression.expression) && unalias(baseChecker, baseChecker.getSymbolAtLocation(node.expression.expression)) === sampleSymbol) {
        receipts.push({ source: path, expression: node.getText(source), canonicalData: 'packages/designer/src/studio/specimen-dataset.ts', declarationSha256: hash(tokenData.getText(dataset)) });
        return ts.factory.createStringLiteral(sampleText.text);
      }
      if (ts.isRegularExpressionLiteral(node)) {
        const raw = node.text, boundary = raw.lastIndexOf('/');
        return ts.factory.createNewExpression(ts.factory.createIdentifier('RegExp'), undefined, [ts.factory.createStringLiteral(raw.slice(1, boundary)), ts.factory.createStringLiteral(raw.slice(boundary + 1))]);
      }
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith('.') && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        const projected = [], retained = [];
        for (const item of node.importClause.namedBindings.elements) {
          const target = publicValues.get(unalias(baseChecker, baseChecker.getSymbolAtLocation(item.name)));
          if (target && !node.importClause.isTypeOnly && !item.isTypeOnly) projected.push(ts.factory.createImportDeclaration(undefined, ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports([ts.factory.createImportSpecifier(false, target.name === item.name.text ? undefined : ts.factory.createIdentifier(target.name), item.name)])), ts.factory.createStringLiteral(target.module)));
          else retained.push(item);
        }
        if (projected.length) return [...projected, ...(retained.length ? [ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name, ts.factory.updateNamedImports(node.importClause.namedBindings, retained)), node.moduleSpecifier, node.attributes)] : [])];
      }
      if (path === 'packages/designer/src/components/rich-text/schema.ts' && ts.isObjectLiteralExpression(node)) {
        // Parser-only richTextDocument never constructs editor views. The schema/Markdown
        // rules and all caller values stay intact; only editor view factories are absent.
        const properties = node.properties.filter(property => !['addNodeView', 'addMarkView'].includes(property.name?.getText(source)));
        if (properties.length !== node.properties.length) return ts.visitEachChild(ts.factory.updateObjectLiteralExpression(node, properties), visit, context);
      }
      if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
        const declaration = node.declarationList.declarations[0], binding = bindings.get(declaration.name.getText(source));
        if (binding) return ts.factory.createImportDeclaration(undefined, ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports([ts.factory.createImportSpecifier(false, binding.name === binding.local ? undefined : ts.factory.createIdentifier(binding.name), ts.factory.createIdentifier(binding.local))])), ts.factory.createStringLiteral('@specimen-selected/' + binding.slot));
      }
      if (path === 'packages/designer/src/studio/component-specimens.tsx' && ts.isFunctionDeclaration(node) && node.name?.text === 'componentSpecimenPreview') {
        const returned = node.body.statements.at(-1);
        if (!ts.isReturnStatement(returned) || !ts.isObjectLiteralExpression(returned.expression) || returned.expression.properties.length !== 2 || returned.expression.properties[0].name?.getText(source) !== 'bind' || returned.expression.properties[1].name?.getText(source) !== 'preview') throw new Error('Canonical bind factory shape changed');
        const body = ts.factory.updateBlock(node.body, [...node.body.statements.slice(0, -1), ts.factory.createReturnStatement(ts.factory.createObjectLiteralExpression([returned.expression.properties[0]]))]);
        return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, ts.factory.createTypeReferenceNode('Pick', [ts.factory.createTypeReferenceNode('ComponentSpecimenPreview'), ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral('bind'))]), body);
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind) && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) && node.left.name.text === 'source' && ts.isStringLiteral(node.right) && sourceBindings.has(node.left.expression.text)) {
        const matches = sourceBindings.get(node.left.expression.text) === node.right.text;
        receipts.push({ source: path, selectedBranch: node.getText(source), selectedSource: sourceBindings.get(node.left.expression.text) });
        return matches === (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) ? ts.factory.createTrue() : ts.factory.createFalse();
      }
      node = ts.visitEachChild(node, visit, context);
      if (ts.isBlock(node)) {
        const abrupt = statement => ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBlock(statement) && statement.statements.length > 0 && abrupt(statement.statements.at(-1)) || ts.isIfStatement(statement) && statement.elseStatement && abrupt(statement.thenStatement) && abrupt(statement.elseStatement);
        const retained = [];
        for (const statement of node.statements) { retained.push(statement); if (abrupt(statement)) break; }
        if (retained.length !== node.statements.length) node = ts.factory.updateBlock(node, retained);
      }
      if (ts.isConditionalExpression(node) && knownBoolean(node.condition) !== undefined) return knownBoolean(node.condition) ? node.whenTrue : node.whenFalse;
      if (ts.isIfStatement(node) && knownBoolean(node.expression) !== undefined) return knownBoolean(node.expression) ? node.thenStatement : node.elseStatement ?? ts.factory.createEmptyStatement();
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && knownBoolean(node.left) !== undefined) return knownBoolean(node.left) ? node.right : node.left;
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName)) {
        const binding = bindings.get(node.tagName.text);
        if (binding?.selector) {
          const [axis, value] = binding.selector;
          const attributes = ts.factory.updateJsxAttributes(node.attributes, [...node.attributes.properties, ts.factory.createJsxAttribute(ts.factory.createIdentifier(axis), ts.factory.createStringLiteral(value))]);
          return ts.isJsxSelfClosingElement(node) ? ts.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, attributes) : ts.factory.updateJsxOpeningElement(node, node.tagName, node.typeArguments, attributes);
        }
      }
      return node;
    };
    return node => ts.visitNode(node, visit);
  }]);
  let text = printer.printFile(transformed.transformed[0]); transformed.dispose();
  if (path === contentPath) {
    const ast = parse(path, text);
    const validate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'contentSpecimenNeeds');
    const inventory = ast.statements.filter(ts.isVariableStatement).flatMap(row => [...row.declarationList.declarations]).find(row => row.name.getText(ast) === 'contentSpecimenLeaves').initializer;
    if (!ts.isArrayLiteralExpression(inventory)) throw new Error('Canonical content inventory changed');
    const clones = [];
    for (const registration of rows.slice(11)) {
      const record = inventory.elements.find(node => ts.isObjectLiteralExpression(node) && node.properties.some(property => property.name?.getText(ast) === 'id' && property.initializer?.text === registration.id));
      const layout = record.properties.find(property => property.name?.getText(ast) === 'layout').initializer;
      const concrete = ts.transform(validate, [context => {
        const literal = node => ts.isStringLiteral(node) ? node.text : node.kind === ts.SyntaxKind.TrueKeyword ? true : node.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
        const visit = node => {
          if (ts.isIdentifier(node) && node.text === 'id' && node !== validate.parameters[0].name && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) return ts.factory.createStringLiteral(registration.id);
          if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'definition') return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment('id', ts.factory.createStringLiteral(registration.id)), ts.factory.createPropertyAssignment('layout', layout)]));
          node = ts.visitEachChild(node, visit, context);
          if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind) && literal(node.left) !== undefined && literal(node.right) !== undefined) return (literal(node.left) === literal(node.right)) === (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) ? ts.factory.createTrue() : ts.factory.createFalse();
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && literal(node.left) !== undefined) return literal(node.left) ? node.right : node.left;
          if (ts.isIfStatement(node)) { if (literal(node.expression) !== undefined) return literal(node.expression) ? node.thenStatement : node.elseStatement ?? ts.factory.createEmptyStatement(); if (ts.isIdentifier(node.expression) && node.expression.text === 'definition') return node.thenStatement; }
          return node;
        };
        return node => ts.visitNode(node, visit);
      }]);
      const name = 'validate' + registration.name;
      const clone = ts.factory.updateFunctionDeclaration(concrete.transformed[0], undefined, undefined, name, validate.typeParameters, validate.parameters, validate.type, concrete.transformed[0].body);
      clones.push(print(clone, ast)); concrete.dispose();
      const root = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === registration.name);
      const original = root.getText(ast), replaced = original.replace('contentSpecimenNeeds(id, props)', name + '(id, props)');
      if (original === replaced) throw new Error('Canonical content root validation flow changed');
      text = text.replace(original, replaced);
      receipts.push({ source: path, root: registration.name, validationSha256: hash(validate.getText(ast)), registryRowSha256: hash(record.getText(ast)), knownId: registration.id, layout: layout.text });
    }
    text += '\n' + clones.join('\n');
  }
  if (path === tokenPath) {
    const ast = parse(path, text), definition = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'definition');
    const returned = definition.body.statements.at(-1).expression;
    const render = returned.properties.find(row => row.name?.getText(ast) === 'render').initializer;
    const inventory = ast.statements.filter(ts.isVariableStatement).flatMap(row => [...row.declarationList.declarations]).find(row => row.name.getText(ast) === 'tokenAssetSpecimenLeaves').initializer;
    if (!ts.isArrayLiteralExpression(inventory) || inventory.elements.length !== 8 || !ts.isArrowFunction(render) || !ts.isBlock(render.body)) throw new Error('Canonical token specimen factory shape changed');
    const replacements = new Map(rows.slice(0, 8).map((row, index) => {
      const invocation = inventory.elements[index];
      if (!ts.isCallExpression(invocation) || invocation.expression.getText(ast) !== 'definition' || invocation.arguments.some(arg => !ts.isStringLiteral(arg))) throw new Error('Canonical token factory arguments changed');
      const [mode, , layout] = invocation.arguments;
      const environment = ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
        ts.factory.createVariableDeclaration('mode', undefined, undefined, mode), ts.factory.createVariableDeclaration('id', undefined, undefined, ts.factory.createStringLiteral(row.id)), ts.factory.createVariableDeclaration('layout', undefined, undefined, layout),
      ], ts.NodeFlags.Const));
      const result = ts.factory.createFunctionDeclaration([ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], undefined, row.name, undefined, render.parameters.map(parameter => ts.factory.updateParameterDeclaration(parameter, parameter.modifiers, parameter.dotDotDotToken, parameter.name, parameter.questionToken, ts.factory.createTypeReferenceNode('SpecimenLeafProps'), parameter.initializer)), ts.factory.createTypeReferenceNode('ReactNode'), ts.factory.createBlock([environment, ...render.body.statements], true));
      receipts.push({ source: path, root: row.name, factory: hash(definition.getText(ast)), argumentSha256: hash(invocation.getText(ast)), renderSha256: hash(render.getText(ast)) });
      return [row.name, result];
    }));
    text = ast.statements.map(statement => {
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
        const name = statement.declarationList.declarations[0].name.getText(ast);
        if (replacements.has(name)) return print(replacements.get(name), ast);
      }
      return print(statement, ast);
    }).join('\n');
  }
  overrides.set(path, text);
}
const compilerHost = ts.createCompilerHost(options);
const oldRead = compilerHost.readFile.bind(compilerHost);
compilerHost.readFile = path => overrides.get(relative(root, path).split('\\').join('/')) ?? oldRead(path);
const program = ts.createProgram(Object.values(entries).map(path => join(sourceRoot, path)), options, compilerHost);
const checker = program.getTypeChecker();
const actual = value => unalias(checker, value);
const publicTypes = new Map();
for (const [module, path] of Object.entries(entries)) {
  const source = program.getSourceFile(join(sourceRoot, path));
  for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
    const symbol = actual(exported);
    if (symbol?.flags & ts.SymbolFlags.Type && !publicTypes.has(symbol)) publicTypes.set(symbol, { module, name: exported.name });
  }
}
const scanner = createSurfaceSourceScanner({ read: path => overrides.get(path) ?? (() => { try { return readFileSync(join(root, path), 'utf8'); } catch { return undefined; } })(), packages: { '@canonical/designer': 'packages/designer/src' } });
const declarationNames = node => ts.isVariableStatement(node) ? node.declarationList.declarations.filter(row => ts.isIdentifier(row.name)).map(row => row.name.text) : node.name && ts.isIdentifier(node.name) ? [node.name.text] : [];
const outputs = [];
for (const registration of rows) {
  const sourcePath = rows.indexOf(registration) < 8 ? tokenPath : rows.indexOf(registration) < 11 ? viewportPath : contentPath;
  const closure = scanner.scan({ fill: 'foundry/' + registration.id, packageName: '@canonical/designer', pointer: './' + sourcePath.slice('packages/designer/src/'.length).replace(/\.tsx$/, '') + '#' + registration.name });
  const selectedNodes = new Map(), selectedSymbols = new Map(), externals = new Map(), pending = [];
  const add = (node, source) => {
    const key = source.fileName + ':' + node.pos;
    if (selectedNodes.has(key)) return;
    selectedNodes.set(key, { node, source }); pending.push({ node, source });
    for (const name of declarationNames(node)) {
      const target = ts.isVariableStatement(node) ? node.declarationList.declarations.find(row => row.name.getText(source) === name).name : node.name;
      const symbol = actual(checker.getSymbolAtLocation(target));
      if (symbol) selectedSymbols.set(symbol, { name, source, node });
    }
  };
  for (const file of closure.files) {
    const snippet = parse(file.path, file.content), source = program.getSourceFile(join(root, file.path));
    if (!source) throw new Error('Canonical source unavailable: ' + file.path);
    const wanted = new Set(snippet.statements.flatMap(declarationNames));
    for (const statement of source.statements) if (!ts.isImportDeclaration(statement) && declarationNames(statement).some(name => wanted.has(name))) add(statement, source);
  }
  for (let index = 0; index < pending.length; index++) {
    const { node } = pending[index];
    const walk = current => {
      if (ts.isIdentifier(current)) {
        const reference = ts.isShorthandPropertyAssignment(current.parent) && current.parent.name === current ? checker.getShorthandAssignmentValueSymbol(current.parent) : checker.getSymbolAtLocation(current);
        const symbol = actual(reference);
        if (symbol && !selectedSymbols.has(symbol)) {
          const originalSymbol = reference, declaration = originalSymbol?.declarations?.find(ts.isImportSpecifier);
          const defaultDeclaration = originalSymbol?.declarations?.find(ts.isImportClause);
          const importNode = declaration?.parent.parent.parent ?? defaultDeclaration?.parent;
          if (importNode && ts.isImportDeclaration(importNode) && !importNode.moduleSpecifier.text.startsWith('.')) {
            const module = importNode.moduleSpecifier.text;
            externals.set(symbol, { module, name: declaration ? declaration.propertyName?.text ?? declaration.name.text : 'default', type: importNode.importClause.isTypeOnly || declaration?.isTypeOnly === true });
          } else if (symbol.flags & ts.SymbolFlags.Type) {
            const publicType = publicTypes.get(symbol);
            if (publicType) externals.set(symbol, { ...publicType, type: true });
            else for (const declaration of symbol.declarations ?? []) if ((ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) && declaration.getSourceFile().fileName.startsWith(sourceRoot + '/')) add(declaration, declaration.getSourceFile());
          }
        }
      }
      ts.forEachChild(current, walk);
    };
    walk(node);
  }
  const names = new Map(), used = new Set();
  for (const [symbol, row] of [...selectedSymbols, ...externals].map(([symbol, row]) => [symbol, row])) {
    const stem = row.name === "default" ? "ImportedDefault" : row.name; let name = stem, index = 1;
    while (used.has(name)) name = stem + 'Alias' + index++;
    used.add(name); names.set(symbol, name);
  }
  // The root retains its actual public name even if another declaration shares it.
  const source = program.getSourceFile(join(root, sourcePath));
  const rootNode = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === registration.name);
  if (!rootNode) throw new Error('Concrete canonical specimen root unavailable');
  const rootSymbol = actual(checker.getSymbolAtLocation(rootNode.name)); names.set(rootSymbol, registration.name);
  const bindings = [], imports = [];
  for (const [symbol, row] of externals) {
    let module = row.module;
    if (module.startsWith('@specimen-selected/')) {
      const slot = module.slice('@specimen-selected/'.length);
      module = '../../components/' + slot.slice(11) + '/index.js';
      bindings.push({ module, name: row.name, local: names.get(symbol), slot });
    }
    imports.push(`import ${row.type ? 'type ' : ''}{ ${row.name}${row.name === names.get(symbol) ? '' : ' as ' + names.get(symbol)} } from ${JSON.stringify(module)};`);
  }
  let helperCalls = 0;
  const chunks = [];
  const fileOrder = new Map(), ordering = new Set();
  const selectedFiles = new Set([...selectedNodes.values()].map(row => row.source.fileName));
  const orderFile = file => {
    if (fileOrder.has(file) || ordering.has(file)) return;
    ordering.add(file);
    const source = program.getSourceFile(file);
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
      const named = statement.importClause.namedBindings;
      for (const item of named && ts.isNamedImports(named) ? named.elements : []) {
        if (item.isTypeOnly) continue;
        const symbol = actual(checker.getSymbolAtLocation(item.name));
        for (const declaration of symbol?.declarations ?? []) { const target = declaration.getSourceFile().fileName; if (target !== file && selectedFiles.has(target)) orderFile(target); }
      }
    }
    ordering.delete(file); fileOrder.set(file, fileOrder.size);
  };
  for (const file of selectedFiles) orderFile(file);
  const orderedNodes = [...selectedNodes.values()].sort((left, right) => fileOrder.get(left.source.fileName) - fileOrder.get(right.source.fileName) || left.node.pos - right.node.pos);
  for (const { node, source } of orderedNodes) {
    const result = ts.transform(node, [context => {
      const rename = current => {
        if (ts.isJsxSelfClosingElement(current) && ts.isIdentifier(current.tagName)) {
          const symbol = actual(checker.getSymbolAtLocation(current.tagName)), owned = selectedSymbols.get(symbol);
          if (owned && ts.isFunctionDeclaration(owned.node)) {
            const properties = current.attributes.properties.map(attribute => ts.isJsxSpreadAttribute(attribute) ? ts.factory.createSpreadAssignment(ts.visitNode(attribute.expression, rename)) : ts.factory.createPropertyAssignment(attribute.name.getText(source), !attribute.initializer ? ts.factory.createTrue() : ts.isStringLiteral(attribute.initializer) ? attribute.initializer : ts.visitNode(attribute.initializer.expression, rename)));
            helperCalls++;
            return ts.factory.createCallExpression(ts.factory.createIdentifier('renderOwnedSpecimenHelper'), undefined, [ts.factory.createIdentifier(names.get(symbol)), ts.factory.createObjectLiteralExpression(properties, true)]);
          }
        }
        if (ts.isIdentifier(current)) {
          const name = names.get(actual(checker.getSymbolAtLocation(current)));
          if (name && name !== current.text) {
            if (ts.isShorthandPropertyAssignment(current.parent) && current.parent.name === current) return current;
            return ts.factory.createIdentifier(name);
          }
        }
        if (ts.isShorthandPropertyAssignment(current)) {
          const symbol = actual(checker.getShorthandAssignmentValueSymbol(current)), name = names.get(symbol);
          if (name && name !== current.name.text) return ts.factory.createPropertyAssignment(current.name.text, ts.factory.createIdentifier(name));
        }
        return ts.visitEachChild(current, rename, context);
      };
      return current => ts.visitNode(current, rename);
    }]);
    let transformed = result.transformed[0];
    const exported = ts.isFunctionDeclaration(transformed) && node === rootNode;
    const modifiers = transformed.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword && modifier.kind !== ts.SyntaxKind.DefaultKeyword) ?? [];
    if (exported) modifiers.unshift(ts.factory.createModifier(ts.SyntaxKind.ExportKeyword));
    if (ts.isFunctionDeclaration(transformed)) transformed = ts.factory.updateFunctionDeclaration(transformed, modifiers, transformed.asteriskToken, transformed.name, transformed.typeParameters, transformed.parameters, transformed.type, transformed.body);
    else if (ts.isVariableStatement(transformed)) transformed = ts.factory.updateVariableStatement(transformed, modifiers, transformed.declarationList);
    else if (ts.isInterfaceDeclaration(transformed)) transformed = ts.factory.updateInterfaceDeclaration(transformed, modifiers, transformed.name, transformed.typeParameters, transformed.heritageClauses, transformed.members);
    else if (ts.isTypeAliasDeclaration(transformed)) transformed = ts.factory.updateTypeAliasDeclaration(transformed, modifiers, transformed.name, transformed.typeParameters, transformed.type);
    if (ts.isFunctionDeclaration(transformed) && transformed.type) {
      let objectReturn = false;
      const detect = type => { if (ts.isTypeLiteralNode(type)) objectReturn = true; ts.forEachChild(type, detect); };
      detect(transformed.type);
      if (objectReturn) {
        const resultName = transformed.name.text + 'Result';
        chunks.push(print(ts.factory.createTypeAliasDeclaration(undefined, resultName, undefined, transformed.type), source));
        transformed = ts.factory.updateFunctionDeclaration(transformed, transformed.modifiers, transformed.asteriskToken, transformed.name, transformed.typeParameters, transformed.parameters, ts.factory.createTypeReferenceNode(resultName), transformed.body);
      }
    }
    chunks.push(print(transformed, source)); result.dispose();
  }
  if (helperCalls) imports.push('import { createElement as renderOwnedSpecimenHelper } from "react";');
  const path = registration.id.replace('.', '/') + '/' + registration.name + '.tsx';
  const code = ['"use client";', ...imports, ...chunks,
    'import { studioSpecimenLeaves as nativeSpecimenDefinitions, type SpecimenLeafDefinition as NativeSpecimenDefinition } from "@clossys/designer/studio";',
    `export function SpecimenLeaf(): NativeSpecimenDefinition { const definition = nativeSpecimenDefinitions.find(leaf => leaf.id === ${JSON.stringify(registration.id)}); if (!definition) throw new Error("The native specimen definition is not registered."); return { ...definition, render: ${registration.name} }; }`, ''].join('\n');
  outputs.push({ id: registration.id, files: [{ path, content: code }], bindings: bindings.map(row => ({ file: path, ...row })), canonical: closure.files.map(file => ({ path: file.path, sha256: hash(readFileSync(join(root, file.path), 'utf8')) })), helperCalls, unresolved: closure.unresolved });
}
const output = join(sourceRoot, 'importers/specimen-source.data.json');
const artifact = { version: 1, assembly: 'canonical-declaration-closure', selectedComponents: Object.entries(selected).filter(([slot]) => receipts.some(row => row.slot === slot)).map(([slot, row]) => ({ slot, impl: row.impl, origin: row.origin, members: row.descriptor.members, secondaryExports: row.descriptor.secondaryExports ?? [] })), receipts, specimens: outputs };
const text = JSON.stringify(artifact, null, 2) + '\n';
if (process.argv.includes('--check')) { if (readFileSync(output, 'utf8') !== text) throw new Error('Canonical specimen source artifact is stale'); }
else writeFileSync(output, text);
console.log(JSON.stringify({ sourceBodies: outputs.length, files: outputs.reduce((sum, row) => sum + row.files.length, 0), helperCalls: outputs.reduce((sum, row) => sum + row.helperCalls, 0), bytes: text.length, sha256: hash(text) }));
