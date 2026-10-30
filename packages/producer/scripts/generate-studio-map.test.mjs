import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { contentMapFromCells, compileContentMaps } from '@clossys/publisher/content-map/cells';
import { projectNavigation, projectCommands, projectBreadcrumbs, projectPageBody } from '@clossys/publisher/content-map';
import { generateStudioMap } from './generate-studio-map.mjs';
import { loadCatalog } from '@clossys/designer/catalog';
import { transform } from 'esbuild';

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
  const iconSlots = new Set(loadCatalog().slots.filter(slot => slot.id.startsWith('assets.icon-')).map(slot => slot.id));
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
      assert.ok(iconSlots.has(action.icon), `${action.icon} must be a registered Designer icon asset`);
      assert.equal(action.defaultOpen, action.id === 'explorer');
      assert.equal(action.module.section, sectionIds[action.id]);
      assert.equal(action.intent, undefined);
    }
    assert.deepEqual(actions.find(action => action.id === 'needs').module, { section: 'sections.task-list', source: `${page.id}.open-requests` });
    if (page.id !== 'home') {
      assert.deepEqual(actions.find(action => action.id === 'inspector').module, { section: 'sections.record-detail', source: `${page.id}.inspector` });
    }
  }
  for (const entry of projection.map.entries) if (entry.icon) assert.ok(iconSlots.has(entry.icon), `${entry.icon} must be a registered Designer icon asset`);
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


// Execute the generated TypeScript wrapper against its real Publisher export.
// Inline its JSON input as a bundler does, without a second projection schema.
async function loadGenerated(outputDir, projection) {
  const source = (await readFile(join(outputDir, 'studio-map.ts'), 'utf8'))
    .replaceAll("from '@clossys/publisher/content-map'", `from ${JSON.stringify(import.meta.resolve('@clossys/publisher/content-map'))}`)
    .replace("import projection from './studio-map.json';", `const projection = ${JSON.stringify(projection)};`);
  const compiled = await transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

const commonBody = {
  template: 'ia-scroll',
  bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' },
  row: { columns: ['title', 'specimen', 'status', 'version', 'usedBy', 'linkOut'] },
};
const agentPages = ['director', 'designer', 'writer', 'publisher'];

// Fixture specimen IDs exercise Publisher's binding syntax, not Designer registration.
test('identical agent bodies project cards at L2 through the actual generated wrapper', async t => {
  const options = await fixture(t), projection = await generateStudioMap(options);
  const map = await contentMapFromCells(options.cellRoot, 'studio');
  const runtime = await loadGenerated(options.outputDir, projection);
  assert.deepEqual(runtime.studioPageBodies, projection.pageBodies);
  assert.deepEqual(Object.keys(projection.pageBodies), agentPages);
  assert.equal(projection.pageBodies.home, undefined);
  assert.equal(map.entries.find(page => page.id === 'home').body, undefined);
  for (const pageId of agentPages) {
    assert.deepEqual(projection.pageBodies[pageId], commonBody);
    assert.deepEqual(projection.pageBodies[pageId], map.entries.find(page => page.id === pageId).body);
    assert.equal(Object.hasOwn(projection.pageBodies[pageId], 'container'), false);
    assert.equal(Object.hasOwn(projection.pageBodies[pageId].row, 'specimen'), false);
    assert.throws(() => runtime.studioPageBody(pageId));
    for (const specimen of ['sections.specimen-fixture-first', 'sections.specimen-fixture-second']) {
      assert.deepEqual(runtime.studioPageBody(pageId, specimen), {
        ...commonBody,
        row: { specimen, columns: commonBody.row.columns },
      });
    }
    for (const specimen of [undefined, 'sections.data-table', 'sections.specimen-', 'sections.specimen-fixture extra']) {
      assert.throws(() => runtime.studioPageBody(pageId, specimen));
    }
  }
  assert.throws(() => runtime.studioPageBody('home', 'sections.specimen-fixture-first'));
  const generated = await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8');
  assert.match(generated, /export type \{ ContentMapPageBody, ContentMapProjectedBody \} from '@clossys\/publisher\/content-map'/);
  assert.doesNotMatch(generated, /ContentMapBodyContainer|\blayer\b/);
  assert.match(generated, /import \{ projectPageBody \} from '@clossys\/publisher\/content-map'/);
  assert.match(generated, /studioPageBody\(pageId: string, boundSpecimenId: string\): ContentMapProjectedBody \{ return projectPageBody\(studioMap, pageId, boundSpecimenId\); \}/);
  await generateStudioMap({ ...options, check: true });
});

test('authored specimen edits fail drift and retain native binding conflicts', async t => {
  const options = await fixture(t);
  await generateStudioMap(options);
  const cell = join(options.cellRoot, 'cells/page.designer/v1.md');
  await replace(cell, '"columns": [', '"specimen": "sections.specimen-fixture-bound",\n    "columns": [');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  const changed = await generateStudioMap(options);
  const body = { ...commonBody, row: { specimen: 'sections.specimen-fixture-bound', columns: commonBody.row.columns } };
  assert.deepEqual(changed.pageBodies.designer, body);
  assert.deepEqual(changed.pageBodies.designer, changed.map.entries.find(page => page.id === 'designer').body);
  assert.deepEqual(projectPageBody(changed.map, 'designer'), body);
  const runtime = await loadGenerated(options.outputDir, changed);
  assert.deepEqual(runtime.studioPageBody('designer', 'sections.specimen-fixture-bound'), body);
  assert.throws(() => runtime.studioPageBody('designer', 'sections.specimen-fixture-conflict'));
  await generateStudioMap({ ...options, check: true });
  await replace(join(options.outputDir, 'studio-map.json'), '"specimen": "sections.specimen-fixture-bound"', '"specimen": "sections.specimen-fixture-stale"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
});

test('old container bindings and L2 tables fail for every agent body', async t => {
  const options = await fixture(t);
  const containers = [
    { section: 'sections.data-table' },
    { section: 'sections.cards', mode: 'grid' },
    { section: 'sections.cards', mode: 'stack' },
    { byLayer: {
      tokens: { section: 'sections.data-table' },
      assets: { section: 'sections.cards', mode: 'grid' },
      components: { section: 'sections.cards', mode: 'grid' },
      sections: { section: 'sections.cards', mode: 'grid' },
      frames: { section: 'sections.cards', mode: 'grid' },
    } },
  ];
  for (const pageId of agentPages) {
    const cell = join(options.cellRoot, `cells/page.${pageId}/v1.md`);
    const source = await readFile(cell, 'utf8');
    for (const container of containers) {
      await writeFile(cell, source.replace('"row": {', `"container": ${JSON.stringify(container)},\n  "row": {`));
      await assert.rejects(generateStudioMap(options), undefined, `${pageId} rejects ${JSON.stringify(container)}`);
    }
    await writeFile(cell, source.replace('"L2": "sections.cards"', '"L2": "sections.data-table"'));
    await assert.rejects(generateStudioMap(options), undefined, `${pageId} rejects L2 table`);
    await writeFile(cell, source);
  }
  await generateStudioMap(options);
  await generateStudioMap({ ...options, check: true });
});

test('stale generated containers, L2 tables and wrapper arguments fail projection drift', async t => {
  const options = await fixture(t);
  await generateStudioMap(options);
  const data = join(options.outputDir, 'studio-map.json');
  await replace(data, '"row": {', '"container": { "section": "sections.cards", "mode": "stack" },\n          "row": {');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  await generateStudioMap(options);
  await replace(data, '"L2": "sections.cards"', '"L2": "sections.data-table"');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
  await generateStudioMap(options);
  await replace(join(options.outputDir, 'studio-map.ts'), 'boundSpecimenId: string)', 'boundSpecimenId: string, layer?: string)');
  await assert.rejects(generateStudioMap({ ...options, check: true }), /drift/i);
});
