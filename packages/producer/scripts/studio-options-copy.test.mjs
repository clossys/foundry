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
const source = join(root, 'packages/producer/studio/sections/studio-options');
const expected = { title: 'Options (pending approval)', key: 'Key', text: 'Text', added: 'Added', changed: 'Changed', removed: 'Removed', same: 'Same',
  pinnedTitle: '{name} v{version}, pinned', optionTitle: '{name} v{version}, option', stringsLabel: '{name} v{version} strings' };

test('Options copy resolves all existing labels as draft and its normal pinned payload matches', async () => {
  await checkPayload({ slot: 'sections.studio.options', element: 'studio-options', version: 2, files: await candidateFiles(join(root, 'clossys'), 'sections.studio.options', 'studio-options-v2.json'), studioDir: source,
    payload: ['LICENCE.md', 'index.tsx', 'registry-item.json'] });
  const registry = await studioCopyRegistry(join(root, 'clossys'));
  for (const [field, text] of Object.entries(expected)) {
    const id = `studio.options-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    assert.deepEqual(registry.entries.find(entry => entry.id === id), { id, text, context: 'lib/options-copy.ts, sections/studio-options/index.tsx', status: 'draft' });
  }
  const candidateDir = join(root, 'clossys/agents/designer/sections.studio.options');
  const pin = JSON.parse(await readFile(join(candidateDir, 'pin.json'), 'utf8'));
  const bytes = await readFile(join(candidateDir, 'candidates', pin.candidate), 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.files.find(file => file.path === 'index.tsx').content, await readFile(join(source, 'index.tsx'), 'utf8'));
});

test('Writer input preserves exact Options markup across all conditional branches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'options-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root, 'packages/producer/package.json'));
  const copyBundle = join(dir, 'copy.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/options-copy.ts')], outfile: copyBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { optionsCopy, optionCopy } = await import(copyBundle);
  const copy = optionsCopy();
  assert.equal(copy.title, expected.title);
  assert.deepEqual(copy.changeLabels, { added: 'Added', changed: 'Changed', removed: 'Removed', same: 'Same' });
  const bundles = [];
  // Pinned v1 predates inherited viewport/class changes; compare exact pre-cut running source.
  for (const [version, entry] of [['before', join(root, 'packages/producer/scripts/__fixtures__/studio-options-before-copy.tsx')], ['v2', join(await materializeCandidate(join(root, 'clossys'), 'sections.studio.options', 'studio-options-v2.json', join(dir, 'candidate-v2')), 'index.tsx')]]) {
    const out = join(dir, `${version}.cjs`);
    await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      alias: { '@clossys/designer-ui': join(root, 'packages/designer/ui/src/index.ts'), '@': join(root, 'packages/designer/ui/src') },
      nodePaths: [join(root, 'node_modules')],
      plugins: [{ name: 'existing-preview-module', setup(build) {
        // R2F-03: the specimen section no longer ships its own BlockViewerIframe module; both historical
        // sources resolve it to the one pinned components.studio.block-viewer-iframe export, so the
        // compared markup shares one frame and the test still pins the copy cut alone.
        build.onResolve({ filter: /^\.\.\/studio-specimen\/BlockViewerIframe$/ }, () => ({ path: 'block-viewer-iframe', namespace: 'pinned-frame' }));
        build.onLoad({ filter: /.*/, namespace: 'pinned-frame' }, () => ({ contents: "export { BlockViewerIframe } from '@clossys/designer-ui';", resolveDir: root, loader: 'ts' }));
      } }] });
    // Keep React's server render and components on the same instance.
    bundles.push(require(out).default);
  }
  const strings = { version: 1, pinned: false, label: 'Option v1', reason: '', preview: { kind: 'strings', rows: [
    { key: 'new', text: 'New text', change: 'added' }, { key: 'edited', text: 'Edited text', change: 'changed' },
    { key: 'deleted', text: 'Old text', change: 'removed' }, { key: 'stable', text: 'Same text', change: 'same' },
  ] } };
  const pinned = { version: 2, pinned: true, label: 'Pinned v2', reason: 'Recorded pin', preview: { kind: 'frame', src: '/__specimen?element=example&width=768&v=2', viewport: 768 } };
  const unpinned = { ...pinned, version: 3, pinned: false, label: 'Option v3', reason: '', preview: { kind: 'frame', src: '/__specimen?element=example&width=1280&v=3', viewport: 1280 } };
  const note = { version: 4, pinned: false, label: 'Option v4', reason: 'Recorded note', preview: { kind: 'note', text: 'No preview recorded.' } };
  for (const rows of [[], [strings], [pinned], [unpinned], [note], [strings, pinned, unpinned, note]]) {
    const options = { name: 'Example', description: 'Recorded candidates', rows };
    const projected = { ...options, copy, rows: rows.map(row => ({ ...row, copy: optionCopy(options.name, row) })) };
    const before = renderToStaticMarkup(createElement(bundles[0], { options }));
    const after = renderToStaticMarkup(createElement(bundles[1], { options: projected }));
    assert.equal(after, before);
    const changed = renderToStaticMarkup(createElement(bundles[1], { options: { ...projected,
      copy: { title: 'writer-title', key: 'writer-key', text: 'writer-text', changeLabels: { added: 'writer-added', changed: 'writer-changed', removed: 'writer-removed', same: 'writer-same' } },
      rows: projected.rows.map(row => ({ ...row, copy: { frameTitle: 'writer-frame-title', stringsLabel: 'writer-strings-label' } })),
    } }));
    assert.ok(changed.includes('writer-title'));
    if (rows.includes(strings)) for (const label of ['key', 'text', 'added', 'changed', 'removed', 'strings-label']) assert.ok(changed.includes(`writer-${label}`));
    if (rows.some(row => row.preview.kind === 'frame')) assert.ok(changed.includes('title="writer-frame-title"'));
    assert.ok(!changed.includes('writer-same'));
  }
  assert.deepEqual(optionCopy('Example', { version: 1000, pinned: true }), { frameTitle: 'Example v1000, pinned', stringsLabel: 'Example v1000 strings' });
  assert.equal(optionCopy('Example', { version: 0, pinned: false }).frameTitle, 'Example v0, option');
  const callersBundle = join(dir, 'callers.mjs');
  await build({ stdin: { contents: `export { slotDetailInputs } from './packages/producer/studio/lib/slot-detail.ts';`, resolveDir: root },
    outfile: callersBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { slotDetailInputs } = await import(callersBundle);
  const links = { leaf: () => '/leaf', back: { href: '/writer', label: 'Writer' } };
  const detail = { agent: 'writer', id: 'strings.example', kind: 'strings', trail: [], contract: {}, inputs: [], uses: [], usedBy: [], links: [], pin: null, history: [], checks: [], candidates: [], shown: null };
  const canonical = slotDetailInputs(detail, links, 'light').options;
  assert.deepEqual(canonical.copy, copy);
  assert.deepEqual(canonical.rows, []);
  // The pinned candidate leads, then options by version, each with its own frame title.
  const row = (version, pinned) => ({ name: `example-v${version}.json`, version, pinned, content: '', issues: [], sha256: '' });
  const projected = slotDetailInputs({ ...detail, candidates: [row(2, false), row(1, true)], shown: 'example-v1.json' }, links, 'light').options;
  assert.deepEqual(projected.copy, copy);
  assert.deepEqual(projected.rows.map(entry => entry.copy.frameTitle), ['strings.example v1, pinned', 'strings.example v2, option']);
});
