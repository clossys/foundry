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
const library = join(root, 'clossys/library/sections.studio.publications/studio-publications');
const source = join(root, 'packages/producer/studio/sections/studio-publications');
const expected = { root: 'Root', path: 'Path', page: 'Page', frame: 'Frame', sections: 'Sections', status: 'Status', leaf: 'Leaf', none: 'None',
  oneRoute: '1 route', manyRoutes: '{count} routes', routesLabel: '{title} routes' };

test('Publications copy resolves all existing labels as draft and its normal pinned payload matches', async () => {
  await checkPayload({ slot: 'sections.studio.publications', element: 'studio-publications', version: 3, versionDir: join(library, 'v3'), studioDir: source,
    payload: ['LICENCE.md', 'index.tsx', 'registry-item.json'] });
  const registry = await studioCopyRegistry(join(root, 'clossys'));
  for (const [field, text] of Object.entries(expected)) {
    const id = `studio.publications-${field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    assert.deepEqual(registry.entries.find(entry => entry.id === id), { id, text, context: 'lib/publications-copy.ts, sections/studio-publications/index.tsx', status: 'draft' });
  }
  const candidateDir = join(root, 'clossys/agents/designer/sections.extensions/extensions/sections.studio.publications');
  const pin = JSON.parse(await readFile(join(candidateDir, 'pin.json'), 'utf8'));
  const bytes = await readFile(join(candidateDir, 'candidates', pin.candidate), 'utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const candidate = JSON.parse(bytes);
  assert.equal(candidate.files.find(file => file.path === 'index.tsx').content, await readFile(join(source, 'index.tsx'), 'utf8'));
});

test('Writer input preserves exact Publications markup across all conditional branches', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'publications-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root, 'packages/producer/package.json'));
  const copyBundle = join(dir, 'copy.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/publications-copy.ts')], outfile: copyBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { publicationsCopy, publicationCopy } = await import(copyBundle);
  const copy = publicationsCopy();
  assert.deepEqual(copy, Object.fromEntries(Object.entries(expected).slice(0, 8)));
  const bundles = [];
  // Pinned v2 already differs by max-w-(--measure); compare the actual pre-cut Producer source.
  for (const [version, entry] of [['before', join(root, 'packages/producer/scripts/__fixtures__/studio-publications-before-copy.tsx')], ['v3', join(library, 'v3/index.tsx')]]) {
    const out = join(dir, `${version}.cjs`);
    await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
      alias: { '@clossys/designer-ui': join(root, 'packages/designer/ui/src/index.ts'), '@': join(root, 'packages/designer/ui/src') },
      nodePaths: [join(root, 'node_modules')] });
    // Keep React's server render and components on the same instance.
    bundles.push(require(out).default);
  }
  const route = { key: 'home', path: '/', pageId: 'home', frame: 'frame', sections: ['header', 'body'], status: { label: 'Ready', tone: 'secondary' } };
  const empty = { id: 'empty', title: 'Empty', root: 'localhost', rootNote: '', routes: [] };
  const single = { id: 'single', title: 'Single', root: 'localhost', rootNote: 'Local preview', routes: [route] };
  const linked = { id: 'linked', title: 'Linked', root: 'localhost', rootNote: 'Local preview', notice: 'Recorded notice',
    routes: [{ ...route, leaf: { label: 'Home leaf', href: '/leaf/home' } }, { ...route, key: 'about', path: '/about', sections: [], status: { label: 'Pending', tone: 'outline' } }] };
  for (const rows of [[], [empty], [single], [linked], [empty, single, linked]]) {
    const publications = { title: 'Publications', description: 'Existing description', publications: rows };
    const projected = { ...publications, copy, publications: rows.map(publication => ({ ...publication, copy: publicationCopy(publication) })) };
    const before = renderToStaticMarkup(createElement(bundles[0], { publications }));
    const after = renderToStaticMarkup(createElement(bundles[1], { publications: projected }));
    assert.equal(after, before);
    const custom = Object.fromEntries(Object.keys(copy).map(key => [key, `writer-${key}`]));
    const changed = renderToStaticMarkup(createElement(bundles[1], { publications: { ...projected, copy: custom,
      publications: projected.publications.map(publication => ({ ...publication, copy: { routeCount: 'writer-route-count', routesLabel: 'writer-routes-label' } })) } }));
    if (rows.length) {
      for (const label of Object.keys(copy).filter(key => key !== 'none')) assert.ok(changed.includes(`writer-${label}`));
      assert.ok(changed.includes('writer-route-count'));
      assert.ok(changed.includes('aria-label="writer-routes-label"'));
    }
    if (rows.some(publication => publication.routes.some(route => !route.leaf))) assert.ok(changed.includes('writer-none'));
    if (rows.includes(linked)) assert.ok(changed.includes('href="/leaf/home"'));
  }
  for (const count of [0, 1, 2, 1000]) {
    const result = publicationCopy({ ...empty, routes: Array(count) });
    assert.equal(result.routeCount, count === 1 ? '1 route' : `${count} routes`);
    assert.equal(result.routesLabel, 'Empty routes');
  }
});
