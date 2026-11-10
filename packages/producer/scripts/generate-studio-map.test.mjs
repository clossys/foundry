import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPinnedPublication } from '../dist/publish/pinned-publication.js';
import { projectNavigation, projectCommands } from '@clossys/publisher/content-map';
import { HANDLERS, assemblyOf, checkManifest, designerContracts, generateStudioMap } from './generate-studio-map.mjs';
import { pinnedBindings } from './studio-draft-items.mjs';

const clossys = fileURLToPath(new URL('../../../clossys/', import.meta.url));
/** Every Designer slot the Studio pages assemble. */
const STUDIO_SLOTS = ['frames.studio-shell', ...['checks', 'outline'].map(id => `sections.module.${id}`),
  ...['pipeline-flow', 'pipeline-legend', 'system-empty', 'team-strip'].map(id => `sections.producer.${id}`),
  ...['checks', 'contract', 'history', 'home', 'leaf-header', 'options', 'page-header', 'page-tabs', 'references', 'slot-groups', 'specimen'].map(id => `sections.studio.${id}`)];
/** The route files Publisher installs for one Studio page: its page and, for a gallery, its leaf template. */
const installedEntry = (instanceId, path, label, leaf = true) => {
  const folder = path === '/' ? '' : `${path.slice(1)}/`;
  return { instanceId, path, label, entry: { file: `studio/app/${folder}page.tsx`, export: 'default' },
    ...(leaf ? { leaf: { path: `${path}/[slug]`, entry: { file: `studio/app/${folder}[slug]/page.tsx`, export: 'default' } } } : {}) };
};

/** A copy of the Studio records: pinned Publisher candidates and the Designer slot model. */
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
    await cp(join(designer, slot), join(copy, slot), { recursive: true });
  }
  // Parameterized page records expand through each agent's IA, so the fixture carries every ia.json;
  // the generator binds every visible string to the pinned Writer copy, so it carries the Writer slots too.
  await mkdir(join(clossysRoot, 'agents', 'director'), { recursive: true });
  await cp(join(clossys, 'agents', 'director', 'ia.json'), join(clossysRoot, 'agents', 'director', 'ia.json'));
  await cp(join(clossys, 'agents', 'writer'), join(clossysRoot, 'agents', 'writer'), { recursive: true });
  return { clossysRoot, outputDir, appDir: join(dir, 'app'), installOut: join(dir, 'install'), publisherRoot: join(clossysRoot, 'agents', 'publisher') };
}
async function replace(path, before, after) {
  const source = await readFile(path, 'utf8');
  assert.ok(source.includes(before), `${path} has ${before}`);
  await writeFile(path, source.replace(before, after));
}
const run = (options, extra = {}) => generateStudioMap({ clossysRoot: options.clossysRoot, outputDir: options.outputDir, appDir: options.appDir, installOut: options.installOut, ...extra });

async function designerSlot(options, id) {
  const root = join(options.clossysRoot, 'agents/designer');
  const ia = JSON.parse(await readFile(join(root, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) for (const child of node.children) if (child.slots.includes(id)) return join(root, id, 'slot.json');
  assert.fail(`Missing Designer slot ${id}`);
}

test('canonical Designer contracts work without the retired map and ignore a conflicting map', async t => {
  const options = await fixture(t);
  const expected = await run(options, { payloads: false });
  assert.ok(expected.pages.some(page => page.manifest.modules.some(module => module.section === 'sections.module.outline')));
  for (const page of expected.pages) for (const module of page.manifest.modules) {
    if (module.section === 'sections.module.outline') assert.equal(module.input, 'outline');
  }
  const legacy = join(options.clossysRoot, 'agents/designer/slot-contracts');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'studio.json'), JSON.stringify([{ slot: 'sections.module.outline', inputs: [{ name: 'poison' }] }]));
  assert.deepEqual(await run(options, { payloads: false }), expected);
  await editSlot(await designerSlot(options, 'sections.module.outline'), doc => {
    doc.contract.inputs.unshift({ name: 'first', kind: 'data', required: true, description: 'First input' });
  });
  const changed = await run(options, { payloads: false });
  assert.ok(changed.pages.flatMap(page => page.manifest.modules).filter(module => module.section === 'sections.module.outline').every(module => module.input === 'first'));
});

test('missing, malformed or foreign Designer slots and contracts refuse assembly', async t => {
  for (const [label, id, edit] of [
    ['missing slot', 'sections.module.outline', async path => rm(path)],
    ['malformed slot', 'sections.module.outline', async path => writeFile(path, '{')],
    ['foreign id', 'sections.module.outline', async path => editSlot(path, doc => { doc.id = 'sections.module.checks'; })],
    ['foreign agent', 'sections.module.outline', async path => editSlot(path, doc => { doc.agent = 'publisher'; })],
    ['foreign position', 'sections.module.outline', async path => editSlot(path, doc => { doc.ia.order++; })],
    ['malformed slot schema', 'sections.module.outline', async path => editSlot(path, doc => { doc.schema = 'wrong'; })],
    ['foreign contract', 'sections.module.outline', async path => editSlot(path, doc => { doc.contract.slot = 'sections.module.checks'; })],
    ['malformed contract', 'sections.module.outline', async path => editSlot(path, doc => { doc.contract.inputs = []; })],
    ['missing contract purpose', 'sections.module.outline', async path => editSlot(path, doc => { delete doc.contract.purpose; })],
    ['invalid input kind', 'sections.module.outline', async path => editSlot(path, doc => { doc.contract.inputs[0].kind = 'invalid'; })],
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
    await assert.rejects(run(options, { payloads: false }), /Designer IA is missing|Invalid designer IA|designer has no ia\.json/);
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
  const dir = join(writer, 'strings.common');
  // The fixture carries the real Writer slots; this caller owns strings.common, starting with no pin and no candidate.
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'candidates'), { recursive: true });
  // The real Writer IA and its other pinned strings.* slots stay (every strings.* slot is Studio copy and the
  // page titles resolve through them); this caller places only strings.common, the slot under test.
  const previewItems = await pinnedBindings(options.clossysRoot, STUDIO_SLOTS);
  assert.equal(previewItems.length, STUDIO_SLOTS.length);
  // Draft binds what the slot model pins: options v8 and specimen v12 (stock re-adoption, planner:R2F-03).
  assert.deepEqual(previewItems.filter(row => /studio\.(options|specimen)$/.test(row.slot)).map(row => [row.slot, row.version]), [['sections.studio.options', 8], ['sections.studio.specimen', 12]]);
  async function candidate(text, version, pin = false) {
    const name = `studio-v${version}.md`;
    const bytes = `---\nslot: "strings.common"\nlocales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n## en\n\n### studio.greeting\n<!-- {"id":"studio.greeting","bindings":["test"]} -->\n${text}\n`;
    await writeFile(join(dir, 'candidates', name), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (pin) await writeFile(join(dir, 'pin.json'), JSON.stringify({ candidate: name, sha256 }));
    return { placement, candidate: name, version: String(version), sha256 };
  }
  async function generate(preview) {
    // Only the default path skips old Designer payload parity. Preview validates every native binding.
    const projection = await run(options, preview ? { target: 'preview', previewItems } : { payloads: false });
    if (preview) {
      assert.equal(projection.items.length, STUDIO_SLOTS.length);
      assert.equal(projection.assembly.status, 'DRAFT');
      for (const item of projection.items) {
        assert.equal(item.previewEvidence.status, 'DRAFT');
        assert.equal(item.previewEvidence.approved, false);
        assert.equal(item.previewEvidence.pinGranted, false);
        assert.equal(item.previewEvidence.matchesPin, true);
      }
    }
    const copy = JSON.parse(await readFile(join(options.outputDir, 'studio-copy.json'), 'utf8'));
    // Only what the slot under test contributes: its key and its recorded source row.
    return { entries: copy.entries.filter(entry => entry.id === 'studio.greeting'),
      sources: preview ? JSON.parse(copy.source.reference.split('#')[1]).filter(row => row.placement === placement) : undefined };
  }
  return { dir, candidate, generate };
}

test('Studio Writer caller keeps absent pins empty by default and projects drafts only in explicit preview', async t => {
  const f = await writerCallerFixture(t);
  const selected = await f.candidate('Preview greeting', 1);
  assert.deepEqual((await f.generate(false)).entries, []);
  const preview = await f.generate(true);
  assert.deepEqual(preview.entries, [{ id: 'studio.greeting', text: 'Preview greeting', context: 'test', status: 'draft' }]);
  assert.deepEqual(preview.sources, [{ ...selected, selectedBy: 'absent-pin-preview' }]);
});

test('Studio Writer caller honors a valid pin over a newer draft in default and preview generation', async t => {
  const f = await writerCallerFixture(t);
  const selected = await f.candidate('Pinned greeting', 1, true);
  await f.candidate('Newer draft', 2);
  for (const preview of [false, true]) {
    const copy = await f.generate(preview);
    assert.deepEqual(copy.entries, [{ id: 'studio.greeting', text: 'Pinned greeting', context: 'test', status: 'draft' }]);
    if (preview) assert.deepEqual(copy.sources, [{ ...selected, selectedBy: 'pin' }]);
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
    const dir = join(options.publisherRoot, id);
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
async function editWriterPinned(options, id, edit) {
  const dir = join(options.clossysRoot, 'agents/writer', id), pinPath = join(dir, 'pin.json');
  const pin = JSON.parse(await readFile(pinPath, 'utf8')), path = join(dir, 'candidates', pin.candidate);
  const before = await readFile(path, 'utf8'), bytes = edit(before);
  assert.notEqual(bytes, before, `${id}: the Writer edit applies`);
  await writeFile(path, bytes);
  await writeFile(pinPath, JSON.stringify({ ...pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
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

/** The pinned Publisher page records: one per Studio page, parameterized records expand into tabs and leaves. */
const PAGE_NAMES = ['home', 'producer-pipeline',
  ...['context', 'aspiration', 'focus', 'advantage', 'identity', 'capability', 'execution'].map(ns => `director-${ns}`),
  ...['themes', 'assets', 'components', 'sections', 'frames'].map(ns => `designer-${ns}`),
  ...['lexicon', 'strings', 'patterns', 'passages', 'narratives'].map(ns => `writer-${ns}`),
  'publisher-studio', 'build-overview', 'run-overview'];
const pageSlot = name => `page.${name}`;
/** Every route the pinned publication declares, with its content-map entry. */
async function pinnedRoutes(options) {
  const { map, routePack } = await readPinnedPublication(options.clossysRoot, 'studio');
  return routePack.routes.map(route => ({ route, entry: map.entries.find(entry => entry.id === route.instanceId) }));
}

test('L16 pinned records carry no Copy link and keep the request-change prompt on every leaf', async t => {
  const options = await nativeFixture(t);
  const contracts = designerContracts(clossys);
  assert.deepEqual(HANDLERS, ['copy-prompt']);
  const routes = await pinnedRoutes(options);
  assert.deepEqual(routes.map(({ route }) => route.instanceId), PAGE_NAMES);
  const leafless = [];
  for (const { route, entry } of routes) {
    const page = assemblyOf(entry, route, contracts);
    assert.doesNotMatch(JSON.stringify(page), /copy-link/);
    assert.deepEqual(page.manifest.actions, [], `${entry.id}: pages are action-free`);
    if (page.leaf) {
      assert.deepEqual(page.leaf.manifest.actions.map(action => action.id), ['request-change']);
      assert.equal(page.leaf.manifest.actions[0].handler.kind, 'copy-prompt');
      // The prompt is Writer copy: the record names its key and the pinned Writer text resolves it.
      assert.equal(page.leaf.manifest.actions[0].handler.prompt, 'studio.request-change-prompt');
      assert.ok(page.leaf.manifest.wiring.some(line => line.do === 'copy request-change' && line.expect === 'clipboard prompt'));
    } else leafless.push(entry.id);
  }
  // Galleries carry the leaf template; Home, the Pipeline and the Build and Run overviews are single pages.
  assert.deepEqual(leafless, ['home', 'producer-pipeline', 'build-overview', 'run-overview']);
});

test('L16 active generation contains no copy-link and leaves native candidates and pins byte-identical', async t => {
  const options = await nativeFixture(t);
  const paths = (await Promise.all(PAGE_NAMES.map(async name => {
    const dir = join(options.publisherRoot, pageSlot(name), 'candidates');
    return (await readdir(dir)).map(file => join(dir, file));
  }))).flat();
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
  const contracts = designerContracts(clossys);
  for (const { route } of await pinnedRoutes(options)) {
    const name = route.instanceId;
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
  const pages = (await pinnedRoutes(options)).map(({ route }) =>
    ({ id: route.instanceId, manifest: route.manifest, ...(route.leaf ? { leaf: { manifest: route.leaf.manifest } } : {}) }));
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

test('every Studio page is a Publisher assembly: frame + ordered sections + bindings, from the expanded native pinned map', async t => {
  const options = await fixture(t), projection = await run(options);
  const { routePack } = await readPinnedPublication(options.clossysRoot, 'studio');
  assert.deepEqual(projection.root, routePack.root);
  assert.equal(projection.homeId, routePack.homeRouteId);
  // The map is the content-map expansion: every authored record, one page per IA group (tab) beneath it.
  const pageIds = projection.map.entries.filter(row => row.kind === 'page').map(row => row.id);
  assert.deepEqual(projection.pages.map(page => page.id), pageIds);
  assert.deepEqual(pageIds.slice(0, PAGE_NAMES.length), PAGE_NAMES);
  for (const page of projection.pages) assert.equal(page.frameId, 'frames.studio-shell', page.id);
  // The agent groups sit beneath Content; Build and Run are top-level groups of their own.
  assert.deepEqual(projection.map.entries.filter(row => row.kind === 'group' && !row.parentId).map(row => row.id), ['content', 'build', 'run']);
  assert.deepEqual(projection.pages.find(page => page.id === 'home').sectionIds, ['sections.studio.page-header', 'sections.studio.home']);
  assert.deepEqual(projection.pages.find(page => page.id === 'publisher-studio').sectionIds, ['sections.studio.page-header', 'sections.studio.page-tabs', 'sections.studio.slot-groups']);
  const leafPages = projection.pages.filter(page => page.leaf);
  assert.ok(leafPages.length && leafPages.every(page => PAGE_NAMES.some(name => page.id.startsWith(`${name}.`))), 'leaf templates sit on the expanded tabs');
  for (const page of leafPages) {
    assert.equal(page.leaf.body, 'detail');
    assert.equal(page.leaf.sectionIds[0], 'sections.studio.leaf-header');
    for (const slot of ['sections.studio.specimen', 'sections.studio.options', 'sections.studio.history', 'sections.studio.references']) assert.ok(page.leaf.sectionIds.includes(slot));
  }
  // Publisher installs every route: one marked page per map page and a dynamic leaf route per tab.
  assert.deepEqual(projection.routes.map(({ instanceId, path, label, entry, leaf }) => ({ instanceId, path, label, entry, ...(leaf ? { leaf } : {}) })),
    projection.pages.map(page => installedEntry(page.id, page.path, page.title, Boolean(page.leaf))));
  assert.deepEqual(projection.routes.find(row => row.instanceId === 'designer-themes.colors'), installedEntry('designer-themes.colors', '/designer/themes/colors', 'Colors'));
  assert.ok(projection.leaves.some(row => row.page === 'designer-themes.colors' && row.path === `/designer/themes/colors/${row.slug}`));
  const { NEXT_ROUTE_MARKER } = await import('@clossys/publisher/install');
  for (const route of projection.routes) for (const file of [route.entry.file, route.leaf?.entry.file].filter(Boolean)) {
    assert.equal((await readFile(join(options.appDir, file.slice('studio/app/'.length)), 'utf8')).split('\n', 1)[0], NEXT_ROUTE_MARKER, file);
  }
  const report = JSON.parse(await readFile(join(options.installOut, 'install-report.json'), 'utf8'));
  assert.deepEqual([report.kind, report.publication], ['next', 'studio']);
  assert.deepEqual([...new Set(report.pages.map(row => row.page))], pageIds);
  for (const page of projection.map.entries.filter(row => row.kind === 'page')) assert.deepEqual(projection.pageActions[page.id], page.actions ?? []);
  assert.deepEqual(projection.items.map(item => item.slot).sort(), [...STUDIO_SLOTS].sort());
  const bindings = await readFile(join(options.outputDir, 'assembly-bindings.ts'), 'utf8');
  assert.match(bindings, /"frames\.studio-shell": marked\(Frame0, /);
  for (const item of projection.items.filter(row => row.slot.startsWith('sections.'))) assert.match(bindings, new RegExp(`from "\\.\\./sections/${item.element}"`));
  const module = await readFile(join(options.outputDir, 'studio-map.ts'), 'utf8');
  assert.match(module, /export const studioPageActions = projection\.pageActions/);
  await run(options, { check: true });
});

test('active title and path edits drive the map, the page records and the commands', async t => {
  const options = await fixture(t);
  await run(options);
  // A page title is a Writer key: a literal title in the page record is refused, never shown.
  await editPinned(options, 'page.designer-themes', record => { record.title = 'Visual design'; });
  await assert.rejects(run(options, { check: true }), /designer-themes title is a literal "Visual design"; it must be a Writer key/);
  // A title edit is a Writer edit; a path edit is a page-record edit.
  await editPinned(options, 'page.designer-themes', record => { record.title = 'studio.page.designer-themes'; record.path = '/designer/design'; });
  await editWriterPinned(options, 'strings.page-titles', text => text.replace('"studio.page.designer-themes","bindings":[]} -->\nThemes\n', '"studio.page.designer-themes","bindings":[]} -->\nVisual design\n'));
  await assert.rejects(run(options, { check: true }), /drift/i);
  const changed = await run(options);
  assert.deepEqual(changed.routes.find(row => row.instanceId === 'designer-themes'), installedEntry('designer-themes', '/designer/design', 'Visual design', false));
  // The reinstall moves the tab and the leaf templates beneath it, and removes the stale marked files.
  await readFile(join(options.appDir, 'designer/design/page.tsx'), 'utf8');
  await readFile(join(options.appDir, 'designer/design/colors/[slug]/page.tsx'), 'utf8');
  await assert.rejects(readFile(join(options.appDir, 'designer/themes/page.tsx'), 'utf8'), { code: 'ENOENT' });
  assert.equal(changed.pages.find(page => page.id === 'designer-themes').path, '/designer/design');
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'designer-themes' && row.label === 'Visual design' && row.href === '/designer/design'));
  await run(options, { check: true });
});

test('pin changes select navigation without hiding command discovery', async t => {
  const options = await fixture(t);
  await editPinned(options, 'page.writer-lexicon', record => {
    delete record.nav;
    if (record.meta.entry.entryMeta) delete record.meta.entry.entryMeta.pin;
  });
  const changed = await run(options);
  const nav = projectNavigation(changed.map, 'home');
  assert.ok(!nav.tree.flatMap(row => [row, ...(row.children ?? [])]).some(row => row.id === 'writer-lexicon'));
  assert.ok(projectCommands(changed.map).flatMap(row => row.items).some(row => row.id === 'writer-lexicon'));
});

test('a section bound to anything but its contract input fails closed', async t => {
  const options = await fixture(t);
  await editPinned(options, 'page.designer-themes', record => { record.meta.entry.blocks.Route.inputs['sections.studio.slot-groups'] = 'cards'; });
  await assert.rejects(run(options), /contract input is "groups"/);
});

/** The fixture folder of one Designer slot, with its pin and the pinned candidate's path. */
async function pinnedDesignerSlot(options, id) {
  const copy = join(options.clossysRoot, 'agents', 'designer');
  const ia = JSON.parse(await readFile(join(copy, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) for (const child of node.children) if (child.slots.includes(id)) {
    const dir = join(copy, id), pin = JSON.parse(await readFile(join(dir, 'pin.json'), 'utf8'));
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
  await replace(slot.candidate, '"kind": "composition"', '"kind": "original"');
  await assert.rejects(run(options), /pin hash/);
  await editCandidate(options, 'sections.studio.history', item => { item.meta.source = { kind: 'original', ref: [] }; });
  await assert.rejects(run(options), /trusted reference/);
  await editCandidate(options, 'sections.studio.history', item => { item.meta.source = { kind: 'composition', ref: [], parts: [] }; });
  await assert.rejects(run(options), /must declare its stock parts/);
  await editCandidate(options, 'sections.studio.history', item => { item.meta.source = { kind: 'composition', ref: [], parts: [{ slot: 'sections.studio.home', files: ['index.tsx'] }] }; });
  await assert.rejects(run(options), /not pinned with registry or npm \(stock\) lineage/);
  await rm(join(slot.dir, 'pin.json'));
  await assert.rejects(run(options), /no pin/);
});

test('an installed component slot shares the trust rule: stock compositions install, anything else fails closed', async t => {
  const options = await fixture(t);
  // This case needs a run that reaches component installs, so it carries the pinned Writer store too.
  await cp(join(clossys, 'agents', 'writer'), join(options.clossysRoot, 'agents', 'writer'), { recursive: true });
  await editCandidate(options, 'components.studio.card-grid', item => { item.meta.source = { kind: 'original', ref: [] }; });
  await assert.rejects(run(options), /components\.studio\.card-grid must come from a trusted reference/);
  await editCandidate(options, 'components.studio.card-grid', item => { item.meta.source = { kind: 'composition', ref: [], parts: [] }; });
  await assert.rejects(run(options), /components\.studio\.card-grid composition must declare its stock parts/);
  await editCandidate(options, 'components.studio.card-grid', item => { item.meta.source = { kind: 'composition', ref: [], parts: [{ slot: 'components.studio.text-link', files: ['text-link.tsx'] }] }; });
  await assert.rejects(run(options), /components\.studio\.card-grid composes components\.studio\.text-link, which is not pinned with registry or npm \(stock\) lineage/);
});

test('Draft assembly requires an explicit preview target and complete native bindings', async t => {
  const options = await fixture(t);
  await assert.rejects(run(options, { previewItems: [] }), /explicit preview target/);
  await assert.rejects(run(options, { target: 'preview' }), /explicit native bindings/);
  await assert.rejects(run(options, { target: 'preview', previewItems: [] }), /explicit native bindings/);
});


test('a page manifest missing its outline, modules or actions array fails closed (mutation proof)', async t => {
  const mutations = [
    ['no manifest', route => { delete route.manifest; }, /declares no page manifest/],
    ['no navigator', route => { delete route.manifest.navigator; }, /needs an outline navigator/],
    ['outline module removed', route => { route.manifest.modules = route.manifest.modules.filter(module => module.id !== 'outline'); }, /outline/],
    ['no modules', route => { route.manifest.modules = []; }, /declares no modules/],
    ['no actions array', route => { delete route.manifest.actions; }, /needs an actions array/],
    ['an action with no wiring line', route => { route.leaf.manifest.wiring = route.leaf.manifest.wiring.filter(line => !line.do.startsWith('copy ')); }, /wiring/],
    ['a popover with no open line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'open checks'); }, /checks popover/],
    ['no escape close line', route => { route.manifest.wiring = route.manifest.wiring.filter(line => line.do !== 'key escape'); }, /closing a popover/],
    ['a shared shortcut', route => { route.leaf.manifest.actions[0].shortcut = route.leaf.manifest.modules[0].shortcut; }, /reuses the shortcut/],
    ['a retired module frame', route => { route.manifest.frame = 'frames.module'; }, /names frame/],
    ['a leaf with no request-change', route => { route.leaf.manifest.actions = []; route.leaf.manifest.wiring = route.leaf.manifest.wiring.filter(line => !line.do.includes('request-change')); }, /needs the request-change prompt action/],
    ['a leaf with no outline', route => { delete route.leaf.manifest.navigator; }, /needs an outline navigator/],
  ];
  const clean = await fixture(t);
  await run(clean);
  for (const [label, edit, error] of mutations) {
    const options = await fixture(t);
    await editPinned(options, 'page.designer-themes', record => edit(record.meta.entry.blocks.Route));
    await assert.rejects(run(options), error, label);
  }
});

test('checkManifest names what a manifest lacks', () => {
  assert.throws(() => checkManifest('page.x', undefined, {}), /declares no page manifest/);
  assert.throws(() => checkManifest('page.x', { navigator: 'outline', modules: [], actions: [], wiring: [] }, {}), /declares no modules/);
});

test('Studio runs exactly the pinned payload: code that drifts from the pinned candidate fails', async t => {
  const options = await fixture(t);
  await run(options);
  // The build installs the pinned payload; --check only compares, so a re-pinned candidate the Studio
  // folder does not run fails there (and the check never writes the drifted code into Studio).
  const version = Number(/-v([1-9][0-9]*)\.json$/.exec((await pinnedDesignerSlot(options, 'sections.studio.checks')).pin.candidate)[1]);
  await editCandidate(options, 'sections.studio.checks', item => {
    const file = item.files.find(entry => entry.path === 'index.tsx');
    assert.ok(file.content.includes('<Card size="sm" {...provenance}>'));
    file.content = file.content.replace('<Card size="sm" {...provenance}>', '<Card size="sm" {...provenance} data-drifted="">');
  });
  await assert.rejects(run(options, { check: true }), new RegExp(`index\\.tsx differs from studio-checks v${version} as pinned`));
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
  const options = await fixture(t), record = await selected(options, 'page.designer-themes');
  await rm(record.pinPath);
  await assert.rejects(run(options), /pin.json.*Missing native record/);
});

test('selected candidate hash drift rejects despite intact legacy stores', async t => {
  const options = await fixture(t), record = await selected(options, 'page.designer-themes');
  await replace(record.path, '"title": "studio.page.designer-themes"', '"title": "studio.page.tampered"');
  await assert.rejects(run(options), /hash drift/);
});

test('unselected legacy compiled output cannot replace the pinned publication', async t => {
  const options = await fixture(t);
  const expected = await run(options);
  await mkdir(join(options.publisherRoot, 'route-pack'), { recursive: true });
  await writeFile(join(options.publisherRoot, 'route-pack/studio.json'), '{"routes":[]}');
  assert.deepEqual(await run(options, { check: true }), expected);
});

test('Foundry pinned Publisher inventory exposes the Studio publication and its authored page records', async () => {
  const { map, routePack } = await readPinnedPublication(clossys, 'studio');
  assert.equal(map.publicationId, 'studio');
  assert.equal(routePack.packId, 'studio');
  assert.deepEqual(map.entries.filter(entry => entry.kind === 'page').map(entry => entry.id), PAGE_NAMES);
  assert.deepEqual(map.entries.filter(entry => entry.kind === 'group').map(entry => entry.id), ['content', 'director', 'designer', 'writer', 'publisher', 'build', 'run']);
});
