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
const source = join(root, 'packages/producer/studio/sections/studio-checks');
const expected = { title: 'Checks', check: 'Check', result: 'Result', detail: 'Detail', pass: 'Pass', finding: 'Finding',
  allPass: 'All {count} checks pass.', findings: '{failing} of {count} checks report a finding.' };

test('Checks copy resolves all existing labels as draft and its normal pinned payload matches', async () => {
  await checkPayload({ slot: 'sections.studio.checks', element: 'studio-checks', version: 2, files: await candidateFiles(join(root, 'clossys'), 'sections.studio.checks', 'studio-checks-v2.json'), studioDir: source,
    payload: ['LICENCE.md', 'index.tsx', 'registry-item.json'] });
  const registry = await studioCopyRegistry(join(root, 'clossys'));
  for (const [field, text] of Object.entries(expected)) {
    const id = `studio.checks-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    assert.deepEqual(registry.entries.find(entry => entry.id === id), { id, text, context: 'lib/checks-copy.ts, sections/studio-checks/index.tsx', status: 'draft' });
  }
  const candidateDir = join(root, 'clossys/agents/designer/sections.studio.checks');
  const pin = JSON.parse(await readFile(join(candidateDir, 'pin.json'), 'utf8'));
  const bytes = await readFile(join(candidateDir, 'candidates', pin.candidate), 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.files.find(file => file.path === 'index.tsx').content, await readFile(join(source, 'index.tsx'), 'utf8'));
});

test('Writer input preserves exact Checks markup across all conditional branches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'checks-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root, 'packages/producer/package.json'));
  const copyBundle = join(dir, 'copy.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/checks-copy.ts')], outfile: copyBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { checksCopy } = await import(copyBundle);
  const bundles = [];
  for (const version of ['v1', 'v2']) {
    const out = join(dir, `${version}.cjs`);
    await build({ entryPoints: [join(await materializeCandidate(join(root, 'clossys'), 'sections.studio.checks', `studio-checks-${version}.json`, join(dir, `candidate-${version}`)), 'index.tsx')], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      alias: { '@clossys/designer-ui': join(root, 'packages/designer/ui/src/index.ts'), '@': join(root, 'packages/designer/ui/src') },
      nodePaths: [join(root, 'node_modules')] });
    // Keep React's server render and components on the same instance.
    bundles.push(require(out).default);
  }
  const passing = { key: 'pass', label: 'Passing check', ok: true, detail: 'Pass detail' };
  const failing = { key: 'fail', label: 'Failing check', ok: false, detail: 'Finding detail' };
  for (const rows of [[], [passing], [failing], [passing, failing], Array.from({ length: 1000 }, (_, i) => ({ ...passing, key: String(i) }))]) {
    const copy = checksCopy(rows);
    const count = rows.filter(row => !row.ok).length;
    assert.equal(copy.summary, count ? `${count} of ${rows.length} checks report a finding.` : `All ${rows.length} checks pass.`);
    const before = renderToStaticMarkup(createElement(bundles[0], { checks: rows }));
    const after = renderToStaticMarkup(createElement(bundles[1], { checks: { rows, copy } }));
    assert.equal(after, before);
    const custom = Object.fromEntries(Object.keys(copy).map(key => [key, `writer-${key}`]));
    const changed = renderToStaticMarkup(createElement(bundles[1], { checks: { rows, copy: custom } }));
    for (const label of ['title', 'summary', 'check', 'result', 'detail']) assert.ok(changed.includes(`writer-${label}`));
    if (rows.some(row => row.ok)) assert.ok(changed.includes('writer-pass'));
    if (rows.some(row => !row.ok)) assert.ok(changed.includes('writer-finding'));
  }
  // The slot detail caller (the agent leaf caller was removed with the gallery) projects every check row.
  const callersBundle = join(dir, 'callers.mjs');
  await build({ stdin: { contents: `export { slotDetailInputs } from './packages/producer/studio/lib/slot-detail.ts';`, resolveDir: root },
    outfile: callersBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { slotDetailInputs } = await import(callersBundle);
  const links = { leaf: () => '/leaf', back: { href: '/writer', label: 'Writer' } };
  const detail = { agent: 'writer', id: 'strings.example', kind: 'strings', trail: [], contract: {}, inputs: [], uses: [], usedBy: [], links: [], pin: null, history: [], checks: [], candidates: [], shown: null };
  assert.deepEqual(slotDetailInputs(detail, links, 'light').checks, { rows: [], copy: checksCopy([]) });
  assert.deepEqual(slotDetailInputs({ ...detail, checks: [passing] }, links, 'light').checks, { rows: [{ key: '0', ...passing }], copy: checksCopy([passing]) });
});
