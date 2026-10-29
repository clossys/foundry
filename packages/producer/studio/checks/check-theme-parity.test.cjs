'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { hashCss, inspectTheme, checkThemeParity } = require('./check-theme-parity.cjs');

const css = ':root[data-brand-bound] {\n  --color-action: #123456;\n}\n';
function fixture(value = css, source = 'foundry') {
  const hash = hashCss(value);
  return { config: { theme: { source, css: value, hash } }, html: `<html data-brand-bound="" data-theme-hash="${hash}"><head><style id="studio-brand-theme">${value}</style></head><body></body></html>` };
}

async function server(t, data) {
  const instance = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/api/config' ? 'application/json' : 'text/html');
    response.end(request.url === '/api/config' ? JSON.stringify(data.config) : data.html);
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('two served Studio builds pass with identical compiled CSS from different source kinds', async t => {
  const [foundry, product] = await Promise.all([server(t, fixture()), server(t, fixture(css, 'consumer'))]);
  assert.deepEqual(await checkThemeParity(foundry, product), { hash: hashCss(css), studios: 2 });
});

test('a product token mutation fails even when config and built Studio hashes agree locally', async t => {
  const [foundry, product] = await Promise.all([server(t, fixture()), server(t, fixture(css.replace('#123456', '#654321'), 'consumer'))]);
  await assert.rejects(checkThemeParity(foundry, product), /compiled theme hashes differ/);
  await assert.rejects(promisify(execFile)(process.execPath, [join(__dirname, 'check-theme-parity.cjs'), foundry, product]), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Studio theme parity failed:.*compiled theme hashes differ/);
    return true;
  });
});

test('a stale build fails when its root hash differs from the product config', () => {
  const original = fixture();
  const changed = fixture(css.replace('#123456', '#654321'), 'consumer');
  assert.throws(() => inspectTheme(changed.config, original.html, 'Product Studio'), /built Studio theme differs/);
});

test('a forged config hash and a mutated built stylesheet each fail independently', () => {
  const original = fixture();
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, css: css.replace('#123456', '#654321') } }, original.html, 'Product Studio'), /config theme hash does not match/);
  assert.throws(() => inspectTheme(original.config, original.html.replace('#123456', '#654321'), 'Product Studio'), /hash does not match its stylesheet/);
});

test('an unbound document and compiler failure cannot claim parity', () => {
  const original = fixture();
  assert.throws(() => inspectTheme(original.config, original.html.replace(' data-brand-bound=""', ''), 'Product Studio'), /brand is unbound/);
  assert.throws(() => inspectTheme({ theme: { ...original.config.theme, message: 'Compilation failed' } }, original.html, 'Product Studio'), /compilation failure/);
});
