import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { studioCopyRegistry } from './generate-studio-map.mjs';
import { createCopyResolver, resolveCopyRef } from '@clossys/writer/resolve';

const preview = { target: 'preview', absentPin: 'newest-draft' };
async function fixture(t, placement = 'strings.interface/interface-field-labels/strings.common') {
  const [nodeId, groupId, slot] = placement.split('/');
  const root = await mkdtemp(join(tmpdir(), 'studio-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = join(root, 'agents/writer');
  const dir = join(writer, slot);
  await mkdir(join(dir, 'candidates'), { recursive: true });
  await writeFile(join(writer, 'ia.json'), JSON.stringify({ nodes: [
    { id: nodeId, children: [{ id: groupId, slots: [slot] }] },
    { id: 'lexicon.voice', children: [{ id: 'voice-tone', slots: ['lexicon.warmth'] }] },
  ] }));
  const unrelated = join(writer, 'lexicon.warmth');
  await mkdir(unrelated, { recursive: true });
  await writeFile(join(unrelated, 'pin.json'), '{"candidate":"voice-v1.md"}');
  async function candidate(text, name = 'studio-v1.md', pin = true) {
    const bytes = `---\nslot: "${slot}"\nlocales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n## en\n\n### studio.greeting\n<!-- {"id":"studio.greeting","bindings":["test"]} -->\n${text}\n`;
    await writeFile(join(dir, 'candidates', name), bytes);
    if (pin) await writeFile(join(dir, 'pin.json'), JSON.stringify({ candidate: name, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  return { root, writer, dir, candidate };
}

test('Studio copy reads the pinned Writer candidate, ignores newer drafts and unrelated leaves', async t => {
  const f = await fixture(t);
  await f.candidate('Hello, {name}.\nSecond line.');
  await f.candidate('Unpinned', 'studio-v2.md', false);
  let registry = await studioCopyRegistry(f.root);
  assert.equal(registry.entries[0].text, 'Hello, {name}.\nSecond line.');
  assert.equal(registry.entries[0].status, 'draft');
  assert.equal((await studioCopyRegistry(f.root, preview)).entries[0].text, registry.entries[0].text);
  assert.equal(registry.source.reference, 'clossys/agents/writer');
  const pin = JSON.parse(await readFile(join(f.dir, 'pin.json'), 'utf8'));
  assert.equal(registry.revision, createHash('sha256').update(pin.sha256).digest('hex'));
  assert.equal(createCopyResolver(registry)({ id: 'studio.greeting', values: { name: 'Reader' } }), undefined);
  const resolve = createCopyResolver(registry, { target: 'preview' });
  assert.equal(resolve({ id: 'studio.greeting', values: { name: 'Reader' } }).text, 'Hello, Reader.\nSecond line.');
  assert.equal(resolve({ id: 'studio.greeting' }), undefined);
  await f.candidate('Changed in Writer', 'studio-v2.md');
  registry = await studioCopyRegistry(f.root);
  assert.equal(registry.entries[0].text, 'Changed in Writer');
});

test('Studio copy refuses relevant corrupt pins and never selects an unpinned candidate', async t => {
  const f = await fixture(t);
  await f.candidate('Original');
  await writeFile(join(f.dir, 'candidates/studio-v1.md'), 'changed');
  await assert.rejects(studioCopyRegistry(f.root), /hash mismatch/);
  await f.candidate('Newer draft', 'studio-v2.md', false);
  await assert.rejects(studioCopyRegistry(f.root, preview), /hash mismatch/);
  await rm(join(f.dir, 'pin.json'));
  assert.deepEqual((await studioCopyRegistry(f.root)).entries, []);
});

test('Foundry migrated copy resolves counts and current visible wording without approval claims', async () => {
  const root = new URL('../../../clossys/', import.meta.url).pathname;
  const registry = await studioCopyRegistry(root, preview);
  const stored = JSON.parse(await readFile(new URL('../studio/generated/studio-copy.json', import.meta.url), 'utf8'));
  assert.deepEqual(registry, stored);
  const resolve = createCopyResolver(registry, { target: 'preview' });
  assert.equal(resolve({ id: 'studio.page-attention-count', values: { count: 1 } })?.text, '1 item needs attention on this page.');
  assert.equal(resolve({ id: 'studio.page-attention-count', values: { count: 2 } })?.text, '2 items need attention on this page.');
  assert.equal(resolve({ id: 'studio.home' })?.text, 'Home');
  assert.equal(resolve({ id: 'studio.first-recorded' })?.text, 'first recorded');
  assert.equal(resolve({ id: 'studio.local-preview' })?.text, 'local preview');
  assert.equal(resolve({ id: 'studio.clossys-com-is-set-at-release-promotion' })?.text, 'clossys.com is set at release promotion.');
  assert.equal(resolve({ id: 'studio.unknown' }), undefined);
});


test('Every migrated Studio message uses Writer ICU and retains singular/plural option wording', async () => {
  const registry = await studioCopyRegistry(new URL('../../../clossys/', import.meta.url).pathname, preview);
  for (const entry of registry.entries) {
    const missing = resolveCopyRef(registry, { id: entry.id }, { target: 'preview' });
    const values = Object.fromEntries(missing.issues.filter(issue => issue.reason === 'missing-placeholder-value')
      .map(issue => [issue.placeholder, issue.placeholder === 'count' ? 2 : 'sample']));
    const result = resolveCopyRef(registry, { id: entry.id, values }, { target: 'preview' });
    assert.equal(result.complete, true, `${entry.id}: ${JSON.stringify(result.issues)}`);
  }
  const resolve = createCopyResolver(registry, { target: 'preview' });
  assert.equal(resolve({ id: 'studio.newer-options-description', values: { count: 1, noun: 'pinned' } }).text,
    '1 newer version is not pinned. The site keeps the pinned version until one is approved.');
  assert.equal(resolve({ id: 'studio.unpinned-options-description', values: { count: 2, noun: 'active' } }).text,
    'Nothing is active yet. 2 recorded versions wait for approval.');
});


test('Absent-pin draft selection requires explicit preview and chooses the newest numeric version with byte provenance', async t => {
  const f = await fixture(t);
  await f.candidate('Version two', 'studio-v2.md', false);
  await f.candidate('Version ten', 'studio-v10.md', false);
  assert.deepEqual((await studioCopyRegistry(f.root)).entries, []);
  await assert.rejects(studioCopyRegistry(f.root, { absentPin: 'newest-draft' }), /explicit newest-draft preview/);
  await assert.rejects(studioCopyRegistry(f.root, { target: 'production', absentPin: 'newest-draft' }), /explicit newest-draft preview/);
  const registry = await studioCopyRegistry(f.root, preview);
  assert.equal(registry.entries[0].text, 'Version ten');
  assert.equal(registry.entries[0].status, 'draft');
  assert.equal(createCopyResolver(registry)({ id: 'studio.greeting' }), undefined);
  assert.equal(createCopyResolver(registry, { target: 'production' })({ id: 'studio.greeting' }), undefined);
  assert.equal(createCopyResolver(registry, { target: 'preview' })({ id: 'studio.greeting' }).text, 'Version ten');
  const sources = JSON.parse(registry.source.reference.slice('clossys/agents/writer#'.length));
  assert.deepEqual(sources, [{
    placement: 'strings.interface/interface-field-labels/strings.common', candidate: 'studio-v10.md', version: '10',
    sha256: createHash('sha256').update(await readFile(join(f.dir, 'candidates/studio-v10.md'))).digest('hex'), selectedBy: 'absent-pin-preview',
  }]);
  assert.equal(registry.revision, createHash('sha256').update(JSON.stringify(sources)).digest('hex'));
  assert.deepEqual(await studioCopyRegistry(f.root, preview), registry);
});

test('A valid pin beats newer drafts and preview provenance names the actual pinned candidate', async t => {
  const f = await fixture(t);
  await f.candidate('Pinned', 'studio-v1.md');
  await f.candidate('Newer', 'studio-v10.md', false);
  const registry = await studioCopyRegistry(f.root, preview);
  assert.equal(registry.entries[0].text, 'Pinned');
  const [source] = JSON.parse(registry.source.reference.slice('clossys/agents/writer#'.length));
  assert.equal(source.candidate, 'studio-v1.md');
  assert.equal(source.version, '1');
  assert.equal(source.selectedBy, 'pin');
  await writeFile(join(f.dir, 'pin.json'), '{');
  await assert.rejects(studioCopyRegistry(f.root, preview), SyntaxError);
});

test('Preview refuses a corrupt newest draft rather than falling back to an older valid draft', async t => {
  const f = await fixture(t);
  await f.candidate('Older valid', 'studio-v1.md', false);
  await f.candidate('Newest', 'studio-v2.md', false);
  const newest = join(f.dir, 'candidates/studio-v2.md');
  await writeFile(newest, 'corrupt');
  await assert.rejects(studioCopyRegistry(f.root, preview), /Invalid Studio Writer locale/);
  await writeFile(newest, '---\nlocales: ["en"]\n---\n');
  await assert.rejects(studioCopyRegistry(f.root, preview), /Invalid Studio Writer records/);
  await f.candidate('Newest', 'studio-v2.md', false);
  const validNewest = await readFile(newest, 'utf8');
  for (const meta of [null, {}, { id: 42 }, { id: null }]) {
    await writeFile(newest, validNewest.replace(/<!-- .* -->/, `<!-- ${JSON.stringify(meta)} -->`));
    await assert.rejects(studioCopyRegistry(f.root, preview), /Invalid Studio Writer metadata/);
  }
  await writeFile(newest, validNewest.replace(/<!-- .* -->/, '<!-- {"id":"ordinary.greeting","bindings":["test"]} -->'));
  assert.deepEqual((await studioCopyRegistry(f.root, preview)).entries, []);
  await writeFile(newest, Buffer.from([0xff]));
  await assert.rejects(studioCopyRegistry(f.root, preview), TypeError);
});

test('Preview refuses numeric-version ties and compares large versions without rounding', async t => {
  const f = await fixture(t);
  await f.candidate('Lower', 'studio-v9007199254740992.md', false);
  await f.candidate('Higher', 'studio-v9007199254740993.md', false);
  assert.equal((await studioCopyRegistry(f.root, preview)).entries[0].text, 'Higher');
  await f.candidate('Conflicting higher', 'other-v9007199254740993.md', false);
  await assert.rejects(studioCopyRegistry(f.root, preview), /Ambiguous Studio Writer draft version/);
});

test('Preview is limited to the four approved Studio copy slots, wherever the IA groups them', async t => {
  for (const placement of [
    'strings.metadata/metadata-descriptions/strings.descriptions',
    'strings.interface/interface-statuses/strings.statuses',
    'strings.interface/interface-field-labels/strings.common',
    'strings.interface/interface-field-labels/strings.field-labels',
  ]) {
    const f = await fixture(t, placement);
    await f.candidate('Allowed draft', 'studio-v1.md', false);
    // Regroup the slot in ia.json only: the flat folder agents/writer/<slot> does not move.
    const ia = JSON.parse(await readFile(join(f.writer, 'ia.json'), 'utf8'));
    const slot = placement.split('/')[2];
    ia.nodes[0].children[0].slots = ia.nodes[0].children[0].slots.filter(id => id !== slot);
    ia.nodes.push({ id: 'regrouped', children: [{ id: 'other-group', slots: [slot] }] });
    await writeFile(join(f.writer, 'ia.json'), JSON.stringify(ia));
    const registry = await studioCopyRegistry(f.root, preview);
    assert.equal(registry.entries[0].text, 'Allowed draft');
    assert.equal(JSON.parse(registry.source.reference.slice('clossys/agents/writer#'.length))[0].placement, `regrouped/other-group/${slot}`);
    assert.deepEqual((await studioCopyRegistry(f.root)).entries, []);
  }
});
