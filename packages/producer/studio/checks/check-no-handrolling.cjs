#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { launchChrome, failureExitCode } = require('./chrome-launch.cjs');

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
  function hydratedMetadataBoundary(element) {
    if (element.localName !== 'div' || element.parentElement !== document.body || !element.hidden
      || !attributesOnly(element, ['hidden']) || element.childNodes.length || element.shadowRoot) return false;
    // Next's own client metadata boundary retains an empty hidden container after
    // React hoists its title/meta children into head. Verify the actual host Fiber
    // and its immediate framework owner; arbitrary hidden application nodes fail.
    const key = Object.getOwnPropertyNames(element).find(name => name.startsWith('__reactFiber$'));
    const fiber = key && element[key];
    const owner = fiber?.return;
    return fiber?.tag === 5 && fiber.stateNode === element && owner?.tag === 0
      && typeof owner.type === 'function' && owner.type.name === '__next_metadata_boundary__';
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
      if (hydratedMetadataBoundary(element)) return 'next-empty-metadata-boundary';
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

// This audit compares rendered evidence with Producer's compiled selection, never with a host label.
function inspectStudioSelection(selection, requireNeeds) {
  const findings = [];
  const leaves = new Map(selection.leaves.map(leaf => [leaf.leaf, leaf]));
  const rendered = [];
  const needs = document.body.innerText ?? document.body.textContent ?? '';
  for (const element of document.querySelectorAll('[data-ds-leaf]')) {
    const leaf = element.getAttribute('data-ds-leaf');
    const fill = element.getAttribute('data-ds-fill');
    const selected = leaves.get(leaf);
    rendered.push({ leaf, fill });
    if (!selected) findings.push({ rule: 'unregistered-rendered-leaf', leaf, fill });
    else if (!selected.fill || fill !== selected.fill) findings.push({ rule: 'selected-fill-mismatch', leaf, expected: selected.fill, actual: fill });
    else if (selected.source === 'unavailable') findings.push({ rule: 'unavailable-leaf-rendered', leaf });
    else if (selected.source !== 'consumer' && requireNeeds && !needs.includes(`NEED: ${leaf}`)) findings.push({ rule: 'fallback-without-need', leaf, fill });
  }
  for (const element of document.querySelectorAll('*')) {
    if (!element.getAttributeNames().some(name => name === 'data-rac' || name.startsWith('data-rac-'))) continue;
    let owned = false;
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.getAttribute('data-ds-leaf')?.startsWith('components.')) { owned = true; break; }
    }
    if (!owned) findings.push({ rule: 'rac-without-selected-component', tag: element.localName, html: element.outerHTML.slice(0, 240) });
  }
  if (document.documentElement.dataset.selectionHash !== selection.hash) findings.push({ rule: 'selection-hash-mismatch', expected: selection.hash, actual: document.documentElement.dataset.selectionHash });
  if (typeof selection.css === 'string') {
    const style = document.getElementById('studio-selection-style');
    if (!style || style.disabled || !style.sheet || style.sheet.disabled || style.textContent !== selection.css) findings.push({ rule: 'selection-stylesheet-mismatch' });
    if (document.documentElement.dataset.selectionCssHash !== selection.cssHash) findings.push({ rule: 'selection-css-hash-mismatch' });
  }
  return { hash: selection.hash, rendered, findings };
}

function assertSelection(result, label) {
  assert.deepEqual(result.findings, [], `${label}: rendered Designer selection mismatch:\n${JSON.stringify(result.findings, null, 2)}`);
  assert.ok(result.rendered.length > 0, `${label}: no selected Designer leaves rendered`);
}

async function proveSelectionDetector(page, selection) {
  const target = page.locator('[data-ds-leaf]').first();
  const fill = await target.getAttribute('data-ds-fill');
  await target.evaluate(element => element.setAttribute('data-ds-fill', 'mutation/components.button'));
  const changed = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
  assert.ok(changed.findings.some(row => row.rule === 'selected-fill-mismatch'), 'changing a rendered fill must fail selection audit');
  await target.evaluate((element, fill) => element.setAttribute('data-ds-fill', fill), fill);
  const style = page.locator('#studio-selection-style');
  await style.evaluate(element => { element.textContent += '\n/* selected stylesheet mutation */'; });
  const alteredCss = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
  assert.ok(alteredCss.findings.some(row => row.rule === 'selection-stylesheet-mismatch'), 'altering live selected CSS without changing its hash must fail');
  await style.evaluate((element, css) => { element.textContent = css; }, selection.css);
  await page.locator('[data-ds-leaf^="frames."]').first().evaluate(frame => {
    const probe = document.createElement('div');
    probe.id = 'studio-unowned-rac-probe';
    probe.setAttribute('data-rac', '');
    frame.append(probe);
  });
  const raw = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
  assert.ok(raw.findings.some(row => row.rule === 'rac-without-selected-component'), 'frame coverage cannot conceal an unowned RAC primitive');
  await page.locator('#studio-unowned-rac-probe').evaluate(element => element.remove());
}

function findHostCellTree(source, file = 'StudioPage.tsx') {
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
  const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4301').origin;
  const sourceFile = path.join(__dirname, '../components/StudioPage.tsx');
  assert.deepEqual(findHostCellTree(fs.readFileSync(sourceFile, 'utf8'), 'StudioPage.tsx'), [], 'The generic renderer places sections; it authors no nav/ul/li of its own');
  const browser = await launchChrome({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(`window.inspectStudioSelection = ${inspectStudioSelection.toString()};`);
    const configResponse = await page.request.get(origin + '/api/config');
    assert.equal(configResponse.status(), 200, 'Producer config');
    const { selection } = await configResponse.json();
    assert.ok(selection?.runtimeUrl, 'Producer must compile a usable Designer selection');
    assert.equal(typeof selection.css, 'string', 'Producer must supply the compiled selected stylesheet');
    assert.equal(selection.cssHash, `sha256:${createHash('sha256').update(selection.css, 'utf8').digest('hex')}`, 'independent selected CSS hash');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/api/events`, route => route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }));
    // Studio's own pages over the live slot model: home plus one tab page per agent.
    const checks = [];
    const routes = ['/', '/director/identity', '/designer/components', '/writer/strings', '/publisher/studio'];
    for (const route of routes) {
      const requireNeeds = route.startsWith('/designer');
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 200, route);
      await page.getByRole('heading', { level: 1 }).waitFor();
      const result = await page.evaluate(inspectStudioBody);
      assertCovered(result, route);
      const selectionEvidence = await page.evaluate(({ selection, requireNeeds }) => inspectStudioSelection(selection, requireNeeds), { selection, requireNeeds });
      assertSelection(selectionEvidence, route);
      await proveDetector(page);
      await proveSelectionDetector(page, selection);
      checks.push({ route, state: 'ready', ...result, selection: selectionEvidence });
      await page.getByRole('button', { name: 'Find a page', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"]') || document.documentElement.dataset.studioState === 'selection-unavailable');
      assert.equal(await page.locator('html').getAttribute('data-studio-state'), 'ready', `${route}: opening the selected command menu must preserve a usable selection`);
      await page.getByRole('dialog').waitFor();
      const commandBody = await page.evaluate(inspectStudioBody);
      assertCovered(commandBody, `${route} command menu`);
      const commandSelection = await page.evaluate(({ selection, requireNeeds }) => inspectStudioSelection(selection, requireNeeds), { selection, requireNeeds });
      assertSelection(commandSelection, `${route} command menu`);
      checks.push({ route, state: 'command-menu', ...commandBody, selection: commandSelection });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    assert.deepEqual(errors, [], 'browser page errors');
    console.log(JSON.stringify({ check: 'Studio no handrolling', routes: routes.length, checks, positiveProof: 'unstamped descendants inside an existing leaf and bare text accepted', negativeProof: 'visible and hidden unstamped body siblings, stale selected fills, altered selected CSS, and unowned RAC descendants rejected on every route', sourceProof: 'the generic renderer has no host-authored nav/ul/li' }, null, 2));
  } finally {
    await browser.close();
  }
}

module.exports = { inspectStudioBody, inspectStudioSelection, findHostCellTree, assertCovered, assertSelection };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = failureExitCode(error); });
