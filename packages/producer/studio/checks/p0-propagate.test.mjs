import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMutations, discoverAdapter, runCommand, runPropagation, validateAdapter } from './p0-propagate.mjs';

const artifacts = fileURLToPath(new URL('../../../../ignoredtmp/p0b/propagation/', import.meta.url));
let sequence = 0;
const originalCSS = ':root { --primary: oklch(0.42 0.09 243); }\n.dark { --primary: #ffffff; }\n';
const originalButton = 'const buttonVariants = cva("inline-flex rounded-md", { default: "bg-primary text-primary-foreground" });\n';

async function fixture() {
  const root = join(artifacts, `fixture-${process.pid}-${Date.now()}-${sequence++}`);
  const directory = join(root, 'packages/ui/src');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'theme.css'), originalCSS);
  await writeFile(join(directory, 'button.tsx'), originalButton);
  const adapter = {
    primarySource: 'packages/ui/src/theme.css', buttonSource: 'packages/ui/src/button.tsx',
    buttonSelector: 'button[data-slot="button"]', route: '/components/button',
    buildCommands: [['fixture-build', 'ui'], ['fixture-build', 'studio']],
  };
  const contents = () => Promise.all([readFile(join(root, adapter.primarySource), 'utf8'), readFile(join(root, adapter.buttonSource), 'utf8')]);
  return { root, adapter, contents };
}
const baseline = { primary: 'oklch(0.42 0.09 243)', resolvedPrimary: 'rgb(40, 70, 100)', background: 'rgb(40, 70, 100)', radius: 6 };
const propagated = { primary: 'color-mix(in srgb, oklch(0.42 0.09 243) 70%, transparent)', resolvedPrimary: 'rgba(40, 70, 100, 0.7)', background: 'rgba(40, 70, 100, 0.7)', radius: 9 };

test('mutations change a real primary declaration and a real shadcn radius token only', () => {
  const result = createMutations(originalCSS, originalButton, 6);
  assert.equal(result.primary, ':root { --primary: color-mix(in srgb, oklch(0.42 0.09 243) 70%, transparent); }\n.dark { --primary: #ffffff; }\n');
  assert.equal(result.button, originalButton.replace('rounded-md', 'rounded-[9px]'));
  assert.throws(() => createMutations(originalCSS, 'const button = "rounded-md";', 6), /not the primary shadcn/);
});

test('successful propagation rebuilds mutated sources and restores exact original bytes before final build', async () => {
  const f = await fixture();
  const observed = [];
  let samples = 0;
  const result = await runPropagation({ ...f, driver: { sample: async () => samples++ ? propagated : baseline }, execute: async command => observed.push({ command, sources: await f.contents() }) });
  assert.equal(result.status, 'passed');
  assert.equal(result.sourceRestored, true);
  assert.equal(samples, 2);
  assert.equal(observed.length, 4);
  assert.match(observed[0].sources[0], /color-mix/);
  assert.match(observed[1].sources[1], /rounded-\[9px\]/);
  assert.deepEqual(observed[2].sources, [originalCSS, originalButton]);
  assert.deepEqual(observed[3].sources, [originalCSS, originalButton]);
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('a stale running Studio fails the assertion and still restores/rebuilds both sources', async () => {
  const f = await fixture();
  let builds = 0;
  await assert.rejects(runPropagation({ ...f, driver: { sample: async () => baseline }, execute: async () => { builds++; } }), /did not reach/);
  assert.equal(builds, 4);
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('build failure does not skip source restoration or the restoration build', async () => {
  const f = await fixture();
  let builds = 0;
  await assert.rejects(runPropagation({ ...f, driver: { sample: async () => baseline }, execute: async () => {
    builds++;
    if (builds === 1) throw new Error('injected build failure');
    assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
  } }), /injected build failure/);
  assert.equal(builds, 3);
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('cancellation during the mutation build restores files using an uncancelled build', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let builds = 0;
  await assert.rejects(runPropagation({ ...f, signal: controller.signal, driver: { sample: async () => baseline }, execute: async (_command, _root, signal) => {
    if (++builds === 1) { controller.abort(); throw new Error('injected interrupt'); }
    assert.equal(signal, undefined);
    assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
  } }), /injected interrupt/);
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('restoration build failure is reported after preserving source bytes', async () => {
  const f = await fixture();
  let builds = 0;
  await assert.rejects(runPropagation({ ...f, driver: { sample: async () => baseline }, execute: async () => {
    if (++builds >= 3) throw new Error('injected restoration build failure');
  } }), error => error instanceof AggregateError && /restoration build also failed/.test(error.message));
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('baseline connection failure causes no source mutation and no build', async () => {
  const f = await fixture();
  await assert.rejects(runPropagation({ ...f, driver: { sample: async () => { throw new Error('connection refused'); } }, execute: async () => assert.fail('build must not run') }), /connection refused/);
  assert.deepEqual(await f.contents(), [originalCSS, originalButton]);
});

test('adapter refuses app writes, traversal, and non-array shell build commands', async () => {
  const f = await fixture();
  await assert.rejects(validateAdapter(f.root, { ...f.adapter, primarySource: 'packages/producer/studio/app/globals.css' }), /permitted UI source tree/);
  await assert.rejects(validateAdapter(f.root, { ...f.adapter, primarySource: '../theme.css' }), /permitted UI source tree/);
  await assert.rejects(validateAdapter(f.root, { ...f.adapter, buildCommands: ['npm run build'] }), /executable\/argument arrays/);
});

test('discovery refuses to invent a build seam even when source candidates are unique', async () => {
  const f = await fixture();
  await assert.rejects(discoverAdapter(f.root), /supply p0-propagate.config.json with the actual buildCommands/);
});

test('build command runner propagates a real nonzero subprocess exit', async () => {
  const f = await fixture();
  await assert.rejects(runCommand([process.execPath, '-e', 'process.exit(7)'], f.root), /exited 7/);
});

test('a timed out compiler is stopped before the command runner returns', async () => {
  const f = await fixture();
  await assert.rejects(runCommand([process.execPath, '-e', 'setInterval(() => {}, 1000)'], f.root, undefined, 20), /timed out/);
});

test('an aborted real compiler is stopped before restoration can begin', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const pending = runCommand([process.execPath, '-e', 'setInterval(() => {}, 1000)'], f.root, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});
