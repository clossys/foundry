import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { contentMapFromCells, compileContentMaps } from '@clossys/publisher/content-map/cells';
import { projectNavigation, projectCommands, projectBreadcrumbs } from '@clossys/publisher/content-map';
import { generateStudioMap } from './generate-studio-map.mjs';

const root = fileURLToPath(new URL('../../../clossys/agents/publisher/', import.meta.url));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-map-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cellRoot = join(dir, 'publisher'), outputDir = join(dir, 'generated');
  await cp(root, cellRoot, { recursive: true });
  return { cellRoot, outputDir };
}
async function replace(path, before, after) {
  const source = await readFile(path, 'utf8');
  assert.ok(source.includes(before));
  await writeFile(path, source.replace(before, after));
}

test('all products come from the same ordinary Publisher map and route-pack', async t => {
  const options = await fixture(t), projection = await generateStudioMap(options);
  const map = await contentMapFromCells(options.cellRoot, 'studio');
  assert.deepEqual(projection.map, map);
  assert.deepEqual(projection.navigation.designer, projectNavigation(map, 'designer'));
  assert.deepEqual(projection.commands, projectCommands(map));
  assert.deepEqual(projection.breadcrumbs.designer, projectBreadcrumbs(map, 'designer'));
  const pack = JSON.parse(await readFile(join(options.cellRoot, 'route-pack/studio.json'), 'utf8'));
  assert.deepEqual(projection.routes, pack.routes);
  assert.deepEqual(projection.navigation.home.tree.map(row => row.id), ['home', 'agents', 'apps']);
  assert.deepEqual(projection.navigation.home.tree[1].children.map(row => row.id), ['director', 'designer', 'writer', 'publisher']);
  const imports = await readFile(join(options.outputDir, 'view-bindings.ts'), 'utf8');
  for (const route of pack.routes) {
    assert.match(imports, new RegExp(route.entry.file.replace('studio/', '../').replace('.tsx', '')));
    assert.equal(route.composition, undefined);
  }
  await generateStudioMap({ ...options, check: true });
});

test('active title and path edits drive routes, navigation, commands and breadcrumbs', async t => {
  const options = await fixture(t);
  await generateStudioMap(options);
  const cell = join(options.cellRoot, 'cells/page.designer/v1.md');
  await replace(cell, 'title: Designer', 'title: Visual design');
  await replace(cell, 'path: /agents/designer', 'path: /tools/design');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  const changed = await generateStudioMap(options);
  assert.deepEqual(changed.routes.find(row => row.instanceId === 'designer'), {
    entry: { file: 'studio/views/DesignerView.tsx', export: 'default' },
    instanceId: 'designer', path: '/tools/design', label: 'Visual design',
  });
  const nav = changed.navigation.designer.tree[1].children.find(row => row.id === 'designer');
  assert.equal(nav.href, '/tools/design'); assert.equal(nav.label, 'Visual design');
  assert.ok(changed.commands.flatMap(row => row.items).some(row => row.id === 'designer' && row.label === 'Visual design' && row.href === '/tools/design'));
  assert.equal(changed.breadcrumbs.designer.at(-1).href, '/tools/design');
  await generateStudioMap({ ...options, check: true });
});

test('pin changes select navigation without hiding command discovery', async t => {
  const options = await fixture(t), path = join(options.cellRoot, 'tree.json');
  const tree = JSON.parse(await readFile(path, 'utf8'));
  delete tree.meta.publications[0].entryMeta['page.writer'].pin;
  await writeFile(path, JSON.stringify(tree));
  const changed = await generateStudioMap(options);
  assert.ok(!changed.navigation.home.tree[1].children.some(row => row.id === 'writer'));
  assert.ok(changed.commands.flatMap(row => row.items).some(row => row.id === 'writer'));
});

test('stale generated products, unexpected files and invalid actual exports fail closed', async t => {
  const options = await fixture(t);
  await generateStudioMap(options);
  await replace(join(options.outputDir, 'studio-map.json'), '"Home"', '"Manual duplicate"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  await generateStudioMap(options);
  await writeFile(join(options.outputDir, 'manual.ts'), 'export const extra = true;');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /Unexpected file/);
  await rm(join(options.outputDir, 'manual.ts'));
  await replace(join(options.cellRoot, 'cells/page.home/v1.md'), 'HomeView.tsx', 'MissingView.tsx');
  await assert.rejects(generateStudioMap(options), /ENOENT/);
});

test('ordinary CELL-P output drift is checked before accepting the tarball projection', async t => {
  const options = await fixture(t);
  await generateStudioMap(options);
  await replace(join(options.cellRoot, 'route-pack/studio.json'), '"Home"', '"Stale label"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/);
  await compileContentMaps(options.cellRoot);
  await generateStudioMap({ ...options, check: true });
});

test('Foundry Publisher inventory exposes the Studio publication and six authored page cells', async () => {
  const { inventory } = await import('../dist/server/cells.js');
  const foundryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await inventory(foundryRoot, 'publisher');
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.cells.map(cell => cell.id).sort(), ['page.apps', 'page.designer', 'page.director', 'page.home', 'page.publisher', 'page.writer']);
  assert.equal(result.tree.tree[0].id, 'studio');
  assert.equal(result.tree.meta.publications[0].id, 'studio');
});

test('page actions project the ordinary map in source order, including module defaults and one Apps intent', async t => {
  const options = await fixture(t), projection = await generateStudioMap(options);
  for (const page of projection.map.entries.filter(row => row.kind === 'page')) {
    assert.deepEqual(projection.pageActions[page.id], page.actions ?? []);
  }
  assert.deepEqual(projection.pageActions.designer.map(action => action.id), ['explorer', 'details', 'source', 'checks', 'preview', 'needs']);
  assert.equal(projection.pageActions.designer[0].defaultOpen, true);
  assert.deepEqual(projection.pageActions.designer.find(action => action.id === 'needs').module, { section: 'sections.check-findings', source: 'designer.selection-needs' });
  assert.ok(projection.pageActions.designer.slice(1).every(action => action.defaultOpen === false));
  assert.ok(projection.pageActions.home.every(action => action.defaultOpen === false));
  assert.deepEqual(projection.pageActions.apps, [{ id: 'open-selected-app-dev-server', label: 'Open app', icon: 'assets.icon-external-link', defaultOpen: false, intent: 'open-app-dev-server' }]);
  const generated = await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8');
  assert.match(generated, /export const studioPageActions = projection\.pageActions/);
  const cell = join(options.cellRoot, 'cells/page.designer/v1.md');
  await replace(cell, '"label": "Preview"', '"label": "Inspect preview"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  const changed = await generateStudioMap(options);
  assert.equal(changed.pageActions.designer.find(action => action.id === 'preview').label, 'Inspect preview');
  assert.equal(changed.map.entries.find(entry => entry.id === 'designer').actions.find(action => action.id === 'preview').label, 'Inspect preview');
});
