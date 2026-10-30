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
  assert.deepEqual(projection.navigation.home.tree.map(row => row.id), ['home', 'agents']);
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

test('Foundry Publisher inventory exposes the Studio publication and five authored page cells', async () => {
  const { inventory } = await import('../dist/server/cells.js');
  const foundryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await inventory(foundryRoot, 'publisher');
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.cells.map(cell => cell.id).sort(), ['page.designer', 'page.director', 'page.home', 'page.publisher', 'page.writer']);
  assert.equal(result.tree.tree[0].id, 'studio');
  assert.equal(result.tree.meta.publications[0].id, 'studio');
});

test('Studio pages project the universal action modules and semantic icons in source order', async t => {
  const options = await fixture(t), projection = await generateStudioMap(options);
  const pages = projection.map.entries.filter(row => row.kind === 'page');
  assert.equal(pages.length, 5);
  assert.equal(pages.reduce((count, page) => count + page.actions.length, 0), 21);
  for (const page of pages) {
    assert.deepEqual(projection.pageActions[page.id], page.actions ?? []);
    const actions = projection.pageActions[page.id];
    assert.deepEqual(actions.map(action => action.id), page.id === 'home'
      ? ['needs'] : ['explorer', 'inspector', 'source', 'checks', 'needs']);
    const sectionIds = { explorer: 'sections.explorer', inspector: 'sections.record-detail', source: 'sections.content', checks: 'sections.status-list', needs: 'sections.task-list' };
    for (const action of actions) {
      assert.equal(action.label, action.id[0].toUpperCase() + action.id.slice(1));
      assert.equal(action.icon, `assets.icon-${action.id}`);
      assert.equal(action.defaultOpen, action.id === 'explorer');
      assert.equal(action.module.section, sectionIds[action.id]);
      assert.equal(action.intent, undefined);
    }
    assert.deepEqual(actions.find(action => action.id === 'needs').module, { section: 'sections.task-list', source: `${page.id}.open-requests` });
    if (page.id !== 'home') {
      assert.deepEqual(actions.find(action => action.id === 'inspector').module, { section: 'sections.record-detail', source: `${page.id}.inspector` });
    }
  }
  const generated = await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8');
  assert.match(generated, /export const studioPageActions = projection\.pageActions/);
  assert.doesNotMatch(generated, /studioPublicationHref/);
  const cell = join(options.cellRoot, 'cells/page.designer/v1.md');
  await replace(cell, '"label": "Inspector"', '"label": "Record inspector"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  const changed = await generateStudioMap(options);
  assert.equal(changed.pageActions.designer.find(action => action.id === 'inspector').label, 'Record inspector');
  assert.equal(changed.map.entries.find(entry => entry.id === 'designer').actions.find(action => action.id === 'inspector').label, 'Record inspector');
});

test('removed Apps page stays absent from every generated discovery surface', async t => {
  const options = await fixture(t), projection = await generateStudioMap(options);
  assert.ok(!projection.map.entries.some(entry => entry.id === 'apps'));
  assert.ok(!projection.routes.some(route => route.instanceId === 'apps'));
  assert.equal(projection.pageActions.apps, undefined);
  for (const navigation of Object.values(projection.navigation)) {
    assert.ok(!navigation.tree.some(entry => entry.id === 'apps'));
  }
  assert.ok(!projection.commands.flatMap(group => group.items).some(entry => entry.id === 'apps'));
  const bindings = await readFile(join(options.outputDir, 'view-bindings.ts'), 'utf8');
  assert.doesNotMatch(bindings, /AppsView/);
});
