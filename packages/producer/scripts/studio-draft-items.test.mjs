import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertPreviewContext, draftStudioItems, pinnedBindings, previewArguments, previewDescriptor, previewOptions, PREVIEW_BINDINGS_ENV } from './studio-draft-items.mjs';

const clossys = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const slot = 'sections.studio.options', element = 'example', at = '2026-10-31T12:00:00Z';
const slotPath = `agents/designer/sections.extensions/extensions/${slot}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-draft-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  // One real Designer slot, with no candidates or pin of its own.
  const slotDir = join(root, slotPath), candidates = join(slotDir, 'candidates');
  await mkdir(candidates, { recursive: true });
  await cp(join(clossys, 'agents/designer/ia.json'), join(root, 'agents/designer/ia.json'));
  await cp(join(clossys, slotPath, 'slot.json'), join(slotDir, 'slot.json'));
  const studio = join(root, 'studio'), dir = join(studio, 'sections', element);
  await mkdir(dir, { recursive: true });
  const source = `// \ufffd
export default function Example() { return null; }
`;
  const provenance = JSON.stringify({ qualification: { state: 'unqualified-draft' }, remainingNeeds: ['Native source composition remains unqualified.'] });
  await writeFile(join(dir, 'index.tsx'), source);
  await writeFile(join(dir, 'stock.provenance.json'), provenance);
  const source_ = { kind: 'derived', ref: ['{"registry":"fixture","item":"card","version":"1"}'], license: 'MIT' };
  const meta = { slot, source: source_, element: { id: element, license: { spdx: 'MIT' }, creator: { agent: 'designer', model: 'fixture' },
    checks: [{ id: 'ref-verbatim', suite: 'strict-reference', type: 'fixed', status: 'fail', detail: 'REF-FILE-UNMAPPED fixture evidence', at }] },
    preview: { schema: 'clossys.preview/1', fixtures: {}, copy: {}, container: 'section-in-frame', theme: 'light', width: 1280 } };
  const input = { name: element, type: 'registry:block', meta, files: [
    { path: 'index.tsx', type: 'registry:component', content: source },
    { path: 'stock.provenance.json', type: 'registry:file', content: provenance },
    { path: 'LICENCE.md', type: 'registry:file', content: 'MIT\n' },
  ] };
  const write = async (version, item = input) => {
    const bytes = `${JSON.stringify(item, null, 2)}\n`, path = join(candidates, `${element}-v${version}.json`);
    await writeFile(path, bytes);
    return { path, binding: { slot, element, version, hash: `sha256:${sha(bytes)}` } };
  };
  const { path, binding } = await write(1);
  const bindingsFile = join(root, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify([binding]));
  const run = (rows = [binding], required = [slot]) => draftStudioItems(root, studio, rows, required);
  return { root, studio, dir, slotDir, input, path, binding, bindingsFile, write, run };
}

test('exact native Draft projection retains hashes, raw ancestry and NEEDs without creating pins or approval', async t => {
  const f = await fixture(t), before = await readFile(f.path);
  const [item] = await f.run();
  assert.deepEqual(item.previewEvidence.lineage, f.input.meta.source);
  assert.deepEqual(item.previewEvidence.license, f.input.meta.element.license);
  assert.deepEqual(item.previewEvidence.recordedChecks, f.input.meta.element.checks);
  assert.equal(item.previewEvidence.status, 'DRAFT');
  assert.equal(item.previewEvidence.approved, false);
  assert.equal(item.previewEvidence.referenceQualified, false);
  assert.equal(item.previewEvidence.releaseQualified, false);
  assert.equal(item.previewEvidence.pinGranted, false);
  assert.equal(item.previewEvidence.pinClaim, null);
  assert.equal(item.previewEvidence.matchesPin, false);
  assert.deepEqual(item.previewEvidence.remainingNeeds, [
    'Strict reference qualification was not executed or granted by this Draft projection.',
    'Native source composition remains unqualified.',
  ]);
  assert.equal(item.previewEvidence.record.ref, `${slotPath}/candidates/${element}-v1.json`);
  assert.equal(item.previewEvidence.record.sha256, f.binding.hash.slice('sha256:'.length));
  assert.equal(item.previewEvidence.payload.length, 3);
  assert.equal(JSON.stringify(item.previewEvidence).includes(f.root), false);
  assert.deepEqual(await readFile(f.path), before);
  assert.deepEqual((await readdir(f.slotDir)).sort(), ['candidates', 'slot.json']);
});

test('Draft projection retains an explicit qualification NEED even without a provenance file', async t => {
  const f = await fixture(t);
  const next = await f.write(2, { ...f.input, files: f.input.files.filter(file => file.path !== 'stock.provenance.json') });
  await rm(join(f.dir, 'stock.provenance.json'));
  const [item] = await f.run([next.binding]);
  assert.equal(item.previewEvidence.referenceQualified, false);
  assert.deepEqual(item.previewEvidence.provenance, []);
  assert.deepEqual(item.previewEvidence.remainingNeeds, ['Strict reference qualification was not executed or granted by this Draft projection.']);
});

test('newest is never inferred: the explicit older version wins and an explicit mismatching newer version refuses', async t => {
  const f = await fixture(t);
  const next = await f.write(2, { ...f.input, files: f.input.files.map(file => file.path === 'index.tsx' ? { ...file, content: 'export default function Newer() { return null; }\n' } : file) });
  assert.equal((await f.run())[0].version, 1);
  await assert.rejects(f.run([next.binding]), /differs from example/);
});

test('an existing pin remains a validated factual claim and never becomes preview approval', async t => {
  const f = await fixture(t);
  const pin = { candidate: `${element}-v1.json`, sha256: f.binding.hash.slice('sha256:'.length), pinnedBy: 'owner:fixture-owner', at };
  await writeFile(join(f.slotDir, 'pin.json'), JSON.stringify(pin));
  const [item] = await f.run();
  assert.deepEqual(item.previewEvidence.pinClaim, { candidate: pin.candidate, hash: f.binding.hash, at });
  assert.equal(item.previewEvidence.matchesPin, true);
  assert.equal(item.previewEvidence.approved, false);
  assert.equal(JSON.stringify(item.previewEvidence).includes('fixture-owner'), false);
  assert.deepEqual(await pinnedBindings(f.root, [slot]), [f.binding]);
});

test('missing, duplicate, partial, raw-candidate-hash and wrong-tree-hash bindings refuse', async t => {
  const f = await fixture(t);
  for (const rows of [undefined, [], [f.binding, f.binding], [{ ...f.binding, hash: '0'.repeat(64) }], [{ ...f.binding, hash: `sha256:${'0'.repeat(64)}` }], [{ ...f.binding, version: 9 }]]) {
    await assert.rejects(f.run(rows === undefined ? null : rows));
  }
  await assert.rejects(f.run([f.binding], [slot, 'frames.missing']), /cover every required/);
  await assert.rejects(f.run([{ ...f.binding, slot: 'sections.studio.unknown' }], ['sections.studio.unknown']), /not a Designer slot/);
  await assert.rejects(pinnedBindings(f.root, [slot]), /no pinned element candidate/);
});

test('escaping bindings and native payload paths refuse', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run([{ ...f.binding, element: '../escape' }]), /invalid/);
  const escaping = await f.write(2, { ...f.input, files: [...f.input.files, { path: '../escape.tsx', type: 'registry:file', content: 'x' }] });
  await assert.rejects(f.run([escaping.binding]), /unsafe/);
  const renamed = await f.write(3, { ...f.input, name: 'other' });
  await assert.rejects(f.run([renamed.binding]), /name or slot differs/);
});

test('raw current-UI code mismatch refuses even when UTF-8 decoding would look identical', async t => {
  const f = await fixture(t), path = join(f.dir, 'index.tsx'), original = await readFile(path);
  const offset = original.indexOf(Buffer.from('\ufffd'));
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
