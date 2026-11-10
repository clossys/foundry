#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { launchChrome, failureExitCode } = require('./chrome-launch.cjs');

/**
 * The pinned Studio frame's content outlets: where it places what the page hands it (the body column
 * and each header popover body). A frame or section marker covers its own markup only; it never
 * reaches past an outlet, so every element placed in one must be its own marked root.
 */
const CONTENT_OUTLETS = '#studio-main, [data-popover-body]';

// This function is serialized into the browser by Playwright. Keep it standalone (its one argument
// is the outlet selector; the default is CONTENT_OUTLETS, written out for the serialized copy).
function inspectStudioBody(outlets = '#studio-main, [data-popover-body]') {
  const violations = [];
  const framework = {};
  let checked = 0;
  // An open dialog marks everything outside itself `inert`/`aria-hidden`; only then are those two names
  // accepted on framework scaffolding, which must otherwise match exactly.
  const modal = Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
  const attributesOnly = (element, allowed) => element.getAttributeNames().every(name => allowed.includes(name) || (modal && (name === 'inert' || name === 'aria-hidden')));
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
          // React's own streaming-SSR reveal runtime and its boundary instructions: the exact timing
          // stamp, the reveal runtime definition and `$RC`/`$RS`/`$RX` calls over boundary ids only.
          if (!element.id && (content === 'requestAnimationFrame(function(){$RT=performance.now()});'
            || content.startsWith('$RB=[];$RV=function(a){$RT=performance.now();')
            || content.startsWith('$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);')
            || /^(?:\$R[CSX]\("[A-Za-z0-9:_-]+"(?:,"[A-Za-z0-9:_-]+")*\);?)+$/.test(content))) return 'react-fizz-runtime';
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
  // A body-level portal (a stock dialog, popover or menu) is covered when React places it inside a marked
  // root: its host Fiber's ancestors include that root's host element. An element React did not render has
  // no Fiber and stays uncovered.
  function portalOwner(element) {
    const key = Object.getOwnPropertyNames(element).find(name => name.startsWith('__reactFiber$'));
    for (let fiber = key ? element[key]?.return : undefined; fiber; fiber = fiber.return) {
      if ((fiber.tag === 5 || fiber.tag === 26 || fiber.tag === 27) && fiber.stateNode instanceof Element) return fiber.stateNode.hasAttribute('data-clossys-slot') || covered(fiber.stateNode, false);
    }
    return false;
  }
  // The nearest boundary decides: walking up, a marked root covers the element; a content outlet
  // reached first means the element is page content the frame was handed, and the outlet's child on
  // this path carried no marker of its own, so the frame's marker above the outlet does not count.
  const outlet = node => typeof node.matches === 'function' && node.matches(outlets);
  let outletContent = false;
  function covered(element, portals = true) {
    let top = element;
    outletContent = false;
    for (let node = element; node && node !== document.body; node = node.parentElement ?? node.getRootNode().host) {
      if (node !== element && outlet(node)) { outletContent = true; return false; }
      if (node.hasAttribute('data-clossys-slot')) return true;
      top = node;
    }
    return portals && top.parentElement === document.body && portalOwner(top);
  }
  function visit(root) {
    for (const element of root.children) {
      checked++;
      // Check scaffolding before coverage: a document leaf cannot hide framework drift.
      const reason = scaffolding(element);
      if (reason) framework[reason] = (framework[reason] ?? 0) + 1;
      else if (!covered(element)) violations.push({ ...(outletContent ? { rule: 'outlet-content-without-provenance' } : {}), tag: element.localName, id: element.id, html: element.outerHTML.slice(0, 240) });
      visit(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  }
  visit(document.body);
  return { checked, framework, violations };
}

// This audit compares rendered evidence with Producer's selection, never with a host label. The evidence is
// the generated DOM provenance every frame and section root carries (`data-clossys-slot`, `-candidate`,
// `-hash`): each must name a selected leaf and carry exactly that leaf's pinned candidate and content hash.
function inspectStudioSelection(selection, requireNeeds) {
  const findings = [];
  const leaves = new Map(selection.leaves.map(leaf => [leaf.leaf, leaf]));
  const rendered = [];
  const needs = document.body.innerText ?? document.body.textContent ?? '';
  const version = (value, pattern) => pattern.exec(value ?? '')?.[1];
  for (const element of document.querySelectorAll('[data-clossys-slot]')) {
    const leaf = element.getAttribute('data-clossys-slot');
    const candidate = element.getAttribute('data-clossys-candidate');
    const hash = element.getAttribute('data-clossys-hash');
    const selected = leaves.get(leaf);
    rendered.push({ leaf, candidate, hash });
    if (!selected) findings.push({ rule: 'unregistered-rendered-leaf', leaf, candidate, hash });
    else if (!selected.fill || !selected.hash || hash !== selected.hash || !version(candidate, /-v([1-9][0-9]*)\.json$/)
      || version(candidate, /-v([1-9][0-9]*)\.json$/) !== version(selected.fill, /@v([1-9][0-9]*)$/)) findings.push({ rule: 'selected-fill-mismatch', leaf, expected: `${selected.fill} ${selected.hash}`, actual: `${candidate} ${hash}` });
    else if (selected.source === 'unavailable') findings.push({ rule: 'unavailable-leaf-rendered', leaf });
    else if (selected.source !== 'consumer' && requireNeeds && !needs.includes(`NEED: ${leaf}`)) findings.push({ rule: 'fallback-without-need', leaf, candidate });
  }
  // A React Aria element must be the root of a stock component part (its own `data-slot`), inside a selected
  // frame or section root: a raw primitive the host placed under a frame carries no part slot of its own.
  // The marked root that owns an element: its DOM ancestor, or for a body-level portal the marked root
  // React rendered it inside (the first host Fiber above the portal).
  const owner = element => {
    const root = element.closest('[data-clossys-slot]');
    if (root) return root;
    let top = element;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    if (top.parentElement !== document.body) return null;
    const key = Object.getOwnPropertyNames(top).find(name => name.startsWith('__reactFiber$'));
    for (let fiber = key ? top[key]?.return : undefined; fiber; fiber = fiber.return) {
      if ((fiber.tag === 5 || fiber.tag === 26 || fiber.tag === 27) && fiber.stateNode instanceof Element) return fiber.stateNode === document.body ? null : owner(fiber.stateNode);
    }
    return null;
  };
  for (const element of document.querySelectorAll('*')) {
    if (!element.getAttributeNames().some(name => name === 'data-rac' || name.startsWith('data-rac-'))) continue;
    const root = owner(element);
    if (!element.hasAttribute('data-slot') || !root || !leaves.has(root.getAttribute('data-clossys-slot'))) findings.push({ rule: 'rac-without-selected-component', tag: element.localName, html: element.outerHTML.slice(0, 240) });
  }
  if (typeof selection.css === 'string') {
    const style = document.getElementById('studio-selection-style');
    if (!style || style.disabled || !style.sheet || style.sheet.disabled || style.textContent !== selection.css) findings.push({ rule: 'selection-stylesheet-mismatch' });
    if (document.documentElement.dataset.selectionCssHash !== selection.cssHash) findings.push({ rule: 'selection-css-hash-mismatch' });
  }
  return { hash: selection.hash, rendered, findings };
}

/** Producer's selection is usable when it names its pinned leaves and its hash is the hash of exactly those leaves. */
function assertUsableSelection(selection) {
  assert.ok(Array.isArray(selection?.leaves) && selection.leaves.length > 0, 'Producer must compile a usable Designer selection');
  for (const leaf of selection.leaves) {
    assert.equal(typeof leaf.leaf, 'string', 'selected leaf id');
    assert.match(leaf.fill ?? '', /@v[1-9][0-9]*$/, `${leaf.leaf}: selected fill names its pinned candidate version`);
    assert.match(leaf.hash ?? '', /^sha256:[0-9a-f]{64}$/, `${leaf.leaf}: selected fill carries its pinned content hash`);
  }
  assert.equal(selection.hash, `sha256:${createHash('sha256').update(JSON.stringify(selection.leaves), 'utf8').digest('hex')}`, 'independent selection hash over the selected leaves');
  if (selection.css !== undefined) {
    assert.equal(typeof selection.css, 'string', 'Producer must supply the compiled selected stylesheet');
    assert.equal(selection.cssHash, `sha256:${createHash('sha256').update(selection.css, 'utf8').digest('hex')}`, 'independent selected CSS hash');
  }
}

function assertSelection(result, label) {
  assert.deepEqual(result.findings, [], `${label}: rendered Designer selection mismatch:\n${JSON.stringify(result.findings, null, 2)}`);
  assert.ok(result.rendered.length > 0, `${label}: no selected Designer leaves rendered`);
}

async function proveSelectionDetector(page, selection) {
  const target = page.locator('[data-clossys-hash]').first();
  const hash = await target.getAttribute('data-clossys-hash');
  await target.evaluate(element => element.setAttribute('data-clossys-hash', `sha256:${'0'.repeat(64)}`));
  const changed = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
  assert.ok(changed.findings.some(row => row.rule === 'selected-fill-mismatch'), 'changing a rendered fill hash must fail selection audit');
  await target.evaluate((element, hash) => element.setAttribute('data-clossys-hash', hash), hash);
  const candidate = await target.getAttribute('data-clossys-candidate');
  await target.evaluate(element => element.setAttribute('data-clossys-candidate', element.getAttribute('data-clossys-candidate').replace(/-v([1-9][0-9]*)\.json$/, (_, v) => `-v${Number(v) + 1}.json`)));
  const stale = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
  assert.ok(stale.findings.some(row => row.rule === 'selected-fill-mismatch'), 'a rendered candidate that is not the pinned version must fail selection audit');
  await target.evaluate((element, candidate) => element.setAttribute('data-clossys-candidate', candidate), candidate);
  if (typeof selection.css === 'string') {
    const style = page.locator('#studio-selection-style');
    await style.evaluate(element => { element.textContent += '\n/* selected stylesheet mutation */'; });
    const alteredCss = await page.evaluate(selection => inspectStudioSelection(selection, false), selection);
    assert.ok(alteredCss.findings.some(row => row.rule === 'selection-stylesheet-mismatch'), 'altering live selected CSS without changing its hash must fail');
    await style.evaluate((element, css) => { element.textContent = css; }, selection.css);
  }
  await page.locator('[data-clossys-slot^="frames."]').first().evaluate(frame => {
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
  // Reuse an actual frame or section root; do not manufacture provenance markers.
  await page.evaluate(() => {
    const covered = document.createElement('div');
    covered.id = 'studio-covered-probe';
    covered.innerHTML = '<span>Covered composition</span>';
    document.querySelector('body [data-clossys-slot]').append(covered);
    document.body.append(document.createTextNode('Studio text-only probe'));
  });
  assertCovered(await page.evaluate(inspectStudioBody, CONTENT_OUTLETS), 'covered descendants and bare text positive proof');
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
    const result = await page.evaluate(inspectStudioBody, CONTENT_OUTLETS);
    assert.ok(result.violations.some(item => item.id === 'studio-outside-probe'), `uncovered ${hidden ? 'hidden' : 'visible'} element must fail`);
    assert.throws(() => assertCovered(result, 'negative proof'), /elements outside a Designer leaf/);
    await page.locator('#studio-outside-probe').evaluate(element => element.remove());
  }
  // Page content the frame was handed is never covered by the frame's own marker: an unmarked
  // element placed in the frame's body column must fail although the frame root is its ancestor.
  const placed = await page.evaluate(() => {
    const outlet = document.querySelector('#studio-main');
    if (!outlet) return false;
    const probe = document.createElement('div');
    probe.id = 'studio-outlet-probe';
    probe.innerHTML = '<span>Hand-rolled content</span>';
    outlet.append(probe);
    return true;
  });
  if (placed) {
    const result = await page.evaluate(inspectStudioBody, CONTENT_OUTLETS);
    assert.ok(result.violations.some(item => item.id === 'studio-outlet-probe' && item.rule === 'outlet-content-without-provenance'), 'unmarked content in the frame content outlet must fail; the frame marker cannot cover it');
    await page.locator('#studio-outlet-probe').evaluate(element => element.remove());
  }
  assertCovered(await page.evaluate(inspectStudioBody, CONTENT_OUTLETS), 'after negative-proof cleanup');
}

/**
 * The routes the audit visits, derived from the generated Studio map Publisher compiles (never a
 * hand list): every published route, then the first leaf of each distinct leaf assembly (frame,
 * sections, body, loader and agent), so every page and leaf template is rendered at least once.
 */
function studioRoutes(map) {
  const routes = [...new Set((map.routes ?? []).map(route => route.path))];
  const pages = new Map((map.pages ?? []).map(page => [page.id, page]));
  const assemblies = new Set();
  for (const leaf of map.leaves ?? []) {
    const page = pages.get(leaf.page);
    if (!page?.leaf) continue;
    const key = JSON.stringify([page.frameId, page.leaf.sectionIds, page.leaf.body, page.leaf.data?.loader, page.leaf.data?.agent]);
    if (assemblies.has(key)) continue;
    assemblies.add(key);
    if (!routes.includes(leaf.path)) routes.push(leaf.path);
  }
  return routes;
}

/** The generated Studio map beside this check, and the routes it derives (none is an error). */
function mappedRoutes(file = path.join(__dirname, '../generated/studio-map.json')) {
  const routes = studioRoutes(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.ok(routes.length > 0, `no Studio routes derived from ${file}: a run that visits no route proves nothing`);
  return routes;
}

async function main() {
  const origin = new URL(process.argv[2] || process.env.STUDIO_ORIGIN || 'http://127.0.0.1:4503').origin;
  const sourceFile = path.join(__dirname, '../components/StudioPage.tsx');
  assert.deepEqual(findHostCellTree(fs.readFileSync(sourceFile, 'utf8'), 'StudioPage.tsx'), [], 'The generic renderer places sections; it authors no nav/ul/li of its own');
  const browser = await launchChrome({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(`window.inspectStudioSelection = ${inspectStudioSelection.toString()};`);
    const configResponse = await page.request.get(origin + '/api/config');
    assert.equal(configResponse.status(), 200, 'Producer config');
    const { selection } = await configResponse.json();
    assertUsableSelection(selection);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/api/events`, route => route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }));
    // Studio's own pages over the live slot model: every published route and each leaf template.
    const checks = [];
    const routes = mappedRoutes();
    for (const route of routes) {
      const requireNeeds = route.startsWith('/designer');
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 200, route);
      await page.getByRole('heading', { level: 1 }).waitFor();
      const result = await page.evaluate(inspectStudioBody, CONTENT_OUTLETS);
      assertCovered(result, route);
      const selectionEvidence = await page.evaluate(({ selection, requireNeeds }) => inspectStudioSelection(selection, requireNeeds), { selection, requireNeeds });
      assertSelection(selectionEvidence, route);
      await proveDetector(page);
      await proveSelectionDetector(page, selection);
      checks.push({ route, state: 'ready', ...result, selection: selectionEvidence });
      // The shell opens its command menu from the keyboard (Ctrl/Cmd+K); it renders no trigger button.
      // A key pressed before the route hydrates is dropped, so press again (bounded) until the menu opens.
      const dialog = page.getByRole('dialog');
      for (let attempt = 0; attempt < 10 && !(await dialog.isVisible()); attempt++) {
        // A specimen iframe can take focus as it loads (its keys then never reach Studio); return focus first.
        await page.evaluate(() => { if (document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur(); });
        await page.keyboard.press('ControlOrMeta+k');
        await dialog.waitFor({ timeout: 3000 }).catch(() => undefined);
      }
      // Opening the command menu must keep every rendered root on the selected fill (audited below).
      await dialog.waitFor({ timeout: 1000 }).catch(async () => assert.fail(`${route}: the command menu did not open (focus: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160))})`));
      const commandBody = await page.evaluate(inspectStudioBody, CONTENT_OUTLETS);
      assertCovered(commandBody, `${route} command menu`);
      const commandSelection = await page.evaluate(({ selection, requireNeeds }) => inspectStudioSelection(selection, requireNeeds), { selection, requireNeeds });
      assertSelection(commandSelection, `${route} command menu`);
      checks.push({ route, state: 'command-menu', ...commandBody, selection: commandSelection });
      // A specimen frame that loads while the menu is open can take focus too (named red: an open-overlay fixture).
      await page.evaluate(() => { if (document.activeElement instanceof HTMLIFrameElement) { document.activeElement.blur(); document.querySelector('[role="dialog"] input')?.focus(); } });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => assert.fail(`${route}: Escape did not close the command menu (focus: ${await page.evaluate(() => `${document.activeElement?.localName} value=${JSON.stringify(document.activeElement?.value)} dialogs=${document.querySelectorAll("[role=dialog]").length}`)})`));
    }
    assert.deepEqual(errors, [], 'browser page errors');
    console.log(JSON.stringify({ check: 'Studio no handrolling', routes: routes.length, checks, positiveProof: 'unstamped descendants inside an existing leaf and bare text accepted', negativeProof: 'visible and hidden unmarked body siblings, unmarked content in the frame content outlet, altered fill hashes, non-pinned candidate versions, altered selected CSS (when compiled), and unowned RAC descendants rejected on every route', sourceProof: 'the generic renderer has no host-authored nav/ul/li' }, null, 2));
  } finally {
    await browser.close();
  }
}

module.exports = { CONTENT_OUTLETS, inspectStudioBody, inspectStudioSelection, findHostCellTree, assertCovered, assertSelection, assertUsableSelection, studioRoutes, mappedRoutes };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = failureExitCode(error); });
