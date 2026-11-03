#!/usr/bin/env node
'use strict';

/**
 * no-page-jsx: Studio has one generic renderer and no page JSX. Every page is a Publisher
 * assembly (frame + ordered sections + bindings) that `components/StudioPage.tsx` renders from
 * the Studio map. The App Router tree holds the root layout, the route files Publisher installs
 * (`clossys publish --install --next`, which mount `components/StudioInstalledPage.tsx` and so the
 * renderer) and the internal specimen frame route; `check-studio-routes.cjs` owns which routes
 * exist. Those files render only the document shell, the providers and the renderer.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const STUDIO_ROOT = path.resolve(__dirname, '..');
/** The App Router files Publisher does not install: the root layout, the stylesheet and the specimen frame. */
const APP_FILES = ['app/%5F_specimen/page.tsx', 'app/globals.css', 'app/layout.tsx'];
/** The specimen frame renders one record specimen, not a page; it is the named exemption from page-jsx. */
const SPECIMEN_FRAME = 'app/%5F_specimen/page.tsx';
/** The first line of every route file Publisher installs. */
const { ROUTE_MARKER } = require('./check-studio-routes.cjs');
/** JSX the App Router files may render: the HTML document shell, the providers and the one renderer. */
const ALLOWED_TAGS = new Set(['html', 'head', 'body', 'script', 'link', 'StudioProviders', 'StudioPage']);
/** Imports that would put page composition back in app/: sections, frames, old views and route lists. */
const FORBIDDEN_IMPORT = /(?:^|\/)(?:views|sections|frames)(?:\/|$)|(?:^|\/)(?:CellsWorkspace|AgentDetails|StandaloneCellContent|StudioFrame|proof-routes|view-bindings|assembly-bindings)(?:\.[jt]sx?)?$/;
/** The generic renderer, and the assembly module every installed route mounts (which hands it the page). */
const RENDERER = 'components/StudioPage.tsx';
const ASSEMBLY = 'components/StudioInstalledPage.tsx';

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
  const source = file => fs.readFileSync(path.join(studioRoot, file), 'utf8');
  const installed = files.filter(file => /\.[jt]sx?$/.test(file) && source(file).split('\n', 1)[0] === ROUTE_MARKER);
  for (const file of files) if (!APP_FILES.includes(file) && !installed.includes(file)) findings.push({ rule: 'extra-app-route-file', file });
  for (const file of APP_FILES) if (!files.includes(file)) findings.push({ rule: 'missing-app-file', file });
  for (const file of files.filter(name => /\.[jt]sx?$/.test(name) && name !== SPECIMEN_FRAME)) findings.push(...inspectAppSource(source(file), file));
  const assembly = path.relative(studioRoot, path.join(studioRoot, ASSEMBLY)).replace(/\.tsx$/, '');
  for (const file of installed) {
    const specifier = path.relative(path.dirname(path.join(studioRoot, file)), path.join(studioRoot, assembly)).split(path.sep).join('/');
    if (!source(file).includes(`from "${specifier}"`)) findings.push({ rule: 'installed-route-not-generic-renderer', file });
  }
  if (!fs.existsSync(path.join(studioRoot, RENDERER))) findings.push({ rule: 'missing-generic-renderer', file: RENDERER });
  if (!fs.existsSync(path.join(studioRoot, ASSEMBLY)) || !/from ['"]\.\/StudioPage['"]/.test(fs.readFileSync(path.join(studioRoot, ASSEMBLY), 'utf8'))) findings.push({ rule: 'assembly-not-generic-renderer', file: ASSEMBLY });
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
  } else console.log('Studio no-page-jsx: app/ holds the root layout, the specimen frame and Publisher-installed routes; every page renders through components/StudioPage.tsx.');
}
