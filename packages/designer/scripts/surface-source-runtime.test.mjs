import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSourceEsm } from './lib/surface-source-runtime.mjs';

test('actual current token-aware class source executes its top-level await', async () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const closure = await runSourceEsm(root, async load => (await load('packages/designer/src/components/internal/cx.ts')).cx);
  assert.equal(closure('px-md', 'px-lg'), 'px-lg');
});

test('SYNTHETIC static and dynamic same-specifier edges preserve installed bytes and fresh source closures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-source-esm-'));
  const dependency = path.join(root, 'packages/fixture');
  const probe = path.join(root, 'packages/probe');
  await mkdir(path.join(dependency, 'src'), { recursive: true });
  await mkdir(path.join(dependency, 'dist'), { recursive: true });
  await mkdir(path.join(probe, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/@clossys'), { recursive: true });
  await writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: '@clossys/fixture', type: 'module', exports: { '.': { import: './dist/index.js' } } }));
  await writeFile(path.join(probe, 'package.json'), JSON.stringify({ name: '@clossys/probe', type: 'module' }));
  await symlink(dependency, path.join(root, 'node_modules/@clossys/fixture'), 'dir');
  const distribution = 'export const value = await Promise.resolve("installed-distribution");\n';
  await writeFile(path.join(dependency, 'dist/index.js'), distribution);
  await writeFile(path.join(dependency, 'src/index.ts'), 'export const value: string = await Promise.resolve("source-one");\n');
  await writeFile(path.join(probe, 'src/index.ts'), [
    'import { value } from "@clossys/fixture";',
    'export const installed = await import("@clossys/fixture");',
    'export const address = import.meta.resolve("@clossys/fixture");',
    'export function sourceClosure() { return value; }',
  ].join('\n'));
  const first = await runSourceEsm(root, load => load('packages/probe/src/index.ts'));
  assert.equal(first.sourceClosure(), 'source-one');
  assert.equal(first.installed.value, 'installed-distribution');
  assert.equal(fileURLToPath(first.address), path.join(dependency, 'dist/index.js'));
  assert.equal(await readFile(fileURLToPath(first.address), 'utf8'), distribution);
  await writeFile(path.join(dependency, 'src/index.ts'), 'export const value: string = await Promise.resolve("source-two");\n');
  const second = await runSourceEsm(root, load => load('packages/probe/src/index.ts'));
  assert.equal(second.sourceClosure(), 'source-two');
  assert.equal(first.sourceClosure(), 'source-one');
  assert.equal(second.installed.value, 'installed-distribution');
});

test('source hooks are removed after a rejected caller and reject entries outside the owned source tree', async () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  await assert.rejects(runSourceEsm(root, async () => { throw new Error('Controlled caller rejection'); }), /Controlled caller rejection/);
  await assert.rejects(runSourceEsm(root, load => load('package.json')), /existing workspace source/);
  const answer = await runSourceEsm(root, async load => typeof (await load('packages/designer/src/catalog-core/digest.ts')).sha256);
  assert.equal(answer, 'function');
});
