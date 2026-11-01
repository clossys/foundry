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
import { checkPayload } from './studio-payload.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const library = join(root, 'clossys/library/sections.studio.contract/studio-contract');
const source = join(root, 'packages/producer/studio/sections/studio-contract');
const expected = { title: 'Contract', description: 'What this leaf promises and reads.', factsLabel: 'Contract facts', inputsLabel: 'Contract inputs',
  fact: 'Fact', value: 'Value', input: 'Input', type: 'Type', required: 'Required', yes: 'Yes', no: 'No', none: 'None' };

test('Contract copy resolves all existing labels as draft and its normal pinned payload matches', async () => {
  await checkPayload({ slot: 'sections.studio.contract', element: 'studio-contract', version: 2, versionDir: join(library, 'v2'), studioDir: source,
    payload: ['LICENCE.md', 'index.tsx', 'registry-item.json'] });
  const registry = await studioCopyRegistry(join(root, 'clossys'));
  for (const [field, text] of Object.entries(expected)) {
    const id = `studio.contract-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    assert.deepEqual(registry.entries.find(entry => entry.id === id), { id, text, context: 'lib/contract-copy.ts, sections/studio-contract/index.tsx', status: 'draft' });
  }
  const candidateDir = join(root, 'clossys/agents/designer/sections.extensions/extensions/sections.studio.contract');
  const pin = JSON.parse(await readFile(join(candidateDir, 'pin.json'), 'utf8'));
  const bytes = await readFile(join(candidateDir, 'candidates', pin.candidate), 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.files.find(file => file.path === 'index.tsx').content, await readFile(join(source, 'index.tsx'), 'utf8'));
});

test('Writer input preserves exact Contract markup across all conditional branches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'contract-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root, 'packages/producer/package.json'));
  const copyBundle = join(dir, 'copy.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/contract-copy.ts')], outfile: copyBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const copy = (await import(copyBundle)).contractCopy();
  assert.deepEqual(copy, expected);
  const bundles = [];
  for (const version of ['v1', 'v2']) {
    const out = join(dir, `${version}.cjs`);
    await build({ entryPoints: [join(library, version, 'index.tsx')], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      alias: { '@clossys/designer-ui': join(root, 'packages/designer/ui/src/index.ts'), '@': join(root, 'packages/designer/ui/src') },
      nodePaths: [join(root, 'node_modules')] });
    // Keep React's server render and components on the same instance.
    bundles.push(require(out).default);
  }
  for (const contract of [
    { facts: [{ label: 'Kind', value: 'element' }], inputs: [{ name: 'first', type: 'string', required: true }, { name: 'second', type: 'number', required: false }], lists: [{ label: 'Reads', items: [] }, { label: 'Uses', items: ['item'] }] },
    { facts: [], inputs: [], lists: [] },
    { facts: [], lists: [{ label: 'Reads', items: [] }] },
  ]) {
    const before = renderToStaticMarkup(createElement(bundles[0], { contract }));
    const after = renderToStaticMarkup(createElement(bundles[1], { contract: { ...contract, copy } }));
    assert.equal(after, before);
    const custom = Object.fromEntries(Object.keys(expected).map(key => [key, `writer-${key}`]));
    const changed = renderToStaticMarkup(createElement(bundles[1], { contract: { ...contract, copy: custom } }));
    assert.match(changed, /writer-title/);
    assert.match(changed, /writer-description/);
    if (contract.inputs?.length) for (const label of ['inputsLabel', 'input', 'type', 'required', 'yes', 'no']) assert.ok(changed.includes(`writer-${label}`));
    if (contract.facts.length) for (const label of ['factsLabel', 'fact', 'value']) assert.ok(changed.includes(`writer-${label}`));
    if (contract.lists.some(list => !list.items.length)) assert.ok(changed.includes('writer-none'));
  }
});
