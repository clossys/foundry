#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This function is serialized into the browser by Playwright. Keep it standalone.
function inspectStudioBody() {
  const violations = [];
  const framework = {};
  let checked = 0;
  const attributesOnly = (element, allowed) => element.getAttributeNames().every(name => allowed.includes(name));
  function announcer(host) {
    const root = host.shadowRoot;
    const node = root?.firstChild;
    return host.localName === 'next-route-announcer' && host.parentElement === document.body
      && attributesOnly(host, ['style']) && root?.childNodes.length === 1
      && node.nodeType === Node.ELEMENT_NODE && node.localName === 'div'
      && node.id === '__next-route-announcer__' && node.getAttribute('role') === 'alert'
      && node.getAttribute('aria-live') === 'assertive'
      && attributesOnly(node, ['id', 'role', 'aria-live', 'style'])
      && node.childElementCount === 0 && !node.shadowRoot;
  }
  function scaffolding(element) {
    if (element.parentElement === document.body) {
      if (element.localName === 'script' && !element.childElementCount && !element.shadowRoot) {
        if (element.hasAttribute('src') && attributesOnly(element, ['src', 'async', 'nonce'])) {
          const url = new URL(element.src, location.href);
          if (url.origin === location.origin && /^\/_next\/static\/.+\.js$/.test(url.pathname)) return 'next-runtime';
        }
        if (!element.hasAttribute('src') && attributesOnly(element, ['id', 'nonce'])) {
          const content = element.textContent.trim();
          if (/^(?:\(self\.__next_f=self\.__next_f\|\|\[\]\)|self\.__next_f)\.push\(/.test(content)) return 'next-flight';
          if (element.id === '_R_' && /^\(globalThis\["TURBOPACK"\]/.test(content)) return 'next-bootstrap';
        }
      }
      if (element.localName === 'div' && element.hasAttribute('hidden') && attributesOnly(element, ['hidden'])
        && element.childNodes.length === 2 && [...element.childNodes].every(node => node.nodeType === Node.COMMENT_NODE)
        && element.childNodes[0].data === '$' && element.childNodes[1].data === '/$') return 'react-empty-boundary';
      if (announcer(element)) return 'next-route-announcer';
    }
    const root = element.getRootNode();
    if (root instanceof ShadowRoot && announcer(root.host) && element === root.firstChild) return 'next-route-announcer-content';
    return undefined;
  }
  function covered(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement ?? node.getRootNode().host) {
      if (node.hasAttribute('data-ds-leaf')) return true;
    }
    return false;
  }
  function visit(root) {
    for (const element of root.children) {
      checked++;
      // Check scaffolding before coverage: a document leaf cannot hide framework drift.
      const reason = scaffolding(element);
      if (reason) framework[reason] = (framework[reason] ?? 0) + 1;
      else if (!covered(element)) violations.push({ tag: element.localName, id: element.id, html: element.outerHTML.slice(0, 240) });
      visit(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  }
  visit(document.body);
  return { checked, framework, violations };
}

function findHostCellTree(source, file = 'CellsWorkspace.tsx') {
  const ts = require('typescript');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['nav', 'ul', 'li'].includes(node.tagName.getText(tree))) {
      const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      findings.push({ file, line: line + 1, column: character + 1, tag: node.tagName.getText(tree) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

function assertCovered(result, label) {
  assert.equal(result.violations.length, 0, `${label}: elements outside a Designer leaf:\n${JSON.stringify(result.violations, null, 2)}`);
  assert.ok(result.checked > 0, `${label}: no application DOM checked`);
}

async function proveDetector(page) {
  // Reuse an actual Designer leaf; do not manufacture data-ds-leaf stamps.
  await page.evaluate(() => {
    const covered = document.createElement('div');
    covered.id = 'studio-covered-probe';
    covered.innerHTML = '<span>Covered composition</span>';
    document.querySelector('body [data-ds-leaf]').append(covered);
    document.body.append(document.createTextNode('Studio text-only probe'));
  });
  assertCovered(await page.evaluate(inspectStudioBody), 'covered descendants and bare text positive proof');
  await page.evaluate(() => {
    document.getElementById('studio-covered-probe').remove();
    [...document.body.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.data === 'Studio text-only probe').remove();
  });
  for (const hidden of [false, true]) {
    await page.evaluate(hidden => {
      const probe = document.createElement('div');
      probe.id = 'studio-outside-probe';
      probe.hidden = hidden;
      document.body.append(probe);
    }, hidden);
    const result = await page.evaluate(inspectStudioBody);
    assert.ok(result.violations.some(item => item.id === 'studio-outside-probe'), `uncovered ${hidden ? 'hidden' : 'visible'} element must fail`);
    assert.throws(() => assertCovered(result, 'negative proof'), /elements outside a Designer leaf/);
    await page.locator('#studio-outside-probe').evaluate(element => element.remove());
  }
  assertCovered(await page.evaluate(inspectStudioBody), 'after negative-proof cleanup');
}

async function main() {
  const { chromium } = require('playwright');
  const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4301').origin;
  const sourceFile = path.join(__dirname, '../components/CellsWorkspace.tsx');
  assert.deepEqual(findHostCellTree(fs.readFileSync(sourceFile, 'utf8')), [], 'Cell navigation must use Designer composition, not host-authored nav/ul/li');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const agents = ['director', 'designer', 'writer', 'publisher'];
    let mode = 'ready';
    await page.route(`${origin}/api/events`, route => route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }));
    await page.route(`${origin}/api/cells**`, route => {
      if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' });
      const url = new URL(route.request().url());
      const summary = { id: 'context.current', version: 1, status: 'draft', path: 'cells/context.current/v1.md', fields: { title: 'Current context' } };
      const market = { ...summary, id: 'context.market', path: 'cells/context.market/v1.md', fields: { title: 'Market context' } };
      const selected = url.pathname.endsWith('/context.market') ? market : summary;
      const body = url.pathname === '/api/cells'
        ? { agents: agents.map(agent => ({ agent, state: 'ready', cells: mode === 'empty' ? [] : [summary, market], tree: { tree: mode === 'empty' ? [] : [{ id: 'context', name: 'Context group', cells: [summary.id, market.id] }] } })) }
        : { agent: url.pathname.split('/')[3], state: 'ready', cell: { ...selected, source: `# ${selected.fields.title}\n\nStudio selected cell evidence: ${selected.id}.` } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const checks = [];
    const routes = ['/', ...agents.map(agent => `/agents/${agent}`), '/apps'];
    for (const route of routes) {
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 200, route);
      await page.getByRole('heading', { level: 1 }).waitFor();
      if (route === '/apps') await page.getByText('App browsing unavailable', { exact: true }).waitFor();
      else {
        await page.getByRole('link', { name: /^Current context/ }).first().waitFor();
        await page.getByText('Studio selected cell evidence: context.current.', { exact: false }).waitFor();
      }
      const result = await page.evaluate(inspectStudioBody);
      assertCovered(result, route);
      await proveDetector(page);
      checks.push({ route, state: 'ready', ...result });
      if (route !== '/apps') {
        await page.getByRole('link', { name: /^Market context/ }).first().click();
        await page.getByText('Studio selected cell evidence: context.market.', { exact: false }).waitFor();
        const selected = await page.evaluate(inspectStudioBody);
        assertCovered(selected, `${route} selected cell`);
        checks.push({ route, state: 'selected', ...selected });
      }
    }
    for (const state of ['empty', 'error']) {
      mode = state;
      await page.goto(origin + '/agents/director');
      await page.getByText(state === 'empty' ? 'No cells yet' : 'Cells could not be loaded', { exact: true }).waitFor();
      const result = await page.evaluate(inspectStudioBody);
      assertCovered(result, state);
      checks.push({ route: '/agents/director', state, ...result });
    }
    assert.deepEqual(errors, [], 'browser page errors');
    console.log(JSON.stringify({ check: 'Studio no handrolling', routes: routes.length, checks, positiveProof: 'unstamped descendants inside an existing leaf and bare text accepted', negativeProof: 'visible and hidden unstamped body siblings rejected on every route', sourceProof: 'CellsWorkspace has no host-authored nav/ul/li' }, null, 2));
  } finally {
    await browser.close();
  }
}

module.exports = { inspectStudioBody, findHostCellTree, assertCovered };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
