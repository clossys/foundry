#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// Hash compiler bytes, excluding the emitter's optional provenance header.
function hashCss(css) {
  assert.equal(typeof css, 'string', 'Theme CSS is missing');
  assert.ok(css.trim(), 'Theme CSS is empty');
  return `sha256:${createHash('sha256').update(css, 'utf8').digest('hex')}`;
}

function attribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes)?.[2];
}

function inspectTheme(config, html, label) {
  const theme = config?.theme;
  assert.ok(theme && ['foundry', 'consumer'].includes(theme.source), `${label}: compiled theme is missing`);
  assert.ok(!theme.message, `${label}: Producer reports a theme compilation failure`);
  const configHash = hashCss(theme.css);
  assert.equal(theme.hash, configHash, `${label}: config theme hash does not match its CSS`);

  const root = /<html\b([^>]*)>/i.exec(html);
  assert.ok(root, `${label}: built Studio document has no html root`);
  assert.match(root[1], /(?:^|\s)data-brand-bound(?:\s|=|$)/i, `${label}: built Studio brand is unbound`);
  const buildHash = attribute(root[1], 'data-theme-hash');
  assert.equal(buildHash, configHash, `${label}: built Studio theme differs from Producer config`);
  const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)]
    .filter(match => attribute(match[1], 'id') === 'studio-brand-theme');
  assert.equal(styles.length, 1, `${label}: expected one built Studio brand stylesheet`);
  assert.equal(hashCss(styles[0][2]), buildHash, `${label}: built Studio hash does not match its stylesheet`);
  return configHash;
}

async function readStudio(origin, label) {
  const url = new URL(origin);
  assert.ok(['http:', 'https:'].includes(url.protocol), `${label}: expected an HTTP origin`);
  const options = { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) };
  const [config, page] = await Promise.all([
    fetch(new URL('/api/config', url), { ...options, headers: { Accept: 'application/json' } }),
    fetch(new URL('/', url), options),
  ]);
  assert.ok(config.ok, `${label}: config HTTP ${config.status}`);
  assert.ok(page.ok, `${label}: Studio HTTP ${page.status}`);
  const [body, html] = await Promise.all([config.json(), page.text()]);
  return inspectTheme(body, html, label);
}

async function checkThemeParity(foundryOrigin, productOrigin) {
  const [foundry, product] = await Promise.all([
    readStudio(foundryOrigin, 'Foundry Studio'),
    readStudio(productOrigin, 'Product Studio'),
  ]);
  assert.equal(product, foundry, 'Foundry Studio and Product Studio compiled theme hashes differ');
  return { hash: foundry, studios: 2 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write('Usage: node check-theme-parity.cjs <foundry-origin> <product-origin>\n');
    process.exitCode = 1;
  } else {
    checkThemeParity(...args).then(result => process.stdout.write(`Studio theme parity passed: ${result.hash}\n`))
      .catch(error => { process.stderr.write(`Studio theme parity failed: ${error.message}\n`); process.exitCode = 1; });
  }
}

module.exports = { hashCss, inspectTheme, checkThemeParity };
