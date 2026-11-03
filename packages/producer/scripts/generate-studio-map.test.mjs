import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPinnedPublication } from '@clossys/publisher/content-map/slots';
import { projectNavigation, projectCommands } from '@clossys/publisher/content-map';
import { HANDLERS, assemblyOf, checkManifest, generateStudioMap } from './generate-studio-map.mjs';

const clossys = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const GENERIC_PAGE = { file: 'studio/app/[[...route]]/page.tsx', export: 'default' };

/** A copy of the Studio records: pinned Publisher candidates, the Designer slot model, and the legacy library the draft preview still reads. */
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'studio-map-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clossysRoot = join(dir, 'clossys'), outputDir = join(dir, 'generated');
  await mkdir(join(clossysRoot, 'agents', 'designer'), { recursive: true });
  await cp(join(clossys, 'agents', 'publisher'), join(clossysRoot, 'agents', 'publisher'), { recursive: true });
  const designer = join(clossys, 'agents', 'designer'), copy = join(clossysRoot, 'agents', 'designer');
  const ia = JSON.parse(await readFile(join(designer, 'ia.json'), 'utf8'));
  await cp(join(designer, 'ia.json'), join(copy, 'ia.json'));
  for (const node of ia.nodes) for (const child of node.children) for (const slot of child.slots) {
    await cp(join(designer, node.id, child.id, slot), join(copy, node.id, child.id, slot), { recursive: true });
  }
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

async function designerSlot(options, id) {
  const root = join(options.clossysRoot, 'agents/designer');
  const ia = JSON.parse(await readFile(join(root, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) for (const child of node.children) if (child.slots.includes(id)) return join(root, node.id, child.id, id, 'slot.json');
  assert.fail(`Missing Designer slot ${id}`);
}

test('canonical Designer contracts work without the retired map and ignore a conflicting map', async t => {
  const options = await fixture(t);
  const expected = await run(options, { payloads: false });
  assert.ok(expected.pages.some(page => page.manifest.modules.some(module => module.section === 'sections.module.explorer')));
  for (const page of expected.pages) for (const module of page.manifest.modules) {
    if (module.section === 'sections.module.explorer') assert.equal(module.input, 'explorer');
  }
  const legacy = join(options.clossysRoot, 'agents/designer/slot-contracts');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'studio.json'), JSON.stringify([{ slot: 'sections.module.explorer', inputs: [{ name: 'poison' }] }]));
  assert.deepEqual(await run(options, { payloads: false }), expected);
  await editSlot(await designerSlot(options, 'sections.module.explorer'), doc => {
    doc.contract.inputs.unshift({ name: 'first', kind: 'data', required: true, description: 'First input' });
  });
  const changed = await run(options, { payloads: false });
  assert.ok(changed.pages.flatMap(page => page.manifest.modules).filter(module => module.section === 'sections.module.explorer').every(module => module.input === 'first'));
});

test('missing, malformed or foreign Designer slots and contracts refuse assembly', async t => {
  for (const [label, id, edit] of [
    ['missing slot', 'sections.module.explorer', async path => rm(path)],
    ['malformed slot', 'sections.module.explorer', async path => writeFile(path, '{')],
    ['foreign id', 'sections.module.explorer', async path => editSlot(path, doc => { doc.id = 'sections.module.outline'; })],
    ['foreign agent', 'sections.module.explorer', async path => editSlot(path, doc => { doc.agent = 'publisher'; })],
    ['foreign position', 'sections.module.explorer', async path => editSlot(path, doc => { doc.ia.order++; })],
    ['malformed slot schema', 'sections.module.explorer', async path => editSlot(path, doc => { doc.schema = 'wrong'; })],
    ['foreign contract', 'sections.module.explorer', async path => editSlot(path, doc => { doc.contract.slot = 'sections.module.outline'; })],
    ['malformed contract', 'sections.module.explorer', async path => editSlot(path, doc => { doc.contract.inputs = []; })],
    ['missing contract purpose', 'sections.module.explorer', async path => editSlot(path, doc => { delete doc.contract.purpose; })],
    ['invalid input kind', 'sections.module.explorer', async path => editSlot(path, doc => { doc.contract.inputs[0].kind = 'invalid'; })],
    ['missing frame contract', 'frames.studio-shell', async path => editSlot(path, doc => { doc.contract = {}; })],
  ]) {
    const options = await fixture(t);
    await edit(await designerSlot(options, id));
    await assert.rejects(run(options, { payloads: false }), undefined, label);
  }
});

test('missing or malformed Designer IA refuses assembly', async t => {
  for (const edit of [path => rm(path), path => writeFile(path, '{}')]) {
    const options = await fixture(t);
    await edit(join(options.clossysRoot, 'agents/designer/ia.json'));
    await assert.rejects(run(options, { payloads: false }), /Designer IA is missing|Invalid designer IA/);
  }
});

async function editSlot(path, edit) {
  const doc = JSON.parse(await readFile(path, 'utf8'));
  edit(doc);
  await writeFile(path, JSON.stringify(doc));
}

async function writerCallerFixture(t) {
  const options = await fixture(t);
  const writer = join(options.clossysRoot, 'agents/writer');
  const placement = 'strings.interface/interface-field-labels/strings.common';
  const dir = join(writer, placement);
  await mkdir(join(dir, 'candidates'), { recursive: true });
  await writeFile(join(writer, 'ia.json'), JSON.stringify({ nodes: [
    { id: 'strings.interface', children: [{ id: 'interface-field-labels', slots: ['strings.common'] }] },
  ] }));
  const replacements = {
    'frames.studio-shell': 7,
    'sections.studio.home': 3,
    'sections.studio.agent-gallery': 5,
    'sections.studio.leaf-header': 2,
    'sections.studio.specimen': 4,
  };
  const selection = JSON.parse(await readFile(join(options.clossysRoot, 'selection.json'), 'utf8'));
  const previewItems = await Promise.all(Object.entries(selection.pins).map(async ([slot, pin]) => {
    const version = replacements[slot] ?? pin.version;
    const record = JSON.parse(await readFile(join(options.clossysRoot, 'library', slot, pin.element, `v${version}`, 'element.json'), 'utf8'));
    return { slot, element: pin.element, version, hash: record.hash };
  }));
  assert.equal(previewItems.length, 14);
  async function candidate(text, version, pin = false) {
    const name = `studio-v${version}.md`;
    const bytes = `---\nslot: "strings.common"\nlocales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n## en\n\n### studio.greeting\n<!-- {"id":"studio.greeting","bindings":["test"]} -->\n${text}\n`;
    await writeFile(join(dir, 'candidates', name), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (pin) await writeFile(join(dir, 'pin.json'), JSON.stringify({ candidate: name, sha256 }));
    return { placement, candidate: name, version: String(version), sha256 };
  }
  async function generate(preview) {
    // Only the default path skips old Designer payload parity. Preview validates all 14 native bindings.
    const projection = await run(options, preview ? { target: 'preview', previewItems } : { payloads: false });
    if (preview) {
      assert.equal(projection.items.length, 14);
      assert.equal(projection.assembly.status, 'DRAFT');
      for (const item of projection.items) {
        assert.equal(item.previewEvidence.status, 'DRAFT');
        assert.equal(item.previewEvidence.approved, false);
        assert.equal(item.previewEvidence.selectionGranted, false);
      }
    }
    return JSON.parse(await readFile(join(options.outputDir, 'studio-copy.json'), 'utf8'));
  }
  return { dir, candidate, generate };
}

test('Studio Writer caller keeps absent pins empty by default and projects drafts only in explicit preview', async t => {
  const f = await writerCallerFixture(t);
  const selected = await f.candidate('Preview greeting', 1);
  assert.deepEqual((await f.generate(false)).entries, []);
  const preview = await f.generate(true);
  assert.deepEqual(preview.entries, [{ id: 'studio.greeting', text: 'Preview greeting', context: 'test', status: 'draft' }]);
  assert.deepEqual(JSON.parse(preview.source.reference.split('#')[1]), [{ ...selected, selectedBy: 'absent-pin-preview' }]);
});

test('Studio Writer caller honors a valid pin over a newer draft in default and preview generation', async t => {
  const f = await writerCallerFixture(t);
  const selected = await f.candidate('Pinned greeting', 1, true);
  await f.candidate('Newer draft', 2);
  for (const preview of [false, true]) {
    const copy = await f.generate(preview);
    assert.deepEqual(copy.entries, [{ id: 'studio.greeting', text: 'Pinned greeting', context: 'test', status: 'draft' }]);
    if (preview) assert.deepEqual(JSON.parse(copy.source.reference.split('#')[1]), [{ ...selected, selectedBy: 'pin' }]);
  }
});

test('Studio Writer caller refuses malformed present pins and wrong hashes in default and preview generation', async t => {
  const f = await writerCallerFixture(t);
  await f.candidate('Greeting', 1);
  for (const [pin, error] of [
    [{ candidate: '../studio-v1.md' }, /Invalid Studio Writer pin/],
    [{ candidate: 'studio-v1.md', sha256: '0'.repeat(64) }, /Studio Writer pin hash mismatch/],
  ]) {
    await writeFile(join(f.dir, 'pin.json'), JSON.stringify(pin));
    for (const preview of [false, true]) await assert.rejects(f.generate(preview), error);
  }
});

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


async function nativeFixture(t) {
  const options = await fixture(t);
  for (const name of ['tree.json', 'cells', 'compile.json', 'content-map', 'route-pack']) {
    await rm(join(options.publisherRoot, name), { recursive: true, force: true });
  }
  return options;
}

const PAGE_NAMES = ['home', 'director', 'designer', 'writer', 'publisher'];
const pageSlot = name => join('studio', name === 'home' ? 'studio.pages' : 'agents', `page.${name}`);
const withoutCopyLink = route => {
  const next = structuredClone(route);
  for (const manifest of [next.manifest, ...(next.leaf ? [next.leaf.manifest] : [])]) {
    manifest.actions = manifest.actions.filter(action => action.id !== 'copy-link');
    manifest.wiring = manifest.wiring.filter(line => !['open copy-link', 'copy copy-link'].includes(line.do));
  }
  return next;
};

test('L16 v3 records remove only Copy link and retain the request-change prompt and other popovers', async t => {
  const options = await nativeFixture(t), root = options.publisherRoot;
  const { routePack } = await readPinnedPublication(root, 'studio');
  const contracts = new Map(JSON.parse(await readFile(join(clossys, 'agents/designer/slot-contracts/studio.json'), 'utf8')).map(contract => [contract.slot, contract]));
  assert.deepEqual(HANDLERS, ['copy-prompt']);
  for (const name of PAGE_NAMES) {
    const oldCandidate = JSON.parse(await readFile(join(root, pageSlot(name), 'candidates/page-v2.json'), 'utf8'));
    const candidate = JSON.parse(await readFile(join(root, pageSlot(name), 'candidates/page-v3.json'), 'utf8'));
    const expected = structuredClone(oldCandidate);
    expected.meta.entry.blocks.Route = withoutCopyLink(expected.meta.entry.blocks.Route);
    assert.deepEqual(candidate, expected, `${name}: all other candidate data is preserved`);
    assert.equal((await selected(options, `page.${name}`)).pin.candidate, 'page-v3.json');
    const route = candidate.meta.entry.blocks.Route;
    assert.deepEqual(route, withoutCopyLink(oldCandidate.meta.entry.blocks.Route), `${name}: all other Route data is preserved`);
    const { instanceId, path, label, keywords, ...projectedRoute } = routePack.routes.find(route => route.instanceId === name);
    assert.deepEqual(projectedRoute, route, `${name}: native projection retains canonical Route metadata`);
    const entry = { id: name, path: candidate.path, title: candidate.title, source: { frameId: candidate.frame, sectionIds: candidate.sections } };
    const page = assemblyOf(entry, route, contracts);
    assert.doesNotMatch(JSON.stringify(page), /copy-link/);
    assert.deepEqual(page.manifest.actions, []);
    if (page.leaf) {
      assert.deepEqual(page.leaf.manifest.actions.map(action => action.id), ['request-change']);
      assert.equal(page.leaf.manifest.actions[0].handler.kind, 'copy-prompt');
      assert.match(page.leaf.manifest.actions[0].handler.prompt, /What should change/);
      assert.ok(page.leaf.manifest.wiring.some(line => line.do === 'copy request-change' && line.expect === 'clipboard prompt'));
    }
  }
});

test('L16 active generation contains no copy-link and leaves native candidate history and pins byte-identical', async t => {
  const options = await nativeFixture(t);
  const paths = PAGE_NAMES.flatMap(name => [1, 2, 3].map(version =>
    join(options.publisherRoot, pageSlot(name), 'candidates', `page-v${version}.json`)));
  const pinsBefore = await selectedBytes(options);
  const before = await Promise.all(paths.map(path => readFile(path)));
  const projection = await run(options);
  assert.doesNotMatch(JSON.stringify(projection), /copy-link/);
  assert.doesNotMatch(JSON.stringify(projectCommands(projection.map)), /copy-link/);
  assert.doesNotMatch(await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8'), /copy-link/);
  for (let i = 0; i < paths.length; i++) assert.deepEqual(await readFile(paths[i]), before[i], paths[i]);
  assert.deepEqual(await selectedBytes(options), pinsBefore);
});

test('L16 rejects a restored copy-link kind, a renamed copy-link action and stale wiring on every page and leaf', async t => {
  const options = await nativeFixture(t);
  const contracts = new Map(JSON.parse(await readFile(join(clossys, 'agents/designer/slot-contracts/studio.json'), 'utf8')).map(contract => [contract.slot, contract]));
  for (const name of PAGE_NAMES) {
    const route = (await selected(options, `page.${name}`)).record.meta.entry.blocks.Route;
    for (const original of [route.manifest, ...(route.leaf ? [route.leaf.manifest] : [])]) {
      const restored = structuredClone(original);
      restored.actions.push({ id: 'restored-link', label: 'Copy link', icon: 'assets.icon-link', shortcut: 'l', handler: { kind: 'copy-link' } });
      restored.wiring.push({ do: 'open restored-link', expect: 'restored-link open' }, { do: 'copy restored-link', expect: 'clipboard link' });
      assert.throws(() => checkManifest(name, restored, contracts), /has no copy handler/);
      restored.actions.at(-1).id = 'copy-link';
      restored.actions.at(-1).handler = { kind: 'copy-prompt', prompt: '{url}' };
      assert.throws(() => checkManifest(name, restored, contracts), /retired copy-link action/);
      const stale = structuredClone(original);
      stale.wiring.push({ do: 'open copy-link', expect: 'copy-link open' });
      assert.throws(() => checkManifest(name, stale, contracts), /unknown popover copy-link/);
    }
  }
});

test('L16 browser manifest preflight permits action-free pages and detects copy-link restoration', async t => {
  const options = await nativeFixture(t);
  const { manifestFindings } = await import('../studio/checks/studio-modules-check.mjs');
  const pages = await Promise.all(PAGE_NAMES.map(async name => {
    const route = (await selected(options, `page.${name}`)).record.meta.entry.blocks.Route;
    return { id: name, manifest: route.manifest, ...(route.leaf ? { leaf: { manifest: route.leaf.manifest } } : {}) };
  }));
  assert.deepEqual(manifestFindings(pages), []);
  for (const page of pages) {
    for (const leaf of [false, ...(page.leaf ? [true] : [])]) {
      const changed = structuredClone(page);
      const manifest = leaf ? changed.leaf.manifest : changed.manifest;
      manifest.actions.push({ id: 'copy-link', handler: { kind: 'copy-link' } });
      assert.ok(manifestFindings([changed]).some(finding => finding.rule === 'unsupported-action'), `${page.id} ${leaf ? 'leaf' : 'page'}`);
      if (leaf) {
        manifest.actions = [];
        assert.ok(manifestFindings([changed]).some(finding => finding.missing === 'request-change'));
      }
    }
  }
});

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

/** The fixture folder of one Designer slot, with its pin and the pinned candidate's path. */
async function pinnedDesignerSlot(options, id) {
  const copy = join(options.clossysRoot, 'agents', 'designer');
  const ia = JSON.parse(await readFile(join(copy, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) for (const child of node.children) if (child.slots.includes(id)) {
    const dir = join(copy, node.id, child.id, id), pin = JSON.parse(await readFile(join(dir, 'pin.json'), 'utf8'));
    return { dir, pin, candidate: join(dir, 'candidates', pin.candidate) };
  }
  throw new Error(`no Designer slot ${id}`);
}
/** Rewrite a pinned candidate and re-pin its new bytes, as an owner pin of an edited candidate would. */
async function editCandidate(options, id, edit) {
  const slot = await pinnedDesignerSlot(options, id), item = JSON.parse(await readFile(slot.candidate, 'utf8'));
  edit(item);
  const bytes = `${JSON.stringify(item, null, 2)}\n`;
  await writeFile(slot.candidate, bytes);
  await writeFile(join(slot.dir, 'pin.json'), JSON.stringify({ ...slot.pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
  return slot;
}

test('a slot with no pin, a tampered candidate, or an item with no trusted reference fails closed', async t => {
  const options = await fixture(t);
  const slot = await pinnedDesignerSlot(options, 'sections.studio.history');
  await replace(slot.candidate, '"kind": "derived"', '"kind": "original"');
  await assert.rejects(run(options), /pin hash/);
  await editCandidate(options, 'sections.studio.history', item => { item.meta.source = { kind: 'original', ref: [] }; });
  await assert.rejects(run(options), /trusted reference/);
  await rm(join(slot.dir, 'pin.json'));
  await assert.rejects(run(options), /no pin/);
});

test('Draft assembly requires an explicit preview target and complete native bindings', async t => {
  const options = await fixture(t);
  await assert.rejects(run(options, { previewItems: [] }), /explicit preview target/);
  await assert.rejects(run(options, { target: 'preview' }), /explicit native bindings/);
  await assert.rejects(run(options, { target: 'preview', previewItems: [] }), /explicit native bindings/);
});


test('a page manifest missing its explorer, modules or actions array fails closed (mutation proof)', async t => {
  const mutations = [
    ['no manifest', route => { delete route.manifest; }, /declares no page manifest/],
    ['no explorer', route => { delete route.manifest.navigator; }, /needs an explorer or an outline/],
    ['explorer module removed', route => { route.manifest.modules = route.manifest.modules.filter(module => module.id !== 'explorer'); }, /explorer/],
    ['no modules', route => { route.manifest.modules = []; }, /declares no modules/],
    ['no actions array', route => { delete route.manifest.actions; }, /needs an actions array/],
    ['an action with no wiring line', route => { route.leaf.manifest.wiring = route.leaf.manifest.wiring.filter(line => !line.do.startsWith('copy ')); }, /wiring/],
    ['a popover with no open line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'open checks'); }, /checks popover/],
    ['no escape close line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'key escape'); }, /closing a popover/],
    ['a shared shortcut', route => { route.leaf.manifest.actions[0].shortcut = route.leaf.manifest.modules[0].shortcut; }, /reuses the shortcut/],
    ['a retired module frame', route => { route.manifest.frame = 'frames.module'; }, /names frame/],
    ['a leaf with no request-change', route => { route.leaf.manifest.actions = []; route.leaf.manifest.wiring = route.leaf.manifest.wiring.filter(line => !line.do.includes('request-change')); }, /needs the request-change prompt action/],
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

test('Studio runs exactly the pinned payload: code that drifts from the pinned candidate fails', async t => {
  const options = await fixture(t);
  await run(options);
  await editCandidate(options, 'sections.studio.checks', item => {
    const file = item.files.find(entry => entry.path === 'index.tsx');
    assert.ok(file.content.includes('data-studio-section="checks"'));
    file.content = file.content.replace('data-studio-section="checks"', 'data-studio-section="drifted"');
  });
  await assert.rejects(run(options), /index.tsx differs from studio-checks v2 as pinned/);
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
