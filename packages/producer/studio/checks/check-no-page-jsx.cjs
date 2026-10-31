#!/usr/bin/env node
'use strict';

/**
 * no-page-jsx: Studio has one generic renderer and no page JSX. Every page is a Publisher
 * assembly (frame + ordered sections + bindings) that `components/StudioPage.tsx` renders from
 * the Studio map, so the App Router tree holds exactly the root layout and one catch-all page,
 * and those files render only the document shell, the providers and the renderer.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const STUDIO_ROOT = path.resolve(__dirname, '..');
/** The only App Router files: the root layout and the generic catch-all page (plus the stylesheet). */
const APP_FILES = ['app/[[...route]]/page.tsx', 'app/globals.css', 'app/layout.tsx'];
/** JSX the App Router files may render: the HTML document shell, the providers and the one renderer. */
const ALLOWED_TAGS = new Set(['html', 'head', 'body', 'script', 'link', 'StudioProviders', 'StudioPage']);
/** Imports that would put page composition back in app/: sections, frames, old views and route lists. */
const FORBIDDEN_IMPORT = /(?:^|\/)(?:views|sections|frames)(?:\/|$)|(?:^|\/)(?:CellsWorkspace|AgentDetails|StandaloneCellContent|StudioFrame|proof-routes|view-bindings|assembly-bindings)(?:\.[jt]sx?)?$/;
/** The only module the catch-all page may hand a route to. */
const RENDERER = 'components/StudioPage.tsx';

function walk(directory, root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, root));
    else files.push(path.relative(root, file).split(path.sep).join('/'));
  }
  return files;
}

/** JSX tags and import specifiers in one App Router source file. */
function inspectAppSource(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  const at = node => { const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree)); return { file, line: line + 1, column: character + 1 }; };
  (function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      if (!ALLOWED_TAGS.has(tag)) findings.push({ rule: 'page-jsx', tag, ...at(node) });
    }
    if (ts.isJsxFragment(node)) findings.push({ rule: 'page-jsx', tag: 'Fragment', ...at(node) });
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : undefined;
    if (specifier && FORBIDDEN_IMPORT.test(specifier)) findings.push({ rule: 'page-composition-import', specifier, ...at(node) });
    ts.forEachChild(node, visit);
  })(tree);
  return findings;
}

function checkNoPageJsx({ studioRoot = STUDIO_ROOT } = {}) {
  const findings = [];
  const app = path.join(studioRoot, 'app');
  const files = fs.existsSync(app) ? walk(app, studioRoot).sort() : [];
  for (const file of files) if (!APP_FILES.includes(file)) findings.push({ rule: 'extra-app-route-file', file });
  for (const file of APP_FILES) if (!files.includes(file)) findings.push({ rule: 'missing-app-file', file });
  for (const file of files.filter(name => /\.[jt]sx?$/.test(name))) findings.push(...inspectAppSource(fs.readFileSync(path.join(studioRoot, file), 'utf8'), file));
  const page = path.join(studioRoot, 'app/[[...route]]/page.tsx');
  if (fs.existsSync(page)) {
    const source = fs.readFileSync(page, 'utf8');
    if (!/from ['"]\.\.\/\.\.\/components\/StudioPage['"]/.test(source)) findings.push({ rule: 'catch-all-not-generic-renderer', file: 'app/[[...route]]/page.tsx' });
  }
  if (!fs.existsSync(path.join(studioRoot, RENDERER))) findings.push({ rule: 'missing-generic-renderer', file: RENDERER });
  // The replaced page views are gone, not parked beside the renderer.
  if (fs.existsSync(path.join(studioRoot, 'views'))) findings.push({ rule: 'page-views-folder', file: 'views/' });
  return findings;
}

module.exports = { checkNoPageJsx, inspectAppSource, APP_FILES, ALLOWED_TAGS };
if (require.main === module) {
  const findings = checkNoPageJsx();
  if (findings.length) {
    console.error(JSON.stringify({ check: 'Studio no-page-jsx', findings }, null, 2));
    process.exitCode = 1;
  } else console.log('Studio no-page-jsx: app/ holds the root layout and one generic page; every page renders through components/StudioPage.tsx.');
}
