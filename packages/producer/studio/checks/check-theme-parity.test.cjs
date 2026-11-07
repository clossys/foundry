'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { hashCss, inspectTheme, inspectSelectionRecord, checkThemeParity } = require('./check-theme-parity.cjs');

// Synthetic compiler bytes exercise brand application; no real brand is copied.
const css = ':root {\n  --color-action: #123456;\n}\n';
function fixture(value = css, source = 'consumer') {
  const hash = hashCss(value);
  const theme = { source, css: value, hash };
  return { config: { theme }, applied: { count: 1, css: value, enabled: true, unbrandedNotice: source === 'foundry', computed: [{ property: '--color-action', expected: '#123456', actual: '#123456' }] } };
}

// The brand arrives as Studio's projected consumer-precedence document stylesheet.
async function server(t, data, servedCss = data.config.theme.css, rootOverride = '') {
  const instance = createServer((request, response) => {
    const type = { '/api/config': 'application/json', '/brand.css': 'text/css' }[request.url] ?? 'text/html';
    response.setHeader('Content-Type', type);
    response.end(request.url === '/api/config' ? JSON.stringify(data.config) : request.url === '/brand.css' ? servedCss : `<html style="${rootOverride}"><head><link rel="stylesheet" href="/brand.css" data-precedence="consumer"></head><body>${data.config.theme.source === 'foundry' ? '<div data-frame-notices>Unbranded: using the default theme.</div>' : ''}</body></html>`);
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('browser accepts two different consumer brands', async t => {
  const [first, second] = await Promise.all([server(t, fixture()), server(t, fixture(css.replace('#123456', '#654321')))]);
  const result = await checkThemeParity([first, second], { requireDifferent: true });
  assert.equal(result.studios, 2);
  assert.notEqual(...result.hashes);
});

test('browser rejects a projected stylesheet that serves other bytes than the consumer config', async t => {
  const [first, second] = await Promise.all([server(t, fixture()), server(t, fixture(), '/* stock component theme */')]);
  await assert.rejects(checkThemeParity([first, second]), /applied Studio CSS differs/);
});

test('browser rejects a live token override despite matching API and stylesheet bytes', async t => {
  const [first, second] = await Promise.all([server(t, fixture()), server(t, fixture(), css, '--color-action: #000000')]);
  await assert.rejects(checkThemeParity([first, second]), /live computed theme properties differ/);
});

test('a different applied token fails even when the config claims consumer equality', () => {
  const original = fixture();
  assert.throws(() => inspectTheme(original.config, { ...original.applied, css: css.replace('#123456', '#654321') }, 'Studio'), /applied Studio CSS differs/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, computed: [{ property: '--color-action', expected: '#123456', actual: '#654321' }] }, 'Studio'), /live computed theme properties differ/);
});

test('a stale or forged config hash and a missing, duplicated or disabled stylesheet fail', () => {
  const original = fixture();
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, css: css.replace('#123456', '#654321') } }, original.applied, 'Studio'), /config theme hash does not match/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, count: 0 }, 'Studio'), /expected one applied/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, count: 2 }, 'Studio'), /expected one applied/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, enabled: false }, 'Studio'), /stylesheet is disabled/);
});

test('default fallback requires a visible unbranded notice and cannot hide a compiler failure', () => {
  const original = fixture(css, 'foundry');
  assert.equal(inspectTheme(original.config, original.applied, 'Studio'), hashCss(css));
  assert.throws(() => inspectTheme(original.config, { ...original.applied, unbrandedNotice: false }, 'Studio'), /missing visible unbranded notice/);
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, message: 'Compilation failed' } }, original.applied, 'Studio'), /compilation failure/);
});

test('a slot-model selection needs pinned leaves and a hash that covers them', () => {
  const leaves = [{ leaf: 'frames.example', source: 'consumer', fill: 'example@v2', hash: `sha256:${'a'.repeat(64)}` }];
  const selection = { hash: hashCss(JSON.stringify(leaves)), leaves, gateReports: [] };
  inspectSelectionRecord(selection, 'Studio');
  assert.throws(() => inspectSelectionRecord({ ...selection, leaves: [] }, 'Studio'), /no leaves/);
  assert.throws(() => inspectSelectionRecord({ message: 'Selection failed' }, 'Studio'), /Selection failed/);
  const unpinned = [{ ...leaves[0], fill: 'example' }];
  assert.throws(() => inspectSelectionRecord({ ...selection, leaves: unpinned, hash: hashCss(JSON.stringify(unpinned)) }, 'Studio'), /without a pinned fill/);
  assert.throws(() => inspectSelectionRecord({ ...selection, hash: hashCss('[]') }, 'Studio'), /does not cover its leaves/);
});
