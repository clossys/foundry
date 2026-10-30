'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { hashCss, inspectTheme, checkThemeParity } = require('./check-theme-parity.cjs');

// Synthetic compiler bytes exercise brand application; no real brand is copied.
const css = ':root[data-brand-bound] {\n  --color-action: #123456;\n}\n';
function fixture(value = css, source = 'consumer') {
  const hash = hashCss(value);
  const theme = { source, css: value, hash };
  return { config: { theme }, applied: { bound: true, count: 1, css: value, hash, enabled: true, unbrandedNotice: source === 'foundry', computed: [{ property: '--color-action', expected: '#123456', actual: '#123456' }] } };
}

async function server(t, data, initialCss = data.config.theme.css, rootOverride = '') {
  const initialHash = hashCss(initialCss);
  const instance = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/api/config' ? 'application/json' : 'text/html');
    response.end(request.url === '/api/config' ? JSON.stringify(data.config) : `<html data-brand-bound="" data-theme-hash="${initialHash}" style="${rootOverride}"><head><style id="studio-brand-theme">${initialCss}</style></head><body>${data.config.theme.source === 'foundry' ? '<div data-frame-notices>Unbranded: using the default theme.</div>' : ''}<script>fetch('/api/config').then(r=>r.json()).then(({theme})=>{document.getElementById('studio-brand-theme').textContent=theme.css;document.documentElement.dataset.themeHash=theme.hash;});</script></body></html>`);
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('browser accepts two different consumer brands, including client application over an initial default', async t => {
  const [first, second] = await Promise.all([server(t, fixture()), server(t, fixture(css.replace('#123456', '#654321')), css)]);
  const result = await checkThemeParity([first, second], { requireDifferent: true });
  assert.equal(result.studios, 2);
  assert.notEqual(...result.hashes);
});

test('browser rejects a live token override despite matching API, stylesheet bytes and root hash', async t => {
  const [first, second] = await Promise.all([server(t, fixture()), server(t, fixture(), css, '--color-action: #000000')]);
  await assert.rejects(checkThemeParity([first, second]), /live computed theme properties differ/);
});

test('a different applied token fails even when the applied root hash claims consumer equality', () => {
  const original = fixture();
  assert.throws(() => inspectTheme(original.config, { ...original.applied, css: css.replace('#123456', '#654321') }, 'Studio'), /applied Studio CSS differs/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, computed: [{ property: '--color-action', expected: '#123456', actual: '#654321' }] }, 'Studio'), /live computed theme properties differ/);
});

test('a stale or forged config hash and an unbound or disabled stylesheet fail', () => {
  const original = fixture();
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, css: css.replace('#123456', '#654321') } }, original.applied, 'Studio'), /config theme hash does not match/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, hash: 'sha256:stale' }, 'Studio'), /applied Studio theme differs/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, bound: false }, 'Studio'), /brand is unbound/);
  assert.throws(() => inspectTheme(original.config, { ...original.applied, enabled: false }, 'Studio'), /stylesheet is disabled/);
});

test('default fallback requires a visible unbranded notice and cannot hide a compiler failure', () => {
  const original = fixture(css, 'foundry');
  assert.equal(inspectTheme(original.config, original.applied, 'Studio'), hashCss(css));
  assert.throws(() => inspectTheme(original.config, { ...original.applied, unbrandedNotice: false }, 'Studio'), /missing visible unbranded notice/);
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, message: 'Compilation failed' } }, original.applied, 'Studio'), /compilation failure/);
});
