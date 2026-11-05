#!/usr/bin/env node
/**
 * studio:modules — the header popover check of every page manifest, against a running Studio.
 *
 *   node studio/checks/studio-modules-check.mjs <origin> [--out report.json] [--full] [--only <path>...]
 *
 * Scope: the browserless manifest pass always covers every page manifest. The browser pass covers
 * the page records by default (Home, the agent galleries and the Publisher page; see pageRecords in
 * ./studio-dom-check.mjs), so it finishes well inside the check:studio timeout; `--full` runs it on
 * every map entry, the L3 leaves' versions and request-change wiring included.
 *
 * First, without a browser, every page manifest of the generated Publisher projection must carry
 * its required popovers: the navigator (explorer or outline) and checks on every page,
 * plus versions and request change on every L3 leaf. A manifest missing one fails (rc 1).
 *
 * Then, for every entry in scope (with --full: Home, the agent galleries and every L3 leaf), it runs
 * each wiring line in a real Chrome, judging only the rendered DOM:
 *   - open <id>: the header icon opens its popover anchored to it and `?p=` names it;
 *   - select <explorer|outline|versions>: every item, clicked, brings its target into the page
 *     column's view and is the highlighted (selected) item;
 *   - search explorer: typing an item's name filters the tree down to fewer items, that one kept;
 *   - copy <action>: the popover's copy button writes the request-change prompt to the
 *     clipboard, exactly the text it shows;
 *   - cmdk: the command menu lists every popover with its shortcut, and running one opens it;
 *   - key <letter>: the shortcut opens its popover; key escape and click outside close it.
 * Every page also keeps the frame rules: the left sidebar toggle first in the header before the
 * breadcrumb, the chat toggle last in the top-right corner after a vertical separator, one header
 * icon per manifest popover in manifest order, a header of breadcrumb and icon buttons only, and
 * no form, text area or save control anywhere (Studio is read-only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chrome, loadStudioMap, scopeEntries } from './studio-dom-check.mjs';

const studio = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const projection = JSON.parse(readFileSync(join(studio, 'generated/studio-map.json'), 'utf8'));

/** The manifest that governs a map entry: its page record's, or its gallery's leaf manifest. */
function manifestOf(entry) {
  const [pageId, slug] = entry.id.split(':');
  const page = projection.pages.find(row => row.id === pageId);
  if (!page) return undefined;
  return slug ? page.leaf?.manifest : page.manifest;
}

const js = value => JSON.stringify(value);

/** The popovers every page carries, and the ones every L3 leaf adds. */
const REQUIRED = [
  { what: 'navigator', has: manifest => manifest.modules.some(module => module.id === manifest.navigator) },
  { what: 'checks', has: manifest => manifest.modules.some(module => module.id === 'checks' && module.source === 'page.checks') },
];
const REQUIRED_LEAF = [
  { what: 'versions', has: manifest => manifest.modules.some(module => module.id === 'versions' && module.source === 'page.versions') },
  { what: 'request-change', has: manifest => manifest.actions.some(action => action.id === 'request-change' && action.handler?.kind === 'copy-prompt') },
];

/** Required popovers missing from a page manifest of the projection, and wiring lines naming no popover. */
export function manifestFindings(pages = projection.pages) {
  const out = [];
  const visit = (owner, manifest, leaf) => {
    if (!manifest) { out.push({ rule: 'no-manifest', owner }); return; }
    for (const rule of [...REQUIRED, ...(leaf ? REQUIRED_LEAF : [])]) if (!rule.has(manifest)) out.push({ rule: 'required-popover', owner, missing: rule.what });
    for (const action of manifest.actions) if (action.id === 'copy-link' || action.handler?.kind !== 'copy-prompt') out.push({ rule: 'unsupported-action', owner, action: action.id });
    const ids = new Set([...manifest.modules, ...manifest.actions].map(row => row.id));
    for (const line of manifest.wiring) {
      const [verb, arg] = line.do.split(' ');
      if ((verb === 'open' || verb === 'copy' || verb === 'select' || verb === 'search') && !ids.has(arg)) out.push({ rule: 'wiring-unknown-popover', owner, do: line.do });
    }
  };
  for (const page of pages) {
    visit(page.id, page.manifest, false);
    if (page.leaf) visit(`${page.id}:leaf`, page.leaf.manifest, true);
  }
  return out;
}

/** Wait for a DOM condition (an expression) for up to `ms`. */
const until = (condition, ms = 8000) => `new Promise(resolve => {
  const start = Date.now();
  (function poll() {
    let value; try { value = (${condition}); } catch { value = false; }
    if (value || Date.now() - start > ${ms}) return resolve(Boolean(value));
    setTimeout(poll, 100);
  })();
})`;

const SETTLED = `new Promise(resolve => {
  const start = Date.now();
  (function poll() {
    const main = document.querySelector('#studio-main');
    const busy = !main || main.querySelector('[data-slot="skeleton"]') || !main.innerText.trim();
    if (!busy || Date.now() - start > 20000) return setTimeout(() => resolve(!busy), 400);
    setTimeout(poll, 150);
  })();
})`;

const IN_VIEW = selector => `(() => {
  const main = document.getElementById('studio-main');
  let element; try { element = main?.querySelector(${js(selector)}); } catch { return false; }
  if (!main || !element) return false;
  const m = main.getBoundingClientRect(), r = element.getBoundingClientRect();
  return r.top < m.bottom - 1 && r.bottom > m.top + 1 && r.top >= m.top - 4 - Math.max(0, r.height - m.height);
})()`;

const STATE = `(() => ({
  open: [...document.querySelectorAll('[data-popover]')].filter(element => element.getBoundingClientRect().width > 0).map(element => element.getAttribute('data-popover')),
  expanded: [...document.querySelectorAll('header [data-popover-trigger]')].filter(button => button.getAttribute('aria-expanded') === 'true').map(button => button.getAttribute('data-popover-trigger')),
  url: new URLSearchParams(location.search).get('p'),
}))()`;

const FRAME = ids => `(() => {
  const out = [];
  const width = innerWidth;
  const visible = element => element.getBoundingClientRect().width > 0;
  const header = document.querySelector('header');
  if (!header) return [{ rule: 'header-missing' }];
  const buttons = [...header.querySelectorAll('button, a[role="button"]')].filter(visible).filter(control => !control.closest('[data-slot="breadcrumb"], nav[aria-label="breadcrumb" i]'));
  const left = [...document.querySelectorAll('[data-panel-toggle="left"]')].find(visible);
  const chat = [...document.querySelectorAll('[data-panel-toggle="chat"]')].find(visible);
  const crumbs = header.querySelector('nav[aria-label="breadcrumb" i], [data-slot="breadcrumb"]');
  if (!crumbs) out.push({ rule: 'header-breadcrumb' });
  // shadcn sidebar-15: the left sidebar trigger opens the header, before the breadcrumb.
  if (!left) out.push({ rule: 'left-toggle-missing' });
  else if (left.closest('header') !== header || buttons[0] !== left || (crumbs && !(left.compareDocumentPosition(crumbs) & Node.DOCUMENT_POSITION_FOLLOWING))) out.push({ rule: 'left-toggle-first' });
  // The chat toggle closes the header, after a vertical separator, in the top-right corner.
  if (!chat) out.push({ rule: 'chat-toggle-missing' });
  else {
    const r = chat.getBoundingClientRect();
    if (chat.closest('header') !== header || buttons.at(-1) !== chat) out.push({ rule: 'chat-toggle-last' });
    const before = chat.previousElementSibling;
    if (!before || !(before.matches('[data-slot="separator"], [role="separator"]') && (before.getAttribute('data-orientation') === 'vertical' || before.hasAttribute('data-vertical') || before.getAttribute('aria-orientation') === 'vertical'))) out.push({ rule: 'chat-toggle-separator' });
    if (width - r.right > 64 || r.top > 56) out.push({ rule: 'chat-toggle-corner', right: Math.round(width - r.right), top: Math.round(r.top) });
  }
  // One header icon per manifest popover, in manifest order, between the two toggles.
  const triggers = [...header.querySelectorAll('[data-popover-trigger]')].filter(visible).map(button => button.getAttribute('data-popover-trigger'));
  if (JSON.stringify(triggers) !== JSON.stringify(${'${js(ids)}'})) out.push({ rule: 'popover-triggers', found: triggers, want: ${'${js(ids)}'} });
  for (const control of header.querySelectorAll('button, a[role="button"], input, select, textarea')) {
    if (control.closest('[data-slot="breadcrumb"], nav[aria-label="breadcrumb" i]')) continue;
    if (control.matches('input, select, textarea')) { out.push({ rule: 'header-field' }); continue; }
    const text = [...control.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join('');
    const named = control.getAttribute('aria-label') || control.querySelector(':scope > .sr-only')?.textContent.trim();
    if (text || !named || !control.querySelector('svg')) out.push({ rule: 'header-not-icon-button', label: (control.getAttribute('aria-label') || control.textContent).trim().slice(0, 40) });
  }
  if (document.querySelector('form, textarea, [contenteditable="true"]')) out.push({ rule: 'read-only', found: 'form or text area' });
  for (const input of document.querySelectorAll('input:not([type="hidden"])')) if (!input.closest('[role="dialog"]')) out.push({ rule: 'read-only', found: 'input ' + (input.getAttribute('aria-label') || input.name || input.type) });
  for (const button of document.querySelectorAll('button')) if (/^(save|submit|apply|publish|delete)\\b/i.test(button.textContent.trim())) out.push({ rule: 'read-only', found: 'button ' + button.textContent.trim().slice(0, 30) });
  return out;
})()`;

export async function runModulesCheck(origin, { only, full = false } = {}) {
  origin = new URL(origin).origin;
  const started = Date.now();
  const { entries, targets, records } = await loadStudioMap(origin, { scope: all => scopeEntries(all, { only, full }) });
  const mapSeconds = (Date.now() - started) / 1000;
  console.error(`studio:modules: map loaded in ${mapSeconds}s, ${targets.length} of ${entries.length} entries in scope, ${Object.keys(records).length} leaf record(s)`);
  const findings = [], checked = [];
  const browser = await chrome();
  const { send, evaluate } = browser;
  const press = async selector => evaluate(`(() => { const element = document.querySelector(${js(selector)}); if (!element) return false; element.click(); return true; })()`);
  const gesture = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })).result?.result?.value;
  const key = async (keyName, { code, modifiers = 0, keyCode } = {}) => {
    const text = keyName.length === 1 ? keyName : undefined;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode });
  };
  const blur = () => evaluate(`(() => { document.activeElement?.blur?.(); return true; })()`);
  const state = () => evaluate(STATE);
  const popover = id => `[data-popover=${js(id)}]`;
  // Shown and settled: measured after its entry animation, so its placement is final.
  const shown = id => `(() => { const element = document.querySelector(${js(popover(id))}); return Boolean(element && element.getBoundingClientRect().width > 0 && !element.hasAttribute('data-entering')); })()`;
  const escape = () => key('Escape', { code: 'Escape', keyCode: 27 });
  const closeAll = async () => {
    for (let i = 0; i < 3 && (await state())?.open?.length; i++) { await escape(); await sleep(200); }
    await evaluate(until(`!document.querySelector('[data-popover]') && !new URLSearchParams(location.search).get('p')`, 2000));
    await evaluate(`(() => { const main = document.getElementById('studio-main'); if (main) main.scrollTop = 0; return true; })()`);
  };
  const open = async id => {
    if (!(await state())?.open?.includes(id)) await press(`header [data-popover-trigger=${js(id)}]`);
    return evaluate(until(shown(id), 3000));
  };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const clipboard = () => gesture(`navigator.clipboard.readText().catch(error => 'ERROR ' + error.message)`);
  const resetClipboard = () => gesture(`navigator.clipboard.writeText('').then(() => true, () => false)`);

  for (const finding of manifestFindings()) findings.push({ path: '(manifest)', ...finding });
  try {
    for (const entry of targets) {
      const pageStarted = Date.now();
      const add = (rule, extra = {}) => findings.push({ rule, path: entry.path, ...extra });
      const manifest = manifestOf(entry);
      if (!manifest) { add('no-manifest'); continue; }
      const popovers = [...manifest.modules, ...manifest.actions];
      const ids = popovers.map(row => row.id);
      const errorsBefore = browser.errors.length;
      await send('Page.navigate', { url: new URL(entry.path, origin).href });
      await sleep(300);
      if (!(await evaluate(SETTLED))) add('render-timeout');
      for (const { rule, ...extra } of await evaluate(FRAME(ids)) ?? []) add(rule, extra);
      const lines = [];
      const result = (line, ok, extra = {}) => { lines.push({ do: line.do, ok }); if (!ok) add('wiring', { do: line.do, expect: line.expect, ...extra }); };
      for (const line of manifest.wiring) {
        await closeAll();
        await blur();
        const [verb, ...rest] = line.do.split(' ');
        const arg = rest.join(' ');
        if (verb === 'open') {
          await press(`header [data-popover-trigger=${js(arg)}]`);
          const opened = await evaluate(until(shown(arg), 3000));
          const on = await state();
          // Anchored to its header icon: the popover's top sits just below the icon.
          const anchored = await evaluate(`(() => { const p = document.querySelector(${js(popover(arg))})?.getBoundingClientRect(), t = document.querySelector(${js(`header [data-popover-trigger=${js(arg)}]`)})?.getBoundingClientRect(); return Boolean(p && t && p.top >= t.bottom - 1 && p.top - t.bottom < 24); })()`);
          result(line, opened && anchored && on.url === arg && js(on.open) === js([arg]) && on.expanded.includes(arg), { on, anchored });
        } else if (verb === 'select') {
          await open(arg);
          const module = manifest.modules.find(row => row.id === arg);
          const attribute = module?.source === 'page.explorer' ? 'data-explorer-target' : 'data-outline-target';
          await evaluate(until(`document.querySelectorAll(${js(`${popover(arg)} [${attribute}]`)}).length`, 10000));
          const items = await evaluate(`[...document.querySelectorAll(${js(`${popover(arg)} [${attribute}]`)})].map(item => item.getAttribute(${js(attribute)}))`) ?? [];
          const failed = [];
          for (const [index, selector] of items.entries()) {
            const item = `${popover(arg)} [${attribute}=${js(selector)}]`;
            if (!(await evaluate(shown(arg)))) await open(arg);
            await press(item);
            await sleep(120);
            const inView = await evaluate(until(IN_VIEW(selector), 2500));
            const selected = await evaluate(until(`document.querySelector(${js(item)})?.getAttribute('data-selected') === 'true'`, 1500));
            if (!inView || !selected) failed.push({ index, selector, inView, selected });
          }
          result(line, items.length > 0 && !failed.length, { items: items.length, failed: failed.slice(0, 5) });
        } else if (verb === 'search') {
          await open(arg);
          const items = `${popover(arg)} [data-explorer-target]`;
          await evaluate(until(`document.querySelectorAll(${js(items)}).length`, 10000));
          const before = await evaluate(`[...document.querySelectorAll(${js(items)})].map(item => item.textContent.trim())`) ?? [];
          const query = before.at(-1) ?? '';
          await evaluate(`(() => { const input = document.querySelector(${js(`${popover(arg)} input`)}); input?.focus(); return Boolean(input); })()`);
          await send('Input.insertText', { text: query });
          await sleep(400);
          const after = await evaluate(`[...document.querySelectorAll(${js(items)})].map(item => item.textContent.trim())`) ?? [];
          result(line, before.length > 1 && after.length > 0 && after.length < before.length && after.includes(query), { before: before.length, after: after.length, query });
        } else if (verb === 'copy') {
          const action = manifest.actions.find(row => row.id === arg);
          if (!action) { result(line, false, { reason: 'no such action' }); continue; }
          await open(arg);
          await resetClipboard();
          const shownText = await evaluate(`document.querySelector(${js(`[data-popover-text=${js(arg)}]`)})?.textContent ?? ''`);
          await gesture(`(() => { document.querySelector(${js(`[data-popover-copy=${js(arg)}]`)})?.click(); return true; })()`);
          await sleep(400);
          const text = await clipboard();
          // The page link, without the popover state.
          const href = await evaluate(`(() => { const url = new URL(location.href); url.searchParams.delete('p'); return url.href; })()`);
          const ok = action.handler.kind === 'copy-prompt' && text === shownText && typeof text === 'string' && text.includes(href) && text.includes('What should change') && !/\{(agent|title|url)\}/.test(text);
          result(line, ok, { clipboard: String(text).slice(0, 120), shown: String(shownText).slice(0, 120), href });
        } else if (verb === 'cmdk') {
          await key('k', { code: 'KeyK', modifiers: 4, keyCode: 75 });
          await evaluate(until(`document.querySelector('[role="dialog"] [data-page-command]')`, 3000));
          const listed = await evaluate(`[...document.querySelectorAll('[role="dialog"] [data-page-command]')].map(item => ({ id: item.getAttribute('data-page-command'), shortcut: item.querySelector('[data-slot="command-shortcut"]')?.textContent.trim() ?? '' }))`) ?? [];
          const missing = popovers.filter(row => !listed.some(item => item.id === `popover:${row.id}` && item.shortcut.toLowerCase() === row.shortcut));
          // Run the last popover from the menu: it must open that popover.
          const last = popovers.at(-1);
          await press(`[role="dialog"] [data-page-command=${js(`popover:${last.id}`)}]`);
          const ran = await evaluate(until(`${shown(last.id)} && !document.querySelector('[role="dialog"] [data-page-command]')`, 3000));
          result(line, popovers.length > 0 && !missing.length && listed.length === popovers.length && ran, { missing: missing.map(row => row.id), listed: listed.length, ran });
        } else if (verb === 'key' && arg === 'escape') {
          const first = ids[0];
          const opened = await open(first);
          await escape();
          const closed = await evaluate(until(`!document.querySelector('[data-popover]')`, 3000));
          const after = await state();
          result(line, opened && closed && !after.url, { opened, after });
        } else if (verb === 'key') {
          const row = popovers.find(item => item.shortcut === arg);
          await key(arg, { code: `Key${arg.toUpperCase()}`, keyCode: arg.toUpperCase().charCodeAt(0) });
          const opened = Boolean(row) && await evaluate(until(shown(row.id), 3000));
          result(line, opened && (await state()).url === row?.id, { popover: row?.id });
        } else if (verb === 'click' && arg === 'outside') {
          const first = ids[0];
          const opened = await open(first);
          // A point in the page column, clear of the popover.
          const point = await evaluate(`(() => { const m = document.getElementById('studio-main').getBoundingClientRect(), p = document.querySelector(${js(popover(first))})?.getBoundingClientRect(); const x = Math.round(m.left + 24), y = Math.round(m.bottom - 24); return p && x >= p.left && x <= p.right && y >= p.top && y <= p.bottom ? null : { x, y }; })()`);
          if (point) await clickAt(point.x, point.y);
          const closed = Boolean(point) && await evaluate(until(`!document.querySelector('[data-popover]')`, 3000));
          const after = await state();
          result(line, opened && closed && !after.url, { opened, point, after });
        } else result(line, false, { reason: 'unknown wiring verb' });
      }
      for (const error of browser.errors.slice(errorsBefore)) add('page-error', { message: error });
      checked.push({ path: entry.path, seconds: (Date.now() - pageStarted) / 1000, lines: lines.length, failed: lines.filter(line => !line.ok).length, na: lines.filter(line => line.na).length });
      console.error(`studio:modules: ${entry.path} ${checked.at(-1).seconds}s`);
    }
    const lines = checked.reduce((sum, row) => sum + row.lines, 0);
    return { check: 'studio:modules', status: findings.length ? 'FAIL' : 'PASS', origin, scope: only?.length ? 'only' : full ? 'full' : 'pages', timings: { mapSeconds, leafRecords: Object.keys(records).length, totalSeconds: (Date.now() - started) / 1000 }, entries: entries.length, checked: checked.length, lines, findings, pages: checked };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const origin = args[0];
  const outIndex = args.indexOf('--out');
  const out = outIndex > 0 ? args[outIndex + 1] : undefined;
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex > 0 ? args.slice(onlyIndex + 1).filter(arg => arg !== '--out' && arg !== out && arg !== '--full') : undefined;
  const full = args.includes('--full');
  if (!origin) { console.error('Usage: studio-modules-check.mjs <origin> [--out report.json] [--full] [--only <path>...]'); process.exit(2); }
  runModulesCheck(origin, { only, full }).then(report => {
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    const rules = {};
    for (const finding of report.findings) rules[finding.rule] = (rules[finding.rule] ?? 0) + 1;
    console.log(JSON.stringify({ check: report.check, status: report.status, scope: report.scope, timings: report.timings, slowest: [...report.pages].sort((a, b) => b.seconds - a.seconds).slice(0, 5).map(row => `${row.path} ${row.seconds}s`), entries: report.entries, checked: report.checked, lines: report.lines, rules, sample: report.findings.slice(0, 20) }, null, 2));
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  }, error => { console.error(error); process.exitCode = error.env ? 2 : 1; });
}
