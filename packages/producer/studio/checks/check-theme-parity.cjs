#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { launchChrome, failureExitCode } = require('./chrome-launch.cjs');
const { inspectStudioSelection, assertSelection } = require('./check-no-handrolling.cjs');

function hashCss(css) {
  assert.equal(typeof css, 'string', 'Theme CSS is missing');
  assert.ok(css.trim(), 'Theme CSS is empty');
  return `sha256:${createHash('sha256').update(css, 'utf8').digest('hex')}`;
}

// Studio's projected consumer-precedence document stylesheet (studio-map `document.stylesheets`). The
// removed `#studio-brand-theme` element and root hash attributes carried the compiled theme bytes; the
// projection carries the consumer's authored Designer globals instead, so the proof that the compiled
// theme is applied is the live computed value of every property it declares.
const BRAND_LINK = 'link[rel="stylesheet"][data-precedence="consumer"]';

// Serialized into the browser; inspect the applied stylesheet after load.
function appliedTheme({ expectedCss, selector }) {
  const root = document.documentElement;
  const links = [...document.querySelectorAll(selector)];
  const link = links[0];
  const reference = document.createElement('iframe');
  reference.hidden = true;
  document.body.append(reference);
  let computed;
  try {
    const doc = reference.contentDocument;
    for (const name of ['class', 'data-theme']) if (root.hasAttribute(name)) doc.documentElement.setAttribute(name, root.getAttribute(name));
    const expectedStyle = doc.createElement('style');
    expectedStyle.textContent = expectedCss;
    doc.head.append(expectedStyle);
    const expected = reference.contentWindow.getComputedStyle(doc.documentElement);
    const actual = getComputedStyle(root);
    // Compare token values, not their spelling: a color or length resolves through the same probe on both sides.
    const probe = doc.createElement('div');
    doc.body.append(probe);
    const resolve = value => {
      const property = ['color', 'width'].find(name => CSS.supports(name, value));
      if (!property) return value.replace(/\s+/g, ' ');
      probe.style.setProperty(property, value);
      return reference.contentWindow.getComputedStyle(probe).getPropertyValue(property);
    };
    const properties = [...new Set(expectedCss.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) ?? [])];
    computed = properties.flatMap(property => {
      const value = expected.getPropertyValue(property).trim();
      return value ? [{ property, expected: resolve(value), actual: resolve(actual.getPropertyValue(property).trim()) }] : [];
    });
  } finally { reference.remove(); }
  return {
    count: links.length,
    enabled: !!link?.sheet && !link.sheet.disabled && (!link.media || matchMedia(link.media).matches),
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
  assert.equal(applied.count, 1, `${label}: expected one applied Studio brand stylesheet`);
  assert.ok(applied.enabled, `${label}: Studio brand stylesheet is disabled or missing`);
  assert.ok(applied.computed?.length > 0, `${label}: no live computed theme properties checked`);
  assert.deepEqual(applied.computed.filter(row => row.actual !== row.expected), [], `${label}: live computed theme properties differ from the consumer CSS`);
  if (theme.source === 'foundry') assert.ok(applied.unbrandedNotice, `${label}: missing visible unbranded notice`);
  return hash;
}

// Slot model: every selected leaf is a pinned fill with its hash, and the selection hash covers the leaves.
// It replaces the removed preview `runtimeUrl`; the rendered DOM is then audited against these leaves.
function inspectSelectionRecord(selection, label) {
  assert.ok(Array.isArray(selection?.leaves) && selection.leaves.length > 0, `${label}: ${selection?.message ?? 'the consumer selection has no leaves'}`);
  const unpinned = selection.leaves.filter(leaf => !/@v[1-9][0-9]*$/.test(leaf.fill ?? '') || !/^sha256:[0-9a-f]{64}$/.test(leaf.hash ?? ''));
  assert.deepEqual(unpinned.map(leaf => leaf.leaf), [], `${label}: selected leaves without a pinned fill and hash`);
  assert.equal(selection.hash, hashCss(JSON.stringify(selection.leaves)), `${label}: selection hash does not cover its leaves`);
}

async function checkStudio(page, origin, label) {
  const url = new URL(origin);
  assert.ok(['http:', 'https:'].includes(url.protocol), `${label}: expected an HTTP origin`);
  const response = await page.request.get(new URL('/api/config', url).href);
  assert.ok(response.ok(), `${label}: config HTTP ${response.status()}`);
  const config = await response.json();
  assert.equal(config?.theme?.hash, hashCss(config?.theme?.css), `${label}: invalid compiled theme hash`);
  const navigation = await page.goto(url.origin, { waitUntil: 'load' });
  assert.ok(navigation?.ok(), `${label}: Studio HTTP ${navigation?.status()}`);
  if (config.selection !== undefined) {
    inspectSelectionRecord(config.selection, label);
    assertSelection(await page.evaluate(`(${inspectStudioSelection})(${JSON.stringify(config.selection)}, true)`), `${label} selection`);
  }
  if (config.theme.source === 'foundry') await page.getByText(/^Unbranded:/).first().waitFor({ state: 'visible' });
  return inspectTheme(config, await page.evaluate(appliedTheme, { expectedCss: config.theme.css, selector: BRAND_LINK }), label);
}

async function checkThemeParity(origins, { requireDifferent = false } = {}) {
  const browser = await launchChrome({ headless: true, args: ['--no-sandbox'] });
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
      .catch(error => { process.stderr.write(`Studio consumer theme check failed: ${error.message}\n`); process.exitCode = failureExitCode(error); });
  }
}

module.exports = { hashCss, appliedTheme, inspectTheme, inspectSelectionRecord, checkStudio, checkThemeParity };
