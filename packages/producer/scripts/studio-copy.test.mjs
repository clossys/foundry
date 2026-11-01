import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { studioCopyRegistry } from './generate-studio-map.mjs';
import { createCopyResolver, resolveCopyRef } from '@clossys/writer/resolve';

const slot = 'strings.common';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = join(root, 'agents/writer');
  const dir = join(writer, 'strings.interface/interface-field-labels', slot);
  await mkdir(join(dir, 'candidates'), { recursive: true });
  await writeFile(join(writer, 'ia.json'), JSON.stringify({ nodes: [
    { id: 'strings.interface', children: [{ id: 'interface-field-labels', slots: [slot] }] },
    { id: 'lexicon.voice', children: [{ id: 'voice-tone', slots: ['lexicon.warmth'] }] },
  ] }));
  const unrelated = join(writer, 'lexicon.voice/voice-tone/lexicon.warmth');
  await mkdir(unrelated, { recursive: true });
  await writeFile(join(unrelated, 'pin.json'), '{"candidate":"voice-v1.md"}');
  async function candidate(text, name = 'studio-v1.md', pin = true) {
    const bytes = `---\nslot: "${slot}"\nlocales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n## en\n\n### studio.greeting\n<!-- {"id":"studio.greeting","bindings":["test"]} -->\n${text}\n`;
    await writeFile(join(dir, 'candidates', name), bytes);
    if (pin) await writeFile(join(dir, 'pin.json'), JSON.stringify({ candidate: name, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  return { root, dir, candidate };
}

test('Studio copy reads the pinned Writer candidate, ignores newer drafts and unrelated leaves', async t => {
  const f = await fixture(t);
  await f.candidate('Hello, {name}.\nSecond line.');
  await f.candidate('Unpinned', 'studio-v2.md', false);
  let registry = await studioCopyRegistry(f.root);
  assert.equal(registry.entries[0].text, 'Hello, {name}.\nSecond line.');
  assert.equal(registry.entries[0].status, 'draft');
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
  await rm(join(f.dir, 'pin.json'));
  assert.deepEqual((await studioCopyRegistry(f.root)).entries, []);
});

test('Foundry migrated copy resolves counts and current visible wording without approval claims', async () => {
  const root = new URL('../../../clossys/', import.meta.url).pathname;
  const registry = await studioCopyRegistry(root);
  const stored = JSON.parse(await readFile(new URL('../studio/generated/studio-copy.json', import.meta.url), 'utf8'));
  assert.deepEqual(registry, stored);
  const resolve = createCopyResolver(registry, { target: 'preview' });
  assert.equal(resolve({ id: 'studio.page-attention-count', values: { count: 1 } })?.text, '1 item needs attention on this page.');
  assert.equal(resolve({ id: 'studio.page-attention-count', values: { count: 2 } })?.text, '2 items need attention on this page.');
  assert.equal(resolve({ id: 'studio.home' })?.text, 'Home');
  assert.equal(resolve({ id: 'studio.unknown' }), undefined);
});


test('Every migrated Studio message uses Writer ICU and retains singular/plural option wording', async () => {
  const registry = await studioCopyRegistry(new URL('../../../clossys/', import.meta.url).pathname);
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
