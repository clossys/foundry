#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const STUDIO_ROOT = path.resolve(__dirname, '..');

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

function navigationContext(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) && /^(?:href|to|selectedRoute|activeHref|destination)$/.test(propertyName(parent.name) ?? '')) return true;
    if (ts.isCallExpression(parent)) {
      const name = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : parent.expression.getText();
      const receiver = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.expression.getText() : '';
      if (/^(?:navigate|redirect)$/.test(name) || /^(?:push|replace|assign)$/.test(name) && /(?:^|\.)(?:router|navigation|history|location)$/.test(receiver)) return true;
    }
    if (ts.isStatement(parent)) break;
  }
  return false;
}

function delimiterUse(node, value) {
  const parent = node.parent;
  return value === '/' && ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
    && /^(?:startsWith|endsWith|split|join)$/.test(parent.expression.name.text);
}

function assetContext(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) && /^(?:src|markSrc|poster|srcSet)$/.test(propertyName(parent.name) ?? '')) return true;
    if (ts.isStatement(parent)) break;
  }
  return false;
}

/** Parse executable source: prose, comments, regexes, imports and query-only state are not routes. */
function findRouteLiterals(source, file = 'StudioFrame.tsx') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  const parsedUrls = new Set();
  function collectUrls(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNewExpression(node.initializer) && node.initializer.expression.getText(tree) === 'URL') parsedUrls.add(node.name.text);
    ts.forEachChild(node, collectUrls);
  }
  collectUrls(tree);
  function originShapeCheck(node, value) {
    if (value !== '/' || !ts.isBinaryExpression(node.parent)) return false;
    const other = node.parent.left === node ? node.parent.right : node.parent.left;
    return ts.isPropertyAccessExpression(other) && other.name.text === 'pathname' && ts.isIdentifier(other.expression) && parsedUrls.has(other.expression.text);
  }
  function visit(node) {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    const value = literal ? node.text : ts.isTemplateExpression(node) ? node.head.text : undefined;
    if (value !== undefined && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
      const destination = navigationContext(node);
      const rootPath = /^\/(?!\/)/.test(value);
      const dataEndpoint = /^\/api(?:\/|$|\?)/.test(value);
      const asset = assetContext(node) && /\.[a-z\d]+(?:[?#]|$)/i.test(value);
      const stateOnly = /^[?#]/.test(value);
      if (!stateOnly && !delimiterUse(node, value) && !originShapeCheck(node, value) && (destination && value.length > 0 || rootPath && !dataEndpoint && !asset)) {
        const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        findings.push({ rule: 'route-literal-outside-projection', file, line: line + 1, column: character + 1, value });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

/** Follow local AST bindings from AppFrame's two inputs to the generated exports. */
function inspectFrameProjection(source, file = 'components/StudioFrame.tsx', studioRoot = STUDIO_ROOT) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Map();
  const generated = new Map();
  const frames = [];
  function collect(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && path.resolve(studioRoot, path.dirname(file), node.moduleSpecifier.text.replace(/\.[cm]?[jt]s$/, '')) === path.join(studioRoot, 'generated/studio-map')) {
      const imports = node.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports)) for (const item of imports.elements) generated.set(item.name.text, (item.propertyName ?? item.name).text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
    if (ts.isFunctionDeclaration(node) && node.name && node.body) bindings.set(node.name.text, node.body);
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'AppFrame') frames.push(node);
    ts.forEachChild(node, collect);
  }
  collect(tree);
  function exportsUsed(node, seen = new Set()) {
    const result = new Set();
    function visit(child) {
      if (ts.isIdentifier(child)) {
        if (generated.has(child.text)) result.add(generated.get(child.text));
        else if (bindings.has(child.text) && !seen.has(child.text)) {
          const next = new Set(seen).add(child.text);
          for (const name of exportsUsed(bindings.get(child.text), next)) result.add(name);
        }
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return result;
  }
  function containsHandAuthoredNodes(node, seen = new Set()) {
    let found = false;
    function visit(child) {
      if (ts.isObjectLiteralExpression(child)) {
        const properties = child.properties.filter(ts.isPropertyAssignment);
        const literal = name => properties.some(property => propertyName(property.name) === name && ts.isStringLiteralLike(property.initializer));
        if (literal('id') && literal('label')) found = true;
      }
      if (ts.isIdentifier(child) && bindings.has(child.text) && !generated.has(child.text) && !seen.has(child.text)) {
        if (containsHandAuthoredNodes(bindings.get(child.text), new Set(seen).add(child.text))) found = true;
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return found;
  }
  const findings = [];
  if (!frames.length) findings.push({ rule: 'missing-app-frame', file });
  for (const frame of frames) for (const [attribute, required] of [['navigation', 'studioNavigation'], ['commands', 'studioCommands']]) {
    const attr = frame.attributes.properties.find(node => ts.isJsxAttribute(node) && propertyName(node.name) === attribute);
    if (!attr || !exportsUsed(attr).has(required)) findings.push({ rule: 'frame-input-outside-projection', file, input: attribute, required });
    if (attr && containsHandAuthoredNodes(attr)) findings.push({ rule: 'hand-authored-frame-map-node', file, input: attribute });
  }
  return findings;
}

function productionFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const rootFixtureDirectory = directory === root && ['checks', 'public'].includes(entry.name);
        if (!rootFixtureDirectory && !['node_modules', '.next', '.git'].includes(entry.name)) visit(path.join(directory, entry.name));
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const file = path.join(directory, entry.name);
        // Only Publisher's two exact executable projection files can own route literals.
        if (!['generated/studio-map.ts', 'generated/view-bindings.ts'].includes(path.relative(root, file).split(path.sep).join('/'))) files.push(file);
      }
    }
  }
  visit(root);
  return files;
}

async function checkStudioMap({ studioRoot = STUDIO_ROOT, cellRoot, outputDir } = {}) {
  const findings = [];
  const generator = path.resolve(STUDIO_ROOT, '../scripts/generate-studio-map.mjs');
  try {
    const { generateStudioMap } = await import(pathToFileURL(generator).href);
    await generateStudioMap({ ...(cellRoot ? { cellRoot } : {}), outputDir: outputDir ?? path.join(studioRoot, 'generated'), check: true });
  } catch (error) {
    findings.push({ rule: 'publisher-projection-drift', message: error.message });
  }
  for (const file of productionFiles(studioRoot)) findings.push(...findRouteLiterals(fs.readFileSync(file, 'utf8'), path.relative(studioRoot, file)));
  const frame = path.join(studioRoot, 'components/StudioFrame.tsx');
  if (fs.existsSync(frame)) findings.push(...inspectFrameProjection(fs.readFileSync(frame, 'utf8'), 'components/StudioFrame.tsx', studioRoot));
  else findings.push({ rule: 'missing-studio-frame' });
  return findings;
}

module.exports = { findRouteLiterals, inspectFrameProjection, productionFiles, checkStudioMap };
if (require.main === module) checkStudioMap().then(findings => {
  if (findings.length) {
    console.error(JSON.stringify({ check: 'Studio Publisher map', findings }, null, 2));
    process.exitCode = 1;
  } else console.log('Studio Publisher map: generated projection matches Publisher cells; production routing, navigation and commands use the projection.');
}).catch(error => { console.error(error); process.exitCode = 1; });
