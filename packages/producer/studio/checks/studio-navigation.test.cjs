'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');

const studio = path.resolve(__dirname, '..');

/** Bundle Studio source as CommonJS; `mocks` swaps named imports of the source for runtime ports. */
function compile(file, mocks = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-frame-test-')));
  try {
    const source = fs.readFileSync(file, 'utf8').replace(/from ('[^']+')/g, (match, quoted) => {
      const name = quoted.slice(1, -1);
      if (!mocks[name]) return match;
      const port = path.join(scratch, `${Object.keys(mocks).indexOf(name)}.js`);
      fs.writeFileSync(port, mocks[name]);
      return `from ${JSON.stringify(port)}`;
    });
    const output = buildSync({ stdin: { contents: source, resolveDir: path.dirname(file), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/*', 'react-dom/*'], loader: { '.css': 'empty' }, jsx: 'automatic', write: false, logLevel: 'silent' }).outputFiles[0].text;
    const compiled = new Module(path.join(studio, 'checks/frame-test.cjs'), module);
    compiled.filename = path.join(studio, 'checks/frame-test.cjs');
    compiled.paths = Module._nodeModulePaths(studio);
    compiled._compile(output, compiled.filename);
    return compiled.exports;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

const { default: Frame } = compile(path.join(studio, 'frames/studio-shell/index.tsx'), {
  'next/navigation': `export const usePathname=()=>globalThis.__studioPath ?? '/'; export const useRouter=()=>({push(){}});`,
  '../../components/StudioProviders': `export const useStudioData=()=>({reports:[],brand:{name:'Fixture'}}); export const useThemeMode=()=>({mode:'light',setMode(){}});`,
});
const routes = compile(path.join(studio, 'lib/studio-route-map.ts'));
const { studioPages } = compile(path.join(studio, 'generated/studio-map.ts'));

/** A map with one fixture leaf per gallery, the way the record stores fill it at runtime. */
const leaves = Object.fromEntries(routes.studioLeafPages.map(page => [page.id, [{ slug: 'fixture-leaf', title: 'Fixture leaf' }]]));
const map = routes.studioRuntimeMap(leaves);
const entries = routes.studioPageEntries(map);
const paths = new Set(entries.map(entry => entry.path));

function render(entry) {
  globalThis.__studioPath = entry.path;
  try {
    const projection = routes.studioShellProjection(map, entry.id);
    return { projection, html: renderToStaticMarkup(React.createElement(Frame, { ...projection }, 'Content')) };
  } finally { delete globalThis.__studioPath; }
}
const hrefs = html => [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));

test('the runtime map holds home, the galleries and every leaf, each at its served path', () => {
  assert.equal(entries.find(entry => entry.id === 'home')?.path, '/');
  for (const page of routes.studioLeafPages) {
    assert.ok(paths.has(page.path), page.id);
    assert.ok(paths.has(`${page.path}/fixture-leaf`), `${page.id} leaf`);
  }
  assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length, 'no two entries share a path');
});

test('every link the frame renders, on every map entry, is a map path', () => {
  for (const entry of entries) {
    const { html } = render(entry);
    const links = hrefs(html);
    assert.ok(links.length > 0, entry.id);
    for (const href of links) assert.ok(paths.has(href), `${entry.id} renders ${href}, which the map does not hold`);
  }
});

test('frame navigation, commands and breadcrumbs are the Publisher projections of the one map', () => {
  for (const entry of entries) {
    const { projection } = render(entry);
    const commands = projection.commands.flatMap(group => group.items.filter(item => item.href).map(item => item.href));
    for (const href of commands) assert.ok(paths.has(href), href);
    assert.equal(projection.breadcrumbs.at(-1)?.label, entry.title, `${entry.id} breadcrumb ends at the page`);
    for (const crumb of projection.breadcrumbs) if (crumb.href) assert.ok(paths.has(crumb.href), crumb.href);
  }
  const commandHrefs = new Set(routes.studioShellProjection(map, 'home').commands.flatMap(group => group.items.map(item => item.href)));
  for (const entry of entries) assert.ok(commandHrefs.has(entry.path), `the command menu lists ${entry.path}`);
});

test('every page manifest declares its navigator, modules and header actions (agent pages: explorer; L3 pages: outline)', () => {
  for (const page of studioPages) {
    const specs = [['page', page, page.id === 'home' ? 'outline' : 'explorer'], ...(page.leaf ? [['leaf', page.leaf, 'outline']] : [])];
    for (const [where, spec, navigator] of specs) {
      const manifest = spec.manifest;
      assert.ok(manifest, `${page.id} ${where} has a manifest`);
      assert.equal(manifest.navigator, navigator, `${page.id} ${where} navigator`);
      assert.deepEqual(manifest.modules.map(module => module.id), [navigator, 'checks'], `${page.id} ${where} modules`);
      assert.ok(manifest.actions.some(action => action.id === 'copy-link'), `${page.id} ${where} copies its link`);
      if (where === 'leaf') assert.deepEqual(manifest.actions.map(action => action.id), ['request-change', 'versions', 'copy-link']);
    }
  }
});

test('the frame header holds the breadcrumb and icon buttons only; the right panel holds no form', () => {
  const { html } = render(entries.find(entry => entry.id === 'home'));
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? '';
  assert.ok(header.includes('aria-label="breadcrumb"') || header.includes('Breadcrumb'), 'header carries the breadcrumb');
  assert.doesNotMatch(header, /<(input|textarea|select|form)\b/);
  assert.doesNotMatch(html, /<(form|textarea)\b/);
});
