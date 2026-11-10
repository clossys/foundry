import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioCopyRegistry } from './generate-studio-map.mjs';
import { candidateFiles, checkPayload, materializeCandidate } from './studio-payload.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const source = join(root, 'packages/producer/studio/sections/studio-references');
const expected = { title: 'Uses and used by', description: "Links to the other agents' leaves, in both directions, and where each version came from.",
  uses: 'Uses', usedBy: 'Used by', lineage: 'Lineage', version: 'Version', source: 'Source', none: 'None' };

test('References copy resolves all existing labels as draft and its normal pinned payload matches', async () => {
  // The normal payload is the one the Designer slot model pins today (re-pinned past v2 by later adoptions).
  const pinned = JSON.parse(await readFile(join(root, 'clossys/agents/designer/sections.studio.references/pin.json'), 'utf8')).candidate;
  const files = await candidateFiles(join(root, 'clossys'), 'sections.studio.references', pinned);
  await checkPayload({ slot: 'sections.studio.references', element: 'studio-references', version: Number(/-v([1-9][0-9]*)\.json$/.exec(pinned)[1]), files, studioDir: source,
    payload: [...files.keys()] });
  const registry = await studioCopyRegistry(join(root, 'clossys'));
  for (const [field, text] of Object.entries(expected)) {
    const id = `studio.references-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    assert.deepEqual(registry.entries.find(entry => entry.id === id), { id, text, context: 'lib/references-copy.ts, sections/studio-references/index.tsx', status: 'draft' });
  }
  const candidateDir = join(root, 'clossys/agents/designer/sections.studio.references');
  const pin = JSON.parse(await readFile(join(candidateDir, 'pin.json'), 'utf8'));
  const bytes = await readFile(join(candidateDir, 'candidates', pin.candidate), 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.files.find(file => file.path === 'index.tsx').content, await readFile(join(source, 'index.tsx'), 'utf8'));
});

test('Writer input preserves exact References markup across all conditional branches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'references-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root, 'packages/producer/package.json'));
  const copyBundle = join(dir, 'copy.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/references-copy.ts')], outfile: copyBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const copy = (await import(copyBundle)).referencesCopy();
  assert.deepEqual(copy, expected);
  const bundles = [];
  for (const version of ['v1', 'v2']) {
    const out = join(dir, `${version}.cjs`);
    await build({ entryPoints: [join(await materializeCandidate(join(root, 'clossys'), 'sections.studio.references', `studio-references-${version}.json`, join(dir, `candidate-${version}`)), 'index.tsx')], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      alias: { '@clossys/designer-ui': join(root, 'packages/designer/ui/src/index.ts'), '@': join(root, 'packages/designer/ui/src') },
      nodePaths: [join(root, 'node_modules')] });
    // Keep React's server render and components on the same instance.
    bundles.push(require(out).default);
  }
  for (const references of [
    { uses: [], usedBy: [], lineage: [] },
    { uses: [{ label: 'Linked leaf', href: '/linked' }, { label: 'Unlinked leaf' }], usedBy: [], lineage: [] },
    { uses: [], usedBy: [{ label: 'Consumer', href: '/consumer' }, { label: 'Unlinked consumer' }], lineage: [{ key: 'v1', version: 'v1', mode: 'customized', source: 'Source record' }] },
    { uses: [{ label: 'Read leaf' }], usedBy: [{ label: 'Consumer', href: '/consumer' }], lineage: [{ key: 'v1', version: 'v1', mode: 'original', source: 'First source' }, { key: 'v2', version: 'v2', mode: 'customized', source: 'Second source' }] },
  ]) {
    const before = renderToStaticMarkup(createElement(bundles[0], { references }));
    const after = renderToStaticMarkup(createElement(bundles[1], { references: { ...references, copy } }));
    assert.equal(after, before);
    const custom = Object.fromEntries(Object.keys(expected).map(key => [key, `writer-${key}`]));
    const changed = renderToStaticMarkup(createElement(bundles[1], { references: { ...references, copy: custom } }));
    assert.match(changed, /writer-title/);
    assert.match(changed, /writer-description/);
    for (const label of ['uses', 'usedBy']) assert.ok(changed.includes(`writer-${label}`));
    if (references.lineage.length) for (const label of ['lineage', 'version', 'source']) assert.ok(changed.includes(`writer-${label}`));
    if (!references.uses.length || !references.usedBy.length) assert.ok(changed.includes('writer-none'));
    if (references.uses.some(ref => ref.href)) assert.ok(changed.includes('href="/linked"'));

  }
});
