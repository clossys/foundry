import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPinnedPublication } from '@clossys/publisher/content-map/slots';
import { projectNavigation, projectCommands } from '@clossys/publisher/content-map';
import { checkManifest, generateStudioMap } from './generate-studio-map.mjs';

const clossys = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const GENERIC_PAGE = { file: 'studio/app/[[...route]]/page.tsx', export: 'default' };

/** A copy of the Studio library: pinned Publisher candidates, Designer slot contracts, library records and the selection. */
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'studio-map-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clossysRoot = join(dir, 'clossys'), outputDir = join(dir, 'generated');
  await mkdir(join(clossysRoot, 'agents', 'designer'), { recursive: true });
  await cp(join(clossys, 'agents', 'publisher'), join(clossysRoot, 'agents', 'publisher'), { recursive: true });
  await cp(join(clossys, 'agents', 'designer', 'slot-contracts'), join(clossysRoot, 'agents', 'designer', 'slot-contracts'), { recursive: true });
  await cp(join(clossys, 'library'), join(clossysRoot, 'library'), { recursive: true });
  await cp(join(clossys, 'selection.json'), join(clossysRoot, 'selection.json'));
  return { clossysRoot, outputDir, publisherRoot: join(clossysRoot, 'agents', 'publisher') };
}
async function replace(path, before, after) {
  const source = await readFile(path, 'utf8');
  assert.ok(source.includes(before), `${path} has ${before}`);
  await writeFile(path, source.replace(before, after));
}
const run = (options, extra = {}) => generateStudioMap({ clossysRoot: options.clossysRoot, outputDir: options.outputDir, ...extra });

// Locate the actual copied native slot through its IA, never through legacy cells.
async function selected(options, id) {
  const ia = JSON.parse(await readFile(join(options.publisherRoot, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) for (const child of node.children) if (child.slots.includes(id)) {
    const dir = join(options.publisherRoot, node.id, child.id, id);
    const pinPath = join(dir, 'pin.json'), pin = JSON.parse(await readFile(pinPath, 'utf8'));
    const path = join(dir, 'candidates', pin.candidate);
    return { path, pinPath, pin, record: JSON.parse(await readFile(path, 'utf8')) };
  }
  assert.fail(`Missing native fixture slot ${id}`);
}
async function editPinned(options, id, edit) {
  const value = await selected(options, id);
  edit(value.record);
  const bytes = `${JSON.stringify(value.record, null, 2)}\n`;
  await writeFile(value.path, bytes);
  await writeFile(value.pinPath, JSON.stringify({ ...value.pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
}
async function selectedBytes(options) {
  const ia = JSON.parse(await readFile(join(options.publisherRoot, 'ia.json'), 'utf8'));
  const records = await Promise.all(ia.nodes.flatMap(node => node.children.flatMap(child => child.slots)).map(id => selected(options, id)));
  return await Promise.all(records.flatMap(record => [readFile(record.path), readFile(record.pinPath)]));
}


test('every Studio page is a Publisher assembly: frame + ordered sections + bindings, from the native pinned map', async t => {
  const options = await fixture(t), projection = await run(options);
  const { map, routePack } = await readPinnedPublication(options.publisherRoot, 'studio');
  assert.deepEqual(projection.root, routePack.root);
  assert.equal(projection.homeId, routePack.homeRouteId);
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
    'frames.studio-shell', 'sections.module.checks', 'sections.module.explorer', 'sections.module.outline', 'sections.studio.agent-gallery', 'sections.studio.checks', 'sections.studio.contract', 'sections.studio.history', 'sections.studio.home',
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
  await editPinned(options, 'page.designer', record => { record.title = 'Visual design'; record.path = '/design'; });
  await assert.rejects(run(options, { check: true }), /drift/i);
  const changed = await run(options);
  assert.deepEqual(changed.routes.find(row => row.instanceId === 'designer'), { instanceId: 'designer', path: '/design', label: 'Visual design', entry: GENERIC_PAGE });
  assert.equal(changed.pages.find(page => page.id === 'designer').path, '/design');
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'designer' && row.label === 'Visual design' && row.href === '/design'));
  await run(options, { check: true });
});

test('pin changes select navigation without hiding command discovery', async t => {
  const options = await fixture(t);
  await editPinned(options, 'page.writer', record => {
    delete record.nav;
    if (record.meta.entry.entryMeta) delete record.meta.entry.entryMeta.pin;
  });
  const changed = await run(options);
  const nav = projectNavigation(changed.map, 'home');
  assert.ok(!nav.tree.flatMap(row => [row, ...(row.children ?? [])]).some(row => row.id === 'writer'));
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'writer'));
});

test('a section bound to anything but its contract input fails closed', async t => {
  const options = await fixture(t);
  await editPinned(options, 'page.designer', record => { record.meta.entry.blocks.Route.inputs['sections.studio.agent-gallery'] = 'cards'; });
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


test('a page manifest missing its explorer, modules or actions fails closed (mutation proof)', async t => {
  const mutations = [
    ['no manifest', route => { delete route.manifest; }, /declares no page manifest/],
    ['no explorer', route => { delete route.manifest.navigator; }, /needs an explorer or an outline/],
    ['explorer module removed', route => { route.manifest.modules = route.manifest.modules.filter(module => module.id !== 'explorer'); }, /explorer/],
    ['no modules', route => { route.manifest.modules = []; }, /declares no modules/],
    ['no actions', route => { route.manifest.actions = []; }, /declares no actions/],
    ['an action with no wiring line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => !line.do.startsWith('copy ')); }, /wiring/],
    ['a popover with no open line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'open checks'); }, /checks popover/],
    ['no escape close line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'key escape'); }, /closing a popover/],
    ['a shared shortcut', route => { route.manifest.actions[0].shortcut = route.manifest.modules[0].shortcut; }, /reuses the shortcut/],
    ['a retired module frame', route => { route.manifest.frame = 'frames.module'; }, /names frame/],
    ['a leaf with no outline', route => { delete route.leaf.manifest.navigator; }, /needs an explorer or an outline/],
  ];
  const clean = await fixture(t);
  await run(clean);
  for (const [label, edit, error] of mutations) {
    const options = await fixture(t);
    await editPinned(options, 'page.designer', record => edit(record.meta.entry.blocks.Route));
    await assert.rejects(run(options), error, label);
  }
});

test('checkManifest names what a manifest lacks', () => {
  assert.throws(() => checkManifest('page.x', undefined, {}), /declares no page manifest/);
  assert.throws(() => checkManifest('page.x', { navigator: 'explorer', modules: [], actions: [], wiring: [] }, {}), /declares no modules/);
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

test('intact native pins generate without legacy stores and preserve selected bytes', async t => {
  const options = await fixture(t), before = await selectedBytes(options);
  const expected = await run(options);
  for (const name of ['tree.json', 'cells', 'compile.json', 'content-map', 'route-pack']) {
    await rm(join(options.publisherRoot, name), { recursive: true, force: true });
  }
  assert.deepEqual(await run(options, { check: true }), expected);
  assert.deepEqual(await selectedBytes(options), before);
});

test('a missing native page pin rejects despite intact legacy stores', async t => {
  const options = await fixture(t), record = await selected(options, 'page.designer');
  await rm(record.pinPath);
  await assert.rejects(run(options), /pin.json.*Missing native record/);
});

test('selected candidate hash drift rejects despite intact legacy stores', async t => {
  const options = await fixture(t), record = await selected(options, 'page.designer');
  await replace(record.path, '"title": "Designer"', '"title": "Tampered"');
  await assert.rejects(run(options), /hash drift/);
});

test('unselected legacy compiled output cannot replace the pinned publication', async t => {
  const options = await fixture(t);
  const expected = await run(options);
  await mkdir(join(options.publisherRoot, 'route-pack'), { recursive: true });
  await writeFile(join(options.publisherRoot, 'route-pack/studio.json'), '{"routes":[]}');
  assert.deepEqual(await run(options, { check: true }), expected);
});

test('Foundry pinned Publisher inventory exposes the Studio publication and five authored pages', async () => {
  const { map, routePack } = await readPinnedPublication(join(clossys, 'agents', 'publisher'), 'studio');
  assert.equal(map.publicationId, 'studio');
  assert.equal(routePack.packId, 'studio');
  assert.deepEqual(map.entries.filter(entry => entry.kind === 'page').map(entry => entry.id).sort(), ['designer', 'director', 'home', 'publisher', 'writer']);
});
