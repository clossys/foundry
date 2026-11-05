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
const { studioPages, studioLeaves } = compile(path.join(studio, 'generated/studio-map.ts'));

/** The runtime map: the compiled publication (home, agent groups, tab pages) plus one page entry per installed leaf. */
const map = routes.studioRuntimeMap;
const entries = routes.studioPageEntries(map);
const paths = new Set(entries.map(entry => entry.path));
const tabs = studioPages.filter(page => page.leaf);
/** Every compiled page and the first leaf of each tab: one of each shape the frame renders. */
const sampled = entries.filter(entry => !studioLeaves.some(leaf => leaf.path === entry.path) || tabs.some(tab => studioLeaves.find(leaf => leaf.page === tab.id)?.path === entry.path));

function render(entry) {
  globalThis.__studioPath = entry.path;
  try {
    const projection = routes.studioShellProjection(map, entry.id);
    return { projection, html: renderToStaticMarkup(React.createElement(Frame, { ...projection }, 'Content')) };
  } finally { delete globalThis.__studioPath; }
}
const hrefs = html => [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));

test('the runtime map holds home, every tab page and every leaf, each at its served path', () => {
  assert.equal(entries.find(entry => entry.id === 'home')?.path, '/');
  assert.ok(tabs.length > 0 && studioLeaves.length > 0);
  for (const page of studioPages) assert.ok(paths.has(page.path), page.id);
  for (const leaf of studioLeaves) {
    const tab = studioPages.find(page => page.id === leaf.page);
    assert.ok(tab?.leaf, `${leaf.page} serves leaves`);
    assert.equal(leaf.path, `${tab.path}/${leaf.slug}`);
    assert.ok(paths.has(leaf.path), `${leaf.page} leaf ${leaf.slug}`);
  }
  assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length, 'no two entries share a path');
});

test('every link the frame renders, on every page and a leaf of every tab, is a map path', () => {
  for (const entry of sampled) {
    const { html } = render(entry);
    const links = hrefs(html);
    assert.ok(links.length > 0, entry.id);
    for (const href of links) assert.ok(paths.has(href), `${entry.id} renders ${href}, which the map does not hold`);
  }
});

test('frame navigation, commands and breadcrumbs are the Publisher projections of the one map', () => {
  for (const entry of sampled) {
    const { projection } = render(entry);
    const commands = projection.commands.flatMap(group => group.items.filter(item => item.href).map(item => item.href));
    for (const href of commands) assert.ok(paths.has(href), href);
    assert.equal(projection.breadcrumbs.at(-1)?.label, entry.title, `${entry.id} breadcrumb ends at the page`);
    for (const crumb of projection.breadcrumbs) if (crumb.href) assert.ok(paths.has(crumb.href), crumb.href);
  }
  const commandHrefs = new Set(routes.studioShellProjection(map, 'home').commands.flatMap(group => group.items.map(item => item.href)));
  for (const entry of entries) assert.ok(commandHrefs.has(entry.path), `the command menu lists ${entry.path}`);
});

test('every page manifest declares its navigator, popovers and header actions (pages: outline; leaves: outline and versions)', () => {
  for (const page of studioPages) {
    const specs = [['page', page, 'outline'], ...(page.leaf ? [['leaf', page.leaf, 'outline']] : [])];
    for (const [where, spec, navigator] of specs) {
      const manifest = spec.manifest;
      assert.ok(manifest, `${page.id} ${where} has a manifest`);
      assert.equal(manifest.navigator, navigator, `${page.id} ${where} navigator`);
      assert.deepEqual(manifest.modules.map(module => module.id), where === 'leaf' ? [navigator, 'checks', 'versions'] : [navigator, 'checks'], `${page.id} ${where} modules`);
      assert.deepEqual(manifest.actions.map(action => action.id), where === 'leaf' ? ['request-change'] : [], `${page.id} ${where} actions`);
      assert.doesNotMatch(JSON.stringify(manifest), /copy-link/, `${page.id} ${where} has no retired action, command or wiring`);
      for (const action of manifest.actions) assert.equal(action.handler.kind, 'copy-prompt');
      assert.ok(!('frame' in manifest) && manifest.modules.every(module => !('defaultOpen' in module)), `${page.id} ${where} names no module frame`);
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
