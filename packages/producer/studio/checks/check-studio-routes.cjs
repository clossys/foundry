#!/usr/bin/env node
'use strict';

/**
 * studio-routes: every Studio route is installed by Publisher. Each page entry of the Studio
 * content map (projected from the pinned `publication.studio` slot) needs its `page.tsx` under `app/`, and each page whose route
 * pack row carries a leaf template needs its dynamic `[slug]/page.tsx`, both written by
 * `clossys publish --install --next` (their first line is Publisher's route marker). The map and
 * route pack are read after content-map expansion: each parameterized `page.<agent>-<ns>` record
 * becomes its top page plus one nested tab page per IA group, each tab with a `[slug]` leaf route.
 * No other route file may exist under `app/`: the record-specimen frame is `/__specimen`, served by
 * the Producer server, not a Next page.
 */
const fs = require('node:fs');
const path = require('node:path');

const STUDIO_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(STUDIO_ROOT, '../../..');
/** The first line of every route file Publisher installs (`NEXT_ROUTE_MARKER` in @clossys/publisher/install). */
const ROUTE_MARKER = '// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.';
/** Route files under app/ Publisher does not install: none (the specimen frame is a server route). */
const EXEMPT_ROUTES = [];
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

/**
 * The Studio publication's content map and route pack, projected by Publisher from the pinned
 * `publication.studio` and `page.*` slots (no generated map or route pack is stored), then expanded
 * through each agent's ia.json into tab pages and leaf templates, exactly as `publishNext` installs.
 */
async function readStudioPublication(repositoryRoot = REPOSITORY_ROOT) {
  const { readPinnedPublication } = await import('@clossys/publisher/content-map/slots');
  const { expandPublication } = await import(require('node:url').pathToFileURL(path.join(STUDIO_ROOT, '../dist/publish/expand-tabs.js')).href);
  const consumer = path.join(repositoryRoot, 'clossys');
  const { map, routePack } = await readPinnedPublication(path.join(consumer, 'agents/publisher'), 'studio');
  if (!routePack) throw new Error('publication.studio has no route pack');
  const expansion = expandPublication(consumer, map, routePack.routes);
  return { map: expansion.map, routePack: { ...routePack, routes: expansion.routes } };
}

async function checkStudioRoutes({ studioRoot = STUDIO_ROOT, repositoryRoot = REPOSITORY_ROOT, publication } = {}) {
  const findings = [];
  const { map, routePack: pack } = publication ?? await readStudioPublication(repositoryRoot);
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

module.exports = { checkStudioRoutes, readStudioPublication, ROUTE_MARKER, EXEMPT_ROUTES };
if (require.main === module) {
  checkStudioRoutes().then(findings => {
    if (findings.length) {
      console.error(JSON.stringify({ check: 'Studio routes', findings }, null, 2));
      process.exitCode = 1;
    } else console.log('Studio routes: every content-map page and leaf template is installed by Publisher; app/ holds no other route.');
  }, error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
