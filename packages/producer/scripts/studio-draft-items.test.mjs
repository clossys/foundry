import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { writeElementVersion } from '../dist/records/library.js';
import { assertPreviewContext, draftStudioItems, previewArguments, previewDescriptor, previewOptions, PREVIEW_BINDINGS_ENV } from './studio-draft-items.mjs';

const slot = 'sections.studio.example', element = 'example', at = '2026-10-31T12:00:00Z';
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-draft-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const studio = join(root, 'studio'), dir = join(studio, 'sections', element);
  await mkdir(dir, { recursive: true });
  const source = `// �
export default function Example() { return null; }
`;
  const provenance = JSON.stringify({ qualification: { state: 'unqualified-draft' }, remainingNeeds: ['Native source composition remains unqualified.'] });
  await writeFile(join(dir, 'index.tsx'), source);
  await writeFile(join(dir, 'stock.provenance.json'), provenance);
  const input = {
    element: { schema: 'clossys.element/1', id: element, package: 'producer', layer: 'sections', slot, kind: 'registry:block',
      lineage: { mode: 'customized', source: { registry: 'fixture', item: 'card', version: '1' } }, license: { spdx: 'MIT' },
      creator: { agent: 'designer', model: 'fixture' }, reason: 'Unqualified preview fixture.', createdAt: at,
      checks: [{ id: 'ref-verbatim', suite: 'strict-reference', type: 'fixed', status: 'fail', detail: 'REF-FILE-UNMAPPED fixture evidence', at }],
      deps: { npm: {}, elements: [] }, reads: { copyKeys: [], themeVars: [] } },
    preview: { schema: 'clossys.preview/1', fixtures: {}, copy: {}, container: 'section-in-frame', theme: 'light', width: 1280 },
    files: { 'index.tsx': source, 'stock.provenance.json': provenance, 'LICENCE.md': 'MIT\n' },
  };
  const version = writeElementVersion(join(root, 'library'), input);
  const binding = { slot, element, version: version.element.version, hash: version.element.hash };
  const bindingsFile = join(root, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify([binding]));
  const run = (rows = [binding], required = [slot]) => draftStudioItems(root, studio, rows, required);
  return { root, studio, dir, input, version, binding, bindingsFile, run };
}

test('exact native Draft projection retains hashes, raw ancestry and NEEDs without creating pins or approval', async t => {
  const f = await fixture(t), before = await readFile(join(f.version.dir, 'element.json'));
  const [item] = await f.run();
  assert.deepEqual(item.previewEvidence.lineage, f.version.element.lineage);
  assert.deepEqual(item.previewEvidence.license, f.version.element.license);
  assert.deepEqual(item.previewEvidence.recordedChecks, f.version.element.checks);
  assert.equal(item.previewEvidence.status, 'DRAFT');
  assert.equal(item.previewEvidence.approved, false);
  assert.equal(item.previewEvidence.referenceQualified, false);
  assert.equal(item.previewEvidence.releaseQualified, false);
  assert.equal(item.previewEvidence.selectionGranted, false);
  assert.equal(item.previewEvidence.selectionClaim, null);
  assert.equal(item.previewEvidence.matchesBinding, false);
  assert.deepEqual(item.previewEvidence.remainingNeeds, [
    'Strict reference qualification was not executed or granted by this Draft projection.',
    'Native source composition remains unqualified.',
  ]);
  assert.equal(item.previewEvidence.record.ref, `library/${slot}/${element}/v1/element.json`);
  assert.equal(item.previewEvidence.payload.length, 3);
  assert.match(item.previewEvidence.record.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(item.previewEvidence).includes(f.root), false);
  assert.deepEqual(await readFile(join(f.version.dir, 'element.json')), before);
  assert.deepEqual((await readdir(f.root)).sort(), ['bindings.json', 'library', 'studio']);
});

test('Draft projection retains an explicit qualification NEED even without a provenance file', async t => {
  const f = await fixture(t), files = { ...f.input.files };
  delete files['stock.provenance.json'];
  const next = writeElementVersion(join(f.root, 'library'), { ...f.input, files });
  await rm(join(f.dir, 'stock.provenance.json'));
  const [item] = await f.run([{ ...f.binding, version: next.element.version, hash: next.element.hash }]);
  assert.equal(item.previewEvidence.referenceQualified, false);
  assert.deepEqual(item.previewEvidence.provenance, []);
  assert.deepEqual(item.previewEvidence.remainingNeeds, ['Strict reference qualification was not executed or granted by this Draft projection.']);
});

test('newest is never inferred: the explicit older version wins and an explicit mismatching newer version refuses', async t => {
  const f = await fixture(t);
  const next = writeElementVersion(join(f.root, 'library'), { ...f.input, files: { ...f.input.files, 'index.tsx': 'export default function Newer() { return null; }\n' } });
  assert.equal((await f.run())[0].version, 1);
  await assert.rejects(f.run([{ ...f.binding, version: next.element.version, hash: next.element.hash }]), /differs from example/);
});

test('existing selection remains a validated factual claim and never becomes preview approval', async t => {
  const f = await fixture(t);
  const claim = { element, version: 1, hash: f.binding.hash, event: 'e1' };
  await writeFile(join(f.root, 'selection.json'), JSON.stringify({ schema: 'clossys.selection/1', pins: { [slot]: claim },
    history: [{ id: 'e1', at, by: 'fixture-owner', action: 'pin', slot, element, version: 1, hash: f.binding.hash }] }));
  const [item] = await f.run();
  assert.deepEqual(item.previewEvidence.selectionClaim, claim);
  assert.equal(item.previewEvidence.matchesBinding, true);
  assert.equal(item.previewEvidence.approved, false);
  assert.equal(JSON.stringify(item.previewEvidence).includes('fixture-owner'), false);
});

test('missing, duplicate, partial, raw-candidate-hash and wrong-tree-hash bindings refuse', async t => {
  const f = await fixture(t);
  for (const rows of [undefined, [], [f.binding, f.binding], [{ ...f.binding, hash: '0'.repeat(64) }], [{ ...f.binding, hash: `sha256:${'0'.repeat(64)}` }]]) {
    await assert.rejects(f.run(rows === undefined ? null : rows));
  }
  await assert.rejects(f.run([f.binding], [slot, 'frames.missing']), /cover every required/);
});

test('escaping bindings and native payload paths refuse', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run([{ ...f.binding, element: '../escape' }]), /invalid/);
  const path = join(f.version.dir, 'element.json'), record = JSON.parse(await readFile(path, 'utf8'));
  record.payload = ['../escape.tsx']; await writeFile(path, JSON.stringify(record));
  await assert.rejects(f.run(), /unsafe/);
});

test('native payload aliases and undeclared files refuse before projection', async t => {
  const f = await fixture(t), code = join(f.version.dir, 'index.tsx');
  await rm(code); await symlink(join(f.dir, 'index.tsx'), code);
  await assert.rejects(f.run(), /symbolic link/);
  await rm(code); await writeFile(code, f.input.files['index.tsx']);
  await writeFile(join(f.version.dir, 'extra.tsx'), 'extra');
  await assert.rejects(f.run(), /unrecorded files/);
});

test('raw current-UI code mismatch refuses even when UTF-8 decoding would look identical', async t => {
  const f = await fixture(t), path = join(f.dir, 'index.tsx'), original = await readFile(path);
  const offset = original.indexOf(Buffer.from('�'));
  const changed = Buffer.concat([original.subarray(0, offset), Buffer.from([0xff]), original.subarray(offset + 3)]);
  assert.equal(original.toString('utf8'), changed.toString('utf8'));
  await writeFile(path, changed);
  await assert.rejects(f.run(), /differs from example/);
});

test('public preview arguments propagate only an explicit validated binding file and carry a portable digest', async t => {
  const f = await fixture(t);
  const input = ['--out-dir', 'output', '--preview-bindings', f.bindingsFile];
  const invocation = await previewArguments(input);
  assert.deepEqual(invocation.args, ['--out-dir', 'output']);
  assert.equal(invocation.env[PREVIEW_BINDINGS_ENV], f.bindingsFile);
  assert.deepEqual(invocation.options, { target: 'preview', previewItems: [f.binding] });
  assert.deepEqual(invocation.descriptor, previewDescriptor([f.binding]));
  assert.throws(() => assertPreviewContext(invocation.descriptor, undefined), /explicit preview context/);
  assert.doesNotThrow(() => assertPreviewContext(invocation.descriptor, invocation.descriptor));
  assert.equal(JSON.stringify(invocation.descriptor).includes(f.root), false);
  assert.equal(Object.hasOwn((await previewArguments([])).env, PREVIEW_BINDINGS_ENV), false);
  assert.deepEqual((await previewArguments([])).options, {});
  await assert.rejects(previewArguments(['--preview-bindings']), /requires one file/);
  await assert.rejects(previewArguments(['--preview-bindings', f.bindingsFile, '--preview-bindings', f.bindingsFile]), /requires one file/);
  await assert.rejects(previewOptions(join(f.root, 'missing.json')), { code: 'ENOENT' });
  await writeFile(f.bindingsFile, 'not JSON');
  await assert.rejects(previewArguments(['--preview-bindings', f.bindingsFile]), SyntaxError);
});
