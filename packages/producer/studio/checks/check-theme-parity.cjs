#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

function hashCss(css) {
  assert.equal(typeof css, 'string', 'Theme CSS is missing');
  assert.ok(css.trim(), 'Theme CSS is empty');
  return `sha256:${createHash('sha256').update(css, 'utf8').digest('hex')}`;
}

// Serialized into the browser; inspect the applied stylesheet after hydration.
function appliedTheme(expectedCss) {
  const root = document.documentElement;
  const styles = [...document.querySelectorAll('#studio-brand-theme')];
  const style = styles[0];
  const reference = document.createElement('iframe');
  reference.hidden = true;
  document.body.append(reference);
  let computed;
  try {
    const doc = reference.contentDocument;
    doc.documentElement.setAttribute('data-brand-bound', '');
    if (root.hasAttribute('data-theme')) doc.documentElement.setAttribute('data-theme', root.getAttribute('data-theme'));
    const expectedStyle = doc.createElement('style');
    expectedStyle.textContent = expectedCss;
    doc.head.append(expectedStyle);
    const expected = reference.contentWindow.getComputedStyle(doc.documentElement);
    const actual = getComputedStyle(root);
    const properties = [...new Set(expectedCss.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) ?? [])];
    computed = properties.flatMap(property => {
      const value = expected.getPropertyValue(property).trim();
      return value ? [{ property, expected: value, actual: actual.getPropertyValue(property).trim() }] : [];
    });
  } finally { reference.remove(); }
  return {
    bound: root.hasAttribute('data-brand-bound'),
    hash: root.dataset.themeHash,
    count: styles.length,
    css: style?.textContent,
    enabled: !!style?.sheet && !style.sheet.disabled && (!style.media || matchMedia(style.media).matches),
    computed,
    unbrandedNotice: [...document.querySelectorAll('[data-frame-notices]')].some(element => element.getClientRects().length > 0 && /Unbranded:/i.test(element.textContent)),
  };
}

function inspectTheme(config, applied, label) {
  const theme = config?.theme;
  assert.ok(theme && ['foundry', 'consumer'].includes(theme.source), `${label}: compiled theme is missing`);
  assert.ok(!theme.message, `${label}: Producer reports a theme compilation failure`);
  const hash = hashCss(theme.css);
  assert.equal(theme.hash, hash, `${label}: config theme hash does not match its CSS`);
  assert.ok(applied.bound, `${label}: Studio brand is unbound`);
  assert.equal(applied.count, 1, `${label}: expected one applied Studio brand stylesheet`);
  assert.ok(applied.enabled, `${label}: Studio brand stylesheet is disabled or missing`);
  assert.equal(applied.hash, hash, `${label}: applied Studio theme differs from its consumer config`);
  assert.equal(hashCss(applied.css), hash, `${label}: applied Studio CSS differs from its consumer config`);
  assert.ok(applied.computed?.length > 0, `${label}: no live computed theme properties checked`);
  assert.deepEqual(applied.computed.filter(row => row.actual !== row.expected), [], `${label}: live computed theme properties differ from the consumer CSS`);
  if (theme.source === 'foundry') assert.ok(applied.unbrandedNotice, `${label}: missing visible unbranded notice`);
  return hash;
}

async function checkStudio(page, origin, label) {
  const url = new URL(origin);
  assert.ok(['http:', 'https:'].includes(url.protocol), `${label}: expected an HTTP origin`);
  const response = await page.request.get(new URL('/api/config', url).href);
  assert.ok(response.ok(), `${label}: config HTTP ${response.status()}`);
  const config = await response.json();
  assert.equal(config?.theme?.hash, hashCss(config?.theme?.css), `${label}: invalid compiled theme hash`);
  const navigation = await page.goto(url.origin, { waitUntil: 'domcontentloaded' });
  assert.ok(navigation?.ok(), `${label}: Studio HTTP ${navigation?.status()}`);
  await page.waitForFunction(hash => document.documentElement.dataset.themeHash === hash, config.theme.hash);
  if (config.selection !== undefined) {
    assert.ok(config.selection.runtimeUrl, `${label}: selected consumer preview is unavailable`);
    await page.waitForFunction(hash => document.documentElement.dataset.selectionHash === hash && document.documentElement.dataset.studioState === 'ready', config.selection.hash);
  }
  if (config.theme.source === 'foundry') await page.getByText(/^Unbranded:/).first().waitFor({ state: 'visible' });
  return inspectTheme(config, await page.evaluate(appliedTheme, config.theme.css), label);
}

async function checkThemeParity(origins, { requireDifferent = false } = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const hashes = [];
    for (let index = 0; index < origins.length; index++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      try { hashes.push(await checkStudio(page, origins[index], `Studio ${index + 1}`)); }
      finally { await page.close(); }
    }
    if (requireDifferent) assert.ok(new Set(hashes).size > 1, 'Different-brand fixture proof requires distinct compiled themes');
    return { hashes, studios: hashes.length };
  } finally { await browser.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const requireDifferent = args.includes('--require-different');
  const origins = args.filter(argument => argument !== '--require-different');
  if (origins.length !== 2 || args.length !== origins.length + Number(requireDifferent)) {
    process.stderr.write('Usage: node check-theme-parity.cjs [--require-different] <consumer-origin> <consumer-origin>\n');
    process.exitCode = 1;
  } else {
    checkThemeParity(origins, { requireDifferent }).then(result => process.stdout.write(`${JSON.stringify({ check: 'Studio applied consumer theme', ...result })}\n`))
      .catch(error => { process.stderr.write(`Studio consumer theme check failed: ${error.message}\n`); process.exitCode = 1; });
  }
}

module.exports = { hashCss, appliedTheme, inspectTheme, checkStudio, checkThemeParity };
