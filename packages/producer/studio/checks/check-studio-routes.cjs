#!/usr/bin/env node
'use strict';

/**
 * studio-routes: every Studio route is installed by Publisher. Each page entry of the Studio
 * content map (`publication.studio`) needs its `page.tsx` under `app/`, and each page whose route
 * pack row carries a leaf template needs its dynamic `[slug]/page.tsx`, both written by
 * `clossys publish --install --next` (their first line is Publisher's route marker). No other
 * route file may exist under `app/`; the one named exemption is the internal record-specimen
 * frame route `app/%5F_specimen/page.tsx`, which Studio's own specimen iframes load.
 */
const fs = require('node:fs');
const path = require('node:path');

const STUDIO_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(STUDIO_ROOT, '../../..');
/** The first line of every route file Publisher installs (`NEXT_ROUTE_MARKER` in @clossys/publisher/install). */
const ROUTE_MARKER = '// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.';
/** The one route file under app/ Publisher does not install: the internal specimen frame. */
const EXEMPT_ROUTES = ['app/%5F_specimen/page.tsx'];
/** Files that make a URL servable in the App Router. */
const ROUTE_FILE = /^(?:page|route|default)\.[cm]?[jt]sx?$/;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const folder = segment => (segment.startsWith('_') ? `%5F${segment.slice(1)}` : segment);
const segmentsOf = route => route.split('/').filter(Boolean);
const pageFile = route => ['app', ...segmentsOf(route).map(folder), 'page.tsx'].join('/');
const leafFile = route => ['app', ...segmentsOf(route).map(folder), '[slug]', 'page.tsx'].join('/');

function routeFiles(directory, root) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...routeFiles(file, root));
    else if (ROUTE_FILE.test(entry.name)) files.push(path.relative(root, file).split(path.sep).join('/'));
  }
  return files.sort();
}
const installed = file => { try { return fs.readFileSync(file, 'utf8').split('\n', 1)[0] === ROUTE_MARKER; } catch { return false; } };

function checkStudioRoutes({ studioRoot = STUDIO_ROOT, repositoryRoot = REPOSITORY_ROOT } = {}) {
  const findings = [];
  const publisher = path.join(repositoryRoot, 'clossys/agents/publisher');
  const map = readJson(path.join(publisher, 'content-map/studio.json'));
  const pack = readJson(path.join(publisher, 'route-pack/studio.json'));
  const expected = new Map();
  for (const entry of map.entries.filter(row => row.kind === 'page')) expected.set(pageFile(entry.path), { page: entry.id, kind: 'page' });
  for (const route of pack.routes.filter(row => row.leaf)) expected.set(leafFile(route.path), { page: route.instanceId, kind: 'leaf' });
  for (const [file, row] of expected) {
    const target = path.join(studioRoot, file);
    if (!fs.existsSync(target)) findings.push({ rule: 'map-page-not-installed', page: row.page, kind: row.kind, file });
    else if (!installed(target)) findings.push({ rule: 'map-page-not-installed-by-publisher', page: row.page, kind: row.kind, file });
  }
  for (const file of routeFiles(path.join(studioRoot, 'app'), studioRoot)) {
    if (EXEMPT_ROUTES.includes(file) || (expected.has(file) && installed(path.join(studioRoot, file)))) continue;
    if (!expected.has(file)) findings.push({ rule: installed(path.join(studioRoot, file)) ? 'stale-installed-route' : 'route-not-installed', file });
  }
  for (const file of EXEMPT_ROUTES) if (!fs.existsSync(path.join(studioRoot, file))) findings.push({ rule: 'missing-exempt-route', file });
  return findings;
}

module.exports = { checkStudioRoutes, ROUTE_MARKER, EXEMPT_ROUTES };
if (require.main === module) {
  const findings = checkStudioRoutes();
  if (findings.length) {
    console.error(JSON.stringify({ check: 'Studio routes', findings }, null, 2));
    process.exitCode = 1;
  } else console.log('Studio routes: every content-map page and leaf template is installed by Publisher; app/ holds no other route but the specimen frame.');
}
