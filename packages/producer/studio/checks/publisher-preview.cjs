#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { inspectStudioBody, inspectStudioSelection, assertCovered, assertSelection } = require('./check-no-handrolling.cjs');

/** Run against a native standalone Studio with a real emitted publication fixture. */
async function checkPublisherPreview(origin, mode = 'ready', output) {
  const response = await fetch(`${origin}/api/publication`);
  const publication = await response.json();
  const selectedRuntime = (await (await fetch(`${origin}/api/config`)).json()).selection;
  assert.ok(selectedRuntime?.runtimeUrl, selectedRuntime?.message ?? 'The consumer selection runtime is unavailable.');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const cells = await (await fetch(`${origin}/api/cells`)).json();
    const index = cells.agents.find(agent => agent.agent === 'publisher');
    const selected = publication.state === 'ready' ? publication.pages.find(page => page.cellId)?.cellId : index?.cells[0]?.id;
    assert.ok(selected, 'The proof requires an actual Publisher cell.');
    await page.goto(`${origin}/agents/publisher?cell=${encodeURIComponent(selected)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.studioState === 'ready', undefined, { timeout: 90_000 });
    if (mode === 'missing') {
      await page.getByRole('heading', { name: 'Not published yet', exact: true }).waitFor();
      assert.ok((await page.locator('body').innerText()).includes('clossys publish --target preview'));
      assert.equal(await page.locator('iframe').count(), 0);
    } else {
      assert.equal(publication.state, 'ready');
      const iframe = page.locator('iframe'); await iframe.waitFor({ state: 'visible', timeout: 90_000 });
      const src = await iframe.getAttribute('src');
      assert.equal(new URL(src, origin).origin, origin); assert.match(src, /^\/preview\//);
      assert.equal(await iframe.getAttribute('sandbox'), ''); assert.equal(await iframe.getAttribute('referrerpolicy'), 'no-referrer');
      await page.frameLocator('iframe').getByText('Sign in to continue', { exact: true }).waitFor({ timeout: 45_000 });
      const frame = page.frames().find(frame => frame.url().includes('/preview/'));
      assert.ok(frame);
      assert.equal(await frame.evaluate(() => { try { return !!parent.document; } catch { return false; } }), false, 'Opaque sandbox blocks the parent document and run token.');
      const viewports = [];
      for (const [name, width] of [['Desktop', 1440], ['Tablet', 768], ['Mobile', 390]]) {
        await page.getByRole('button', { name, exact: true }).click();
        assert.equal(await iframe.getAttribute('width'), String(width));
        assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
        viewports.push({ device: name, width });
      }
      assert.equal(await page.getByLabel('Search preview', { exact: true }).count(), 1);
      assert.equal(await page.getByLabel('Social preview', { exact: true }).count(), 1);
      assert.ok((await page.locator('body').innerText()).includes('Open Graph image not provided'));
      await page.getByRole('button', { name: 'Publication sitemap', exact: true }).click();
      await page.getByRole('treegrid', { name: 'Publication sitemap', exact: true }).or(page.getByRole('tree', { name: 'Publication sitemap', exact: true })).waitFor();
      await page.getByRole('grid', { name: 'Publication status', exact: true }).or(page.getByRole('table', { name: 'Publication status', exact: true })).waitFor();
      const text = await page.locator('body').innerText();
      for (const label of ['Indexing', 'In sitemap', 'Last published', 'Not provided']) assert.ok(text.includes(label));
      if (output) await page.screenshot({ path: output, fullPage: true });
      publication.viewports = viewports;
    }
    assert.equal(await page.getByLabel('Cell source', { exact: true }).isVisible(), false, 'Raw cell source starts closed.');
    assert.ok(!(await page.locator('body').innerText()).includes('clossys-digest:'), 'The specimen does not display generated source.');
    const selection = (await (await fetch(`${origin}/api/config`)).json()).selection;
    const coverage = await page.evaluate(inspectStudioBody); assertCovered(coverage, 'Publisher specimen');
    await page.evaluate(`globalThis.__publisherSelectionAudit = ${inspectStudioSelection.toString()}`);
    const provenance = await page.evaluate(selection => globalThis.__publisherSelectionAudit(selection, true), selection);
    assertSelection(provenance, 'Publisher selected fills and CSS');
    assert.deepEqual(errors, [], 'Publisher browser errors');
    return { mode, publication: publication.publication, pages: publication.pages?.length ?? 0, viewports: publication.viewports, coverage: { checked: coverage.checked, violations: coverage.violations }, provenance, errors };
  } finally { await browser.close(); }
}
module.exports = { checkPublisherPreview };
if (require.main === module) checkPublisherPreview(new URL(process.argv[2] ?? 'http://127.0.0.1:4300').origin, process.argv[3] ?? 'ready', process.argv[4]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
