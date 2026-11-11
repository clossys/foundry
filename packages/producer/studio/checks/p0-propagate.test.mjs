import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMutations, discoverAdapter, runCommand, runPropagation, validateAdapter, parseArgs } from './p0-propagate.mjs';
// The theme-probe pin helpers live in the slot writer (the pin step's own module); the probe never writes a pin itself.
const { repointedThemePin: repin } = await import(new URL('../../dist/records/slot-write.js', import.meta.url).href);
import { studioOrigin } from './studio-origin.mjs';

// Fixtures live in the OS temp directory (TMPDIR), never under the checkout (a write there dirties the tree), and are removed after the run.
const artifacts = await mkdtemp(join(tmpdir(), 'p0-propagate-'));
after(() => rm(artifacts, { recursive: true, force: true }));
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
  const prefixed = ':root { --other--primary: #000000; --primary: #ffffff; }';
  const exact = createMutations(prefixed, originalButton, 6);
  assert.equal(exact.primary, ':root { --other--primary: #000000; --primary: color-mix(in srgb, #ffffff 70%, transparent); }');
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
  // The default evidence directory (no --evidence-dir) never writes under the checkout.
  assert.deepEqual(await readdir(f.root), ['packages']);
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


test('CSS variable, component source, rendered selector and rebuild seam are configurable without a UI path guess', async () => {
  const f = await fixture();
  const customCSS = originalCSS.replaceAll('--primary', '--brand-action');
  await writeFile(join(f.root, f.adapter.primarySource), customCSS);
  const parsed = parseArgs([
    '--css-source', f.adapter.primarySource, '--component-source', f.adapter.buttonSource,
    '--css-variable', '--brand-action', '--route', '/components/button',
    '--build-command', '["fixture-build","ui"]', '--build-command', '["fixture-build","studio"]',
  ]);
  const adapter = await discoverAdapter(f.root, undefined, parsed.overrides);
  assert.equal(adapter.buttonSelector, '[data-slot="button"]');
  assert.equal(adapter.cssVariable, '--brand-action');
  assert.equal(adapter.buttonSource, f.adapter.buttonSource);
  assert.deepEqual(adapter.buildCommands, f.adapter.buildCommands);
  const samples = [];
  await runPropagation({ root: f.root, adapter, driver: { sample: async (url, selector, variable) => {
    samples.push({ url, selector, variable });
    return samples.length === 1 ? baseline : propagated;
  } }, execute: async () => {} });
  assert.equal(samples.length, 2);
  assert.ok(samples.every(sample => sample.selector === '[data-slot="button"]' && sample.variable === '--brand-action'));
  assert.deepEqual(await f.contents(), [customCSS, originalButton]);
  const changed = createMutations(customCSS, originalButton, 6, 1, '--brand-action');
  assert.match(changed.primary, /--brand-action: color-mix\(in srgb, #ffffff 70%, transparent\)/);
  assert.throws(() => createMutations(customCSS, originalButton, 6, 0, '--other'), /no matching --other/);
});

test('the CLI defaults to the single Studio origin and can own its Studio and evidence directory', () => {
  assert.equal(parseArgs([]).baseURL, studioOrigin(), 'the default is $STUDIO_ORIGIN, else the single preview port');
  const owned = parseArgs(['--own-studio', '--evidence-dir', 'out/propagation']);
  assert.equal(owned.ownStudio, true);
  assert.equal(owned.artifactDir, resolve('out/propagation'));
  assert.deepEqual(owned.overrides, {});
});

test('CLI rejects ambiguous or shell-shaped build commands and invalid CSS property names', async () => {
  assert.throws(() => parseArgs(['--build-command', 'npm run build']), /JSON executable/);
  assert.throws(() => parseArgs(['--build-command', '"npm run build"']), /JSON executable/);
  assert.throws(() => parseArgs(['--route', '/', '--route', '/other']), /Usage/);
  assert.throws(() => parseArgs(['--unknown', 'value']), /Usage/);
  assert.throws(() => parseArgs(['--own-studio', '--base-url', 'http://127.0.0.1:4503']), /Usage/);
  assert.throws(() => parseArgs(['--base-url', 'http://127.0.0.1:4503', '--own-studio']), /Usage/);
  assert.throws(() => parseArgs(['--own-studio', '--own-studio']), /Usage/);
  const f = await fixture();
  await assert.rejects(validateAdapter(f.root, { ...f.adapter, cssVariable: '--primary);color:red' }), /CSS custom property name/);
  const adapter = await validateAdapter(f.root, { ...f.adapter, buttonSelector: undefined });
  assert.equal(adapter.buttonSelector, '[data-slot="button"]');
});

test('the checked-in adapter resolves the real tree without discovery (F3)', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const adapter = await discoverAdapter(repository);
  // --primary is mutated at its compiled source (the pinned themes.primary candidate), not a hand copy.
  assert.equal(adapter.primarySource, 'clossys/agents/designer/themes.primary/candidates/primary-v1.json');
  assert.equal(adapter.primaryFormat, 'theme-json');
  assert.equal(adapter.theme.id, 'themes.primary');
  assert.equal(adapter.theme.consumer, resolve(repository, 'clossys'));
  assert.equal(adapter.theme.original, await readFile(resolve(repository, 'clossys/agents/designer/themes.primary/pin.json'), 'utf8'));
  assert.match(adapter.buttonSelector, /\[data-size="default"\]/);
  assert.equal(adapter.buttonSource, 'packages/designer/ui/src/components/ui/button.tsx');
  assert.deepEqual(adapter.buildCommands, [['node', 'packages/producer/scripts/build-studio.mjs']]);
  // The adapter's sources are the ones the real tree mutates: a literal --primary and the primary shadcn button.
  const [primary, button] = await Promise.all([readFile(adapter.primaryPath, 'utf8'), readFile(adapter.buttonPath, 'utf8')]);
  const mutation = createMutations(primary, button, 8, adapter.primaryOccurrence, adapter.cssVariable, adapter.primaryFormat);
  assert.notEqual(mutation.primary, primary);
  assert.match(JSON.parse(mutation.primary).cssVars.light.primary, /^color-mix\(in srgb, .+ 70%, transparent\)$/);
  assert.notEqual(mutation.button, button);
});

const sha = text => createHash('sha256').update(text).digest('hex');
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;
const themeItem = canonical({ name: 'primary', type: 'registry:theme', cssVars: { light: { primary: '#8250DF' }, dark: { primary: '#A371F7' } } });

async function themeFixture({ item = themeItem, pin } = {}) {
  const f = await fixture();
  const slot = join(f.root, 'clossys/agents/designer/themes.primary');
  await mkdir(join(slot, 'candidates'), { recursive: true });
  await writeFile(join(slot, 'candidates/primary-v1.json'), item);
  const pinText = pin ?? canonical({ candidate: 'primary-v1.json', sha256: sha(item), decidedBy: 'owner:fixture', basis: 'bulk', at: '2026-11-03T08:58:02Z' });
  await writeFile(join(slot, 'pin.json'), pinText);
  const adapter = { ...f.adapter, primarySource: 'clossys/agents/designer/themes.primary/candidates/primary-v1.json' };
  const contents = () => Promise.all(['clossys/agents/designer/themes.primary/candidates/primary-v1.json', adapter.buttonSource, 'clossys/agents/designer/themes.primary/pin.json'].map(path => readFile(join(f.root, path), 'utf8')));
  return { ...f, adapter, contents, pinText };
}

test('a compiled-theme source mutates the pinned candidate cssVars in compiled order and keeps the pin selecting it', async () => {
  const light = createMutations(themeItem, originalButton, 6, 0, '--primary', 'theme-json');
  assert.equal(JSON.parse(light.primary).cssVars.light.primary, 'color-mix(in srgb, #8250DF 70%, transparent)');
  assert.equal(JSON.parse(light.primary).cssVars.dark.primary, '#A371F7');
  assert.equal(light.primary, canonical(JSON.parse(light.primary)));
  const dark = createMutations(themeItem, originalButton, 6, 1, '--primary', 'theme-json');
  assert.equal(JSON.parse(dark.primary).cssVars.dark.primary, 'color-mix(in srgb, #A371F7 70%, transparent)');
  assert.throws(() => createMutations(themeItem, originalButton, 6, 2, '--primary', 'theme-json'), /declares no matching --primary/);
  assert.throws(() => createMutations(JSON.stringify(JSON.parse(themeItem)), originalButton, 6, 0, '--primary', 'theme-json'), /not canonical JSON/);
  assert.throws(() => createMutations(canonical({ type: 'registry:theme', cssVars: { light: { primary: 'var(--brand)' } } }), originalButton, 6, 0, '--primary', 'theme-json'), /literal CSS color/);
  const f = await themeFixture();
  const next = JSON.parse(repin(f.pinText, light.primary));
  assert.deepEqual(next, { ...JSON.parse(f.pinText), sha256: sha(light.primary) });
});

test('a compiled-theme source refuses a pin that does not select its exact bytes', async () => {
  const other = await themeFixture({ pin: canonical({ candidate: 'primary-v2.json', sha256: sha(themeItem) }) });
  await assert.rejects(validateAdapter(other.root, other.adapter), /selects primary-v2\.json/);
  const drifted = await themeFixture({ pin: canonical({ candidate: 'primary-v1.json', sha256: '0'.repeat(64) }) });
  await assert.rejects(validateAdapter(drifted.root, drifted.adapter), /does not match primary-v1\.json/);
  const loose = await themeFixture({ pin: JSON.stringify({ candidate: 'primary-v1.json', sha256: sha(themeItem) }) });
  await assert.rejects(validateAdapter(loose.root, loose.adapter), /not canonical JSON/);
});

test('compiled-theme propagation builds with the candidate and its pin mutated together, then restores all three files', async () => {
  const f = await themeFixture();
  const originals = await f.contents();
  const seen = [];
  const after = { ...propagated, primary: 'color-mix(in srgb, #8250DF 70%, transparent)' };
  const states = [{ ...baseline, primary: '#8250DF' }, after];
  const outcome = await runPropagation({ root: f.root, adapter: f.adapter, artifactDir: join(f.root, '..', `evidence-${sequence++}`), driver: { sample: async () => states.shift(), close: async () => {} }, execute: async () => {
    const [item, button, pin] = await f.contents();
    seen.push({ item, button, pin });
  } });
  assert.equal(outcome.status, 'passed');
  assert.equal(outcome.primaryFormat, 'theme-json');
  assert.equal(outcome.sourceRestored, true);
  // The fixture adapter has two build commands: both mutated builds, then both restoration builds.
  assert.equal(seen.length, 4);
  const [mutated, , restored] = seen;
  assert.deepEqual(seen[1], mutated);
  assert.deepEqual(seen[3], restored);
  assert.equal(JSON.parse(mutated.item).cssVars.light.primary, 'color-mix(in srgb, #8250DF 70%, transparent)');
  assert.equal(JSON.parse(mutated.pin).sha256, sha(mutated.item));
  assert.notEqual(mutated.button, originals[1]);
  assert.deepEqual([restored.item, restored.button, restored.pin], originals);
  assert.deepEqual(await f.contents(), originals);
});

test('the probe reaches no pin but a Designer themes.* slot pin (no Publisher, Writer or Director pin)', async () => {
  const { repointThemeProbePin, restoreThemeProbePin, readThemeProbePin } = await import(new URL('../../dist/records/slot-write.js', import.meta.url).href);
  const f = await themeFixture();
  const consumer = join(f.root, 'clossys');
  for (const id of ['page.home', 'publication.studio', 'strings.errors', 'context.market.size', '../publisher/page.home', 'themes']) {
    assert.throws(() => readThemeProbePin(consumer, id, 'primary-v1.json', themeItem), /not a Designer themes\.\* slot/);
    assert.throws(() => repointThemeProbePin(consumer, id, f.pinText, themeItem), /not a Designer themes\.\* slot/);
    assert.throws(() => restoreThemeProbePin(consumer, id, f.pinText), /not a Designer themes\.\* slot/);
  }
  // A Publisher page candidate as the primary source is refused before anything is written.
  const page = join(f.root, 'clossys/agents/publisher/page.home/candidates');
  await mkdir(page, { recursive: true });
  await writeFile(join(page, 'page-v1.json'), themeItem);
  await assert.rejects(validateAdapter(f.root, { ...f.adapter, primarySource: 'clossys/agents/publisher/page.home/candidates/page-v1.json' }), /Designer themes\.\* slot candidate/);
});
