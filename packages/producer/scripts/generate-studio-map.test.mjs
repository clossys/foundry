import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { contentMapFromCells, compileContentMaps } from '@clossys/publisher/content-map/cells';
import { projectNavigation, projectCommands } from '@clossys/publisher/content-map';
import { checkManifest, generateStudioMap } from './generate-studio-map.mjs';

const clossys = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const GENERIC_PAGE = { file: 'studio/app/[[...route]]/page.tsx', export: 'default' };

/** A copy of the Studio library: Publisher cells, Designer slot contracts, library records and the selection. */
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'studio-map-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clossysRoot = join(dir, 'clossys'), outputDir = join(dir, 'generated');
  await mkdir(join(clossysRoot, 'agents', 'designer'), { recursive: true });
  await cp(join(clossys, 'agents', 'publisher'), join(clossysRoot, 'agents', 'publisher'), { recursive: true });
  await cp(join(clossys, 'agents', 'designer', 'slot-contracts'), join(clossysRoot, 'agents', 'designer', 'slot-contracts'), { recursive: true });
  await cp(join(clossys, 'library'), join(clossysRoot, 'library'), { recursive: true });
  await cp(join(clossys, 'selection.json'), join(clossysRoot, 'selection.json'));
  return { clossysRoot, outputDir, cellRoot: join(clossysRoot, 'agents', 'publisher') };
}
async function replace(path, before, after) {
  const source = await readFile(path, 'utf8');
  assert.ok(source.includes(before), `${path} has ${before}`);
  await writeFile(path, source.replace(before, after));
}
const run = (options, extra = {}) => generateStudioMap({ clossysRoot: options.clossysRoot, outputDir: options.outputDir, ...extra });

test('every Studio page is a Publisher assembly: frame + ordered sections + bindings, from the ordinary map', async t => {
  const options = await fixture(t), projection = await run(options);
  const map = await contentMapFromCells(options.cellRoot, 'studio');
  assert.deepEqual(projection.map, map);
  assert.deepEqual(projection.pages.map(page => [page.id, page.path, page.frameId]), [
    ['home', '/', 'frames.studio-shell'], ['director', '/director', 'frames.studio-shell'], ['designer', '/designer', 'frames.studio-shell'],
    ['writer', '/writer', 'frames.studio-shell'], ['publisher', '/publisher', 'frames.studio-shell'],
  ]);
  assert.deepEqual(projection.pages.find(page => page.id === 'publisher').sectionIds, ['sections.studio.agent-gallery', 'sections.studio.publications']);
  for (const page of projection.pages.filter(row => row.id !== 'home')) {
    assert.equal(page.leaf.body, 'detail');
    assert.equal(page.leaf.sectionIds[0], 'sections.studio.leaf-header');
    for (const slot of ['sections.studio.specimen', 'sections.studio.options', 'sections.studio.history', 'sections.studio.references']) assert.ok(page.leaf.sectionIds.includes(slot));
  }
  // One generic renderer: every route enters through the same App Router page.
  for (const route of projection.routes) assert.deepEqual(route.entry, GENERIC_PAGE);
  for (const page of map.entries.filter(row => row.kind === 'page')) assert.deepEqual(projection.pageActions[page.id], page.actions ?? []);
  assert.deepEqual(projection.items.map(item => item.slot).sort(), [
    'frames.module', 'frames.studio-shell', 'sections.module.checks', 'sections.module.explorer', 'sections.module.outline', 'sections.studio.agent-gallery', 'sections.studio.checks', 'sections.studio.contract', 'sections.studio.history', 'sections.studio.home',
    'sections.studio.leaf-header', 'sections.studio.options', 'sections.studio.publications', 'sections.studio.references', 'sections.studio.specimen',
  ]);
  const bindings = await readFile(join(options.outputDir, 'assembly-bindings.ts'), 'utf8');
  assert.match(bindings, /"frames\.studio-shell": Frame0/);
  for (const item of projection.items.filter(row => row.slot.startsWith('sections.'))) assert.match(bindings, new RegExp(`from "\\.\\./sections/${item.element}"`));
  const module = await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8');
  assert.match(module, /export const studioPageActions = projection\.pageActions/);
  await run(options, { check: true });
});

test('active title and path edits drive the map, the page records and the commands', async t => {
  const options = await fixture(t);
  await run(options);
  const cell = join(options.cellRoot, 'cells/page.designer/v2.md');
  await replace(cell, 'title: Designer', 'title: Visual design');
  await replace(cell, 'path: /designer', 'path: /design');
  await assert.rejects(run(options, { check: true }), /drift/i);
  const changed = await run(options);
  assert.deepEqual(changed.routes.find(row => row.instanceId === 'designer'), { instanceId: 'designer', path: '/design', label: 'Visual design', entry: GENERIC_PAGE });
  assert.equal(changed.pages.find(page => page.id === 'designer').path, '/design');
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'designer' && row.label === 'Visual design' && row.href === '/design'));
  await run(options, { check: true });
});

test('pin changes select navigation without hiding command discovery', async t => {
  const options = await fixture(t), path = join(options.cellRoot, 'tree.json');
  const tree = JSON.parse(await readFile(path, 'utf8'));
  delete tree.meta.publications[0].entryMeta['page.writer'].pin;
  await writeFile(path, JSON.stringify(tree));
  const changed = await run(options);
  const nav = projectNavigation(changed.map, 'home');
  assert.ok(!nav.tree.flatMap(row => [row, ...(row.children ?? [])]).some(row => row.id === 'writer'));
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'writer'));
});

test('a section bound to anything but its contract input fails closed', async t => {
  const options = await fixture(t);
  await replace(join(options.cellRoot, 'cells/page.designer/v2.md'), '"sections.studio.agent-gallery": "gallery"', '"sections.studio.agent-gallery": "cards"');
  await assert.rejects(run(options), /contract input is "gallery"/);
});

test('a slot with no pin, or an item with no trusted reference, fails closed', async t => {
  const options = await fixture(t), path = join(options.clossysRoot, 'selection.json');
  const selection = JSON.parse(await readFile(path, 'utf8'));
  const { element, version } = selection.pins['sections.studio.history'];
  const record = join(options.clossysRoot, 'library/sections.studio.history', element, `v${version}`, 'element.json');
  await replace(record, '"mode": "customized"', '"mode": "original"');
  await assert.rejects(run(options), /pin hash|trusted reference/);
  delete selection.pins['sections.studio.history'];
  await writeFile(path, JSON.stringify(selection));
  await assert.rejects(run(options), /no pin/);
});

/** Rewrite the Route json of a page cell: `edit` changes the parsed route in place. */
async function editRoute(path, edit) {
  const source = await readFile(path, 'utf8');
  const blocks = [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].filter(match => match[1].includes('"manifest"'));
  assert.equal(blocks.length, 1, `${path} has one Route json with a manifest`);
  const route = JSON.parse(blocks[0][1]);
  edit(route);
  await writeFile(path, source.replace(blocks[0][1], JSON.stringify(route, null, 2)));
}

test('a page manifest missing its explorer, modules or actions fails closed (mutation proof)', async t => {
  const mutations = [
    ['no manifest', route => { delete route.manifest; }, /declares no page manifest/],
    ['no explorer', route => { delete route.manifest.navigator; }, /needs an explorer or an outline/],
    ['explorer module removed', route => { route.manifest.modules = route.manifest.modules.filter(module => module.id !== 'explorer'); }, /explorer/],
    ['no modules', route => { route.manifest.modules = []; }, /declares no modules/],
    ['no actions', route => { route.manifest.actions = []; }, /declares no actions/],
    ['an action with no wiring line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => !line.do.startsWith('action ')); }, /wiring/],
    ['a leaf with no outline', route => { delete route.leaf.manifest.navigator; }, /needs an explorer or an outline/],
  ];
  const clean = await fixture(t);
  await run(clean);
  for (const [label, edit, error] of mutations) {
    const options = await fixture(t);
    await editRoute(join(options.cellRoot, 'cells/page.designer/v2.md'), edit);
    await assert.rejects(run(options), error, label);
  }
});

test('checkManifest names what a manifest lacks', () => {
  assert.throws(() => checkManifest('page.x', undefined, {}), /declares no page manifest/);
  assert.throws(() => checkManifest('page.x', { frame: 'frames.module', navigator: 'explorer', modules: [], actions: [], wiring: [] }, {}), /declares no modules/);
});

test('Studio runs exactly the pinned payload: code that drifts from the library record fails', async t => {
  const options = await fixture(t), selection = JSON.parse(await readFile(join(options.clossysRoot, 'selection.json'), 'utf8'));
  await run(options);
  const { element, version } = selection.pins['sections.studio.checks'];
  await replace(join(options.clossysRoot, 'library/sections.studio.checks', element, `v${version}`, 'index.tsx'), 'data-studio-section="checks"', 'data-studio-section="drifted"');
  await assert.rejects(run(options), /differs from studio-checks/);
});

test('stale generated products and unexpected files fail closed', async t => {
  const options = await fixture(t);
  await run(options);
  await replace(join(options.outputDir, 'studio-map.json'), '"Home"', '"Manual duplicate"');
  await assert.rejects(run(options, { check: true }), /drift/i);
  await run(options);
  await writeFile(join(options.outputDir, 'view-bindings.ts'), 'export const extra = true;');
  await assert.rejects(run(options, { check: true }), /Unexpected file/);
});

test('ordinary CELL-P output drift is checked before accepting the projection', async t => {
  const options = await fixture(t);
  await run(options);
  await replace(join(options.cellRoot, 'route-pack/studio.json'), '"Home"', '"Stale label"');
  await assert.rejects(run(options, { check: true }), /drift/);
  await compileContentMaps(options.cellRoot);
  await run(options, { check: true });
});

test('Foundry Publisher inventory exposes the Studio publication and five authored page cells', async () => {
  const { inventory } = await import('../dist/server/cells.js');
  const foundryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await inventory(foundryRoot, 'publisher');
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.cells.map(cell => cell.id).sort(), ['page.designer', 'page.director', 'page.home', 'page.publisher', 'page.writer']);
  assert.equal(result.tree.tree[0].id, 'studio');
  assert.equal(result.tree.meta.publications[0].id, 'studio');
});
