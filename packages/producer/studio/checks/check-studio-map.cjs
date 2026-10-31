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

/** `<link href>` on the intrinsic HTML element loads a resource (a stylesheet); it is not a page link. */
function resourceLink(node) {
  const attribute = node.parent && ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
  if (!attribute || !ts.isJsxAttribute(attribute) || propertyName(attribute.name) !== 'href') return false;
  const element = attribute.parent?.parent;
  return Boolean(element && (ts.isJsxSelfClosingElement(element) || ts.isJsxOpeningElement(element)) && element.tagName.getText() === 'link');
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
      // Producer's own endpoints: data under /api, and the reserved /__ resources (the specimen frame).
      const dataEndpoint = /^\/(?:api|__[a-z-]+)(?:\/|$|\?)/.test(value);
      const asset = assetContext(node) && /\.[a-z\d]+(?:[?#]|$)/i.test(value);
      const stateOnly = /^[?#]/.test(value);
      if (!stateOnly && !resourceLink(node) && !delimiterUse(node, value) && !originShapeCheck(node, value) && (destination && value.length > 0 || rootPath && !dataEndpoint && !asset)) {
        const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        findings.push({ rule: 'route-literal-outside-projection', file, line: line + 1, column: character + 1, value });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

/** The files that own Studio's route strings: Publisher's generated map and the one runtime map module that adds leaves to it. */
const MAP_OWNERS = ['generated/studio-map.ts', 'lib/studio-route-map.ts'];
const FRAME_INPUTS = ['homeHref', 'navigation', 'commands', 'breadcrumbs'];

/**
 * The generic renderer feeds the pinned frame. The frame element (a component read from the
 * generated `studioFrames`) must take its map inputs only by spreading `studioShellProjection(...)`,
 * never as hand-written attributes or literal node lists.
 */
function inspectFrameProjection(source, file = 'components/StudioPage.tsx') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Map();
  const shells = new Set();
  const elements = [];
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
      if (/\bstudioFrames\b/.test(node.initializer.getText(tree))) shells.add(node.name.text);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, collect);
  }
  collect(tree);
  const frames = elements.filter(node => shells.has(node.tagName.getText(tree)));
  function projects(node, seen = new Set()) {
    let found = false;
    function visit(child) {
      if (ts.isCallExpression(child) && child.expression.getText(tree) === 'studioShellProjection') found = true;
      if (ts.isIdentifier(child) && bindings.has(child.text) && !seen.has(child.text) && projects(bindings.get(child.text), new Set(seen).add(child.text))) found = true;
      ts.forEachChild(child, visit);
    }
    visit(node);
    return found;
  }
  function handAuthored(node, seen = new Set()) {
    let found = false;
    function visit(child) {
      if (ts.isObjectLiteralExpression(child)) {
        const properties = child.properties.filter(ts.isPropertyAssignment);
        const literal = name => properties.some(property => propertyName(property.name) === name && ts.isStringLiteralLike(property.initializer));
        if (literal('id') && literal('label')) found = true;
      }
      if (ts.isIdentifier(child) && bindings.has(child.text) && !seen.has(child.text) && handAuthored(bindings.get(child.text), new Set(seen).add(child.text))) found = true;
      ts.forEachChild(child, visit);
    }
    visit(node);
    return found;
  }
  const findings = [];
  if (!frames.length) findings.push({ rule: 'missing-studio-frame', file });
  for (const frame of frames) {
    const attributes = frame.attributes.properties;
    const spreads = attributes.filter(ts.isJsxSpreadAttribute);
    if (!spreads.some(spread => projects(spread.expression))) findings.push({ rule: 'frame-input-outside-projection', file, required: 'studioShellProjection' });
    for (const spread of spreads) if (handAuthored(spread.expression)) findings.push({ rule: 'hand-authored-frame-map-node', file });
    for (const attribute of attributes.filter(ts.isJsxAttribute)) {
      const name = propertyName(attribute.name);
      if (FRAME_INPUTS.includes(name)) findings.push({ rule: 'frame-input-outside-projection', file, input: name });
    }
  }
  return findings;
}

/** The projection itself must be Publisher's: navigation, commands and breadcrumbs come from the content-map projections. */
function inspectShellProjection(source, file = 'lib/studio-route-map.ts') {
  const findings = [];
  for (const projector of ['projectNavigation', 'projectCommands', 'projectBreadcrumbs']) {
    if (!new RegExp(`\\b${projector}\\(`).test(source)) findings.push({ rule: 'shell-projection-not-publisher', file, projector });
  }
  return findings;
}

/** Resolve a relative import to a Studio source file. */
function resolveImport(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.[cm]?[jt]sx?$/.test(candidate)) return candidate;
  }
  return undefined;
}

/** Every Studio source file the App Router entries reach through relative imports: the code that actually runs. */
function productionFiles(root) {
  const app = path.join(root, 'app');
  const entries = [];
  (function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) entries.push(file);
    }
  })(app);
  const reached = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    tree.forEachChild(function visit(node) {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (specifier?.startsWith('.')) {
        const target = resolveImport(file, specifier);
        if (target && target.startsWith(root + path.sep)) queue.push(target);
      }
    });
  }
  return [...reached].filter(file => !MAP_OWNERS.includes(path.relative(root, file).split(path.sep).join('/'))).sort();
}

async function checkStudioMap({ studioRoot = STUDIO_ROOT, clossysRoot, outputDir } = {}) {
  const findings = [];
  const generator = path.resolve(STUDIO_ROOT, '../scripts/generate-studio-map.mjs');
  try {
    const { generateStudioMap } = await import(pathToFileURL(generator).href);
    await generateStudioMap({ ...(clossysRoot ? { clossysRoot } : {}), outputDir: outputDir ?? path.join(studioRoot, 'generated'), check: true });
  } catch (error) {
    findings.push({ rule: 'publisher-projection-drift', message: error.message });
  }
  for (const file of productionFiles(studioRoot)) findings.push(...findRouteLiterals(fs.readFileSync(file, 'utf8'), path.relative(studioRoot, file)));
  const renderer = path.join(studioRoot, 'components/StudioPage.tsx');
  if (fs.existsSync(renderer)) findings.push(...inspectFrameProjection(fs.readFileSync(renderer, 'utf8')));
  else findings.push({ rule: 'missing-studio-renderer' });
  const routeMap = path.join(studioRoot, 'lib/studio-route-map.ts');
  if (fs.existsSync(routeMap)) findings.push(...inspectShellProjection(fs.readFileSync(routeMap, 'utf8')));
  else findings.push({ rule: 'missing-studio-route-map' });
  return findings;
}

module.exports = { findRouteLiterals, inspectFrameProjection, inspectShellProjection, productionFiles, checkStudioMap };
if (require.main === module) checkStudioMap().then(findings => {
  if (findings.length) {
    console.error(JSON.stringify({ check: 'Studio Publisher map', findings }, null, 2));
    process.exitCode = 1;
  } else console.log('Studio Publisher map: generated projection matches Publisher cells; the running code builds no route strings outside the map, and the frame reads only the map projection.');
}).catch(error => { console.error(error); process.exitCode = 1; });
