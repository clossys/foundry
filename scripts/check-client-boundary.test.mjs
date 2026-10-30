import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkClientBoundary } from './check-client-boundary.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = fs.mkdtempSync(path.join(repositoryRoot, 'node_modules/.cache/tmp/client-boundary-test-'));
const script = path.join(repositoryRoot, 'scripts/check-client-boundary.mjs');
function fixture(name, files, exports = { './web': { import: './web.js' } }) {
  const root = path.join(evidence, name, 'node_modules/@fixture/publisher');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@fixture/publisher', version: '1.0.0', type: 'module', exports,
    files: ['*.js'], scripts: { prepack: `node ${JSON.stringify(script)} . --report ${JSON.stringify(path.join(root, 'report.json'))}` } }));
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), contents);
  }
  return root;
}
async function measure(root) {
  const report = await checkClientBoundary(root);
  fs.writeFileSync(path.join(root, 'measured.json'), JSON.stringify(report, null, 2));
  return report;
}
test('complete namespace graph includes unused exports and production/development targets', async () => {
  const root = fixture('clean', { 'web.js': 'export { value } from "./pure.js";', 'pure.js': 'export const value = 1;',
    'preview.js': 'export const preview = true;' }, { './web': { import: './web.js' }, './web/new-view': { development: './preview.js', default: './web.js' } });
  const report = await measure(root);
  assert.equal(report.exitCode, 0);
  assert.equal(report.graphs.length, 4);
  assert(report.graphs.every(graph => graph.inputs.length >= 1));
  assert(report.source.head.match(/^[a-f0-9]{40}$/));
});
for (const [name, files, last] of [
  ['direct', { 'web.js': 'import "node:fs"; export const value = 1;' }, 'node:fs'],
  ['transitive', { 'web.js': 'export { value } from "./middle.js";', 'middle.js': 'import "./server.js"; export const value = 1;', 'server.js': 'import "node:path";' }, 'node:path'],
  ['exported-server', { 'web.js': 'export const safe = 1; export { readFileSync } from "node:fs";' }, 'node:fs'],
  ['server-marker', { 'web.js': 'import "server-only"; export const value = 1;' }, 'server-only'],
  ['bare-builtin', { 'web.js': 'export { readFileSync } from "fs";' }, 'fs'],
  ['react-server', { 'web.js': 'export * from "react-dom/server";' }, 'react-dom/server'],
  ['opaque-dynamic', { 'web.js': 'export const load = name => import(name);' }, '<nonliteral module edge>'],
]) test(`${name} mutation fails with an actionable importer chain`, async () => {
  const root = fixture(name, files), report = await measure(root);
  assert.equal(report.exitCode, 1);
  const violation = report.graphs[0].violations.find(row => row.specifier === last);
  assert(violation);
  assert.equal(violation.chain[0].specifier, '@fixture/publisher/web');
  assert.equal(violation.chain.at(-1).specifier, last);
  if (name === 'transitive') assert.equal(violation.chain.length, 4);
});
test('first-party packages are followed rather than externalized', async () => {
  const root = fixture('cross-package', { 'web.js': 'export * from "@fixture/server";' });
  const server = path.join(path.dirname(root), 'server');
  fs.mkdirSync(server);
  fs.writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: '@fixture/server', type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(server, 'index.js'), 'export * from "node:os";');
  assert.equal((await measure(root)).exitCode, 1);
});
test('new web exports automatically join the census', async () => {
  const root = fixture('new-export', { 'web.js': 'export const safe = 1;', 'new.js': 'import "node:fs";' }, {
    './web': './web.js', './web/new-entry': './new.js',
  });
  const report = await measure(root);
  assert.equal(report.exitCode, 1);
  assert.equal(report.census.filter(row => row.checked).length, 2);
});
test('missing entry, missing transitive input, empty census and missing metafile fail closed', async () => {
  const missing = fixture('missing-entry', {});
  assert.equal((await measure(missing)).exitCode, 2);
  const transitive = fixture('missing-transitive', { 'web.js': 'export * from "./absent.js";' });
  assert.notEqual((await measure(transitive)).exitCode, 0);
  const empty = fixture('empty', { 'pure.js': 'export const value=1;' }, { './pure': './pure.js' });
  assert.equal((await measure(empty)).exitCode, 2);
  const incomplete = fixture('missing-graph', { 'web.js': 'export const value=1;' });
  const report = await checkClientBoundary(incomplete, { build: async () => ({}) });
  fs.writeFileSync(path.join(incomplete, 'measured.json'), JSON.stringify(report, null, 2));
  assert.equal(report.exitCode, 2);
});
test('actual npm pack lifecycle refuses an unused server export before creating a tarball', () => {
  const root = fixture('pack-hook', { 'web.js': 'export const safe = 1; export * from "node:fs";' });
  const result = spawnSync('npm', ['pack', '--offline', '--json', '--pack-destination', evidence], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'pack.log'), result.stdout + result.stderr);
  assert.notEqual(result.status, 0);
  assert.equal(readReport(root).exitCode, 1);
  assert.equal(fs.readdirSync(evidence).some(name => name.endsWith('.tgz')), false);
});
function readReport(root) { return JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')); }
console.log(`Boundary mutation evidence retained: ${evidence}`);
