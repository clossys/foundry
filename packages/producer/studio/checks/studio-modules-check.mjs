#!/usr/bin/env node
/**
 * studio:modules — the browser wiring check of every page manifest, against a running Studio.
 *
 *   node studio/checks/studio-modules-check.mjs <origin> [--out report.json] [--only <path>...]
 *
 * For every entry of the runtime map (Home, the agent galleries and every L3 leaf) it reads the
 * page's manifest from the generated Publisher projection and runs each wiring line in a real
 * Chrome, judging only the rendered DOM:
 *   - toggle <module>: the header icon button presses, the module panel opens and `?m=` names it;
 *     a second press closes it;
 *   - select <explorer|outline>: every item, clicked, brings its target into the page column's
 *     view and is the highlighted (selected) item;
 *   - search explorer: typing an item's name filters the tree down to fewer items, that one kept;
 *   - action <id>: copy-link and copy-prompt write the page URL (and the prompt) to the clipboard;
 *     a scroll action brings its target into view (or is disabled when the page has no target);
 *   - cmdk: the command menu lists every module toggle and page action with its shortcut, and
 *     running a toggle from it opens that module;
 *   - key <letter>: the shortcut opens its module; key escape: with two modules open (stacked in
 *     icon order) Esc closes the top one.
 * Every page also keeps the frame rules: the rail toggle in the top-left corner, the chat toggle
 * in the top-right corner, a header of breadcrumb and icon buttons only, and no form, text area
 * or save control anywhere (Studio is read-only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chrome, loadStudioMap } from './studio-dom-check.mjs';

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
  pressed: Object.fromEntries([...document.querySelectorAll('[data-module-toggle]')].map(button => [button.getAttribute('data-module-toggle'), button.getAttribute('aria-pressed') === 'true'])),
  column: [...document.querySelectorAll('[data-module-column] [data-module]')].map(panel => panel.getAttribute('data-module')),
  url: new URLSearchParams(location.search).get('m'),
}))()`;

const FRAME = `(() => {
  const out = [];
  const width = innerWidth;
  const rail = [...document.querySelectorAll('[data-panel-toggle="rail"]')].find(element => element.getBoundingClientRect().width > 0);
  const chat = [...document.querySelectorAll('[data-panel-toggle="chat"]')].find(element => element.getBoundingClientRect().width > 0);
  if (!rail) out.push({ rule: 'rail-toggle-missing' });
  else { const r = rail.getBoundingClientRect(); if (r.left > 64 || r.top > 56) out.push({ rule: 'rail-toggle-corner', left: Math.round(r.left), top: Math.round(r.top) }); }
  if (!chat) out.push({ rule: 'chat-toggle-missing' });
  else { const r = chat.getBoundingClientRect(); if (width - r.right > 64 || r.top > 56) out.push({ rule: 'chat-toggle-corner', right: Math.round(width - r.right), top: Math.round(r.top) }); }
  const header = document.querySelector('header');
  if (!header) out.push({ rule: 'header-missing' });
  else {
    if (!header.querySelector('nav[aria-label="breadcrumb" i], [data-slot="breadcrumb"]')) out.push({ rule: 'header-breadcrumb' });
    for (const control of header.querySelectorAll('button, a[role="button"], input, select, textarea')) {
      if (control.closest('[data-slot="breadcrumb"], nav[aria-label="breadcrumb" i]')) continue;
      if (control.matches('input, select, textarea')) { out.push({ rule: 'header-field' }); continue; }
      const text = [...control.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join('');
      if (text || !control.getAttribute('aria-label') || !control.querySelector('svg')) out.push({ rule: 'header-not-icon-button', label: (control.getAttribute('aria-label') || control.textContent).trim().slice(0, 40) });
    }
  }
  if (document.querySelector('form, textarea, [contenteditable="true"]')) out.push({ rule: 'read-only', found: 'form or text area' });
  for (const input of document.querySelectorAll('input:not([type="hidden"])')) if (!input.closest('[data-studio-section="module-explorer"], [role="dialog"]')) out.push({ rule: 'read-only', found: 'input ' + (input.getAttribute('aria-label') || input.name || input.type) });
  for (const button of document.querySelectorAll('button')) if (/^(save|submit|apply|publish|delete)\\b/i.test(button.textContent.trim())) out.push({ rule: 'read-only', found: 'button ' + button.textContent.trim().slice(0, 30) });
  return out;
})()`;

export async function runModulesCheck(origin, { only } = {}) {
  origin = new URL(origin).origin;
  const { entries } = await loadStudioMap(origin);
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
  const closeAll = async () => {
    for (const [id, pressed] of Object.entries((await state())?.pressed ?? {})) if (pressed) await press(`[data-module-toggle=${js(id)}]`);
    await evaluate(until(`!document.querySelector('[data-module-column]')`, 2000));
    await evaluate(`(() => { const main = document.getElementById('studio-main'); if (main) main.scrollTop = 0; return true; })()`);
  };
  const open = async id => {
    if (!(await state())?.pressed?.[id]) await press(`[data-module-toggle=${js(id)}]`);
    return evaluate(until(`document.querySelector('[data-module-column] [data-module=${js(id)}]')`, 3000));
  };
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const clipboard = () => gesture(`navigator.clipboard.readText().catch(error => 'ERROR ' + error.message)`);
  const resetClipboard = () => gesture(`navigator.clipboard.writeText('').then(() => true, () => false)`);

  try {
    const targets = only?.length ? entries.filter(entry => only.includes(entry.path)) : entries;
    for (const entry of targets) {
      const add = (rule, extra = {}) => findings.push({ rule, path: entry.path, ...extra });
      const manifest = manifestOf(entry);
      if (!manifest) { add('no-manifest'); continue; }
      const errorsBefore = browser.errors.length;
      await send('Page.navigate', { url: new URL(entry.path, origin).href });
      await sleep(300);
      if (!(await evaluate(SETTLED))) add('render-timeout');
      for (const { rule, ...extra } of await evaluate(FRAME) ?? []) add(rule, extra);
      const lines = [];
      const result = (line, ok, extra = {}) => { lines.push({ do: line.do, ok }); if (!ok) add('wiring', { do: line.do, expect: line.expect, ...extra }); };
      const modules = manifest.modules;
      for (const line of manifest.wiring) {
        await closeAll();
        await blur();
        const [verb, ...rest] = line.do.split(' ');
        const arg = rest.join(' ');
        if (verb === 'toggle') {
          await press(`[data-module-toggle=${js(arg)}]`);
          const opened = await evaluate(until(`document.querySelector('[data-module-column] [data-module=${js(arg)}]')`, 3000));
          const on = await state();
          await press(`[data-module-toggle=${js(arg)}]`);
          const closed = await evaluate(until(`!document.querySelector('[data-module=${js(arg)}]')`, 3000));
          const off = await state();
          result(line, opened && on.pressed[arg] && (on.url ?? '').split(',').includes(arg) && closed && !off.pressed[arg] && !(off.url ?? '').split(',').includes(arg), { on, off });
        } else if (verb === 'select') {
          await open(arg);
          const attribute = arg === 'explorer' ? 'data-explorer-target' : 'data-outline-target';
          await evaluate(until(`document.querySelectorAll('[data-module=${js(arg)}] [${attribute}]').length`, 10000));
          const items = await evaluate(`[...document.querySelectorAll('[data-module=${js(arg)}] [${attribute}]')].map(item => item.getAttribute(${js(attribute)}))`) ?? [];
          const failed = [];
          for (const [index, selector] of items.entries()) {
            const item = `[data-module=${js(arg)}] [${attribute}=${js(selector)}]`;
            await press(item);
            await sleep(120);
            const inView = await evaluate(until(IN_VIEW(selector), 2500));
            const selected = await evaluate(until(`document.querySelector(${js(item)})?.getAttribute('data-selected') === 'true'`, 1500));
            if (!inView || !selected) failed.push({ index, selector, inView, selected });
          }
          result(line, items.length > 0 && !failed.length, { items: items.length, failed: failed.slice(0, 5) });
        } else if (verb === 'search') {
          await open(arg);
          await evaluate(until(`document.querySelectorAll('[data-module=${js(arg)}] [data-explorer-target]').length`, 10000));
          const before = await evaluate(`[...document.querySelectorAll('[data-module=${js(arg)}] [data-explorer-target]')].map(item => item.textContent.trim())`) ?? [];
          const query = before.at(-1) ?? '';
          await evaluate(`(() => { const input = document.querySelector('[data-module=${js(arg)}] input'); input?.focus(); return Boolean(input); })()`);
          await send('Input.insertText', { text: query });
          await sleep(400);
          const after = await evaluate(`[...document.querySelectorAll('[data-module=${js(arg)}] [data-explorer-target]')].map(item => item.textContent.trim())`) ?? [];
          result(line, before.length > 1 && after.length > 0 && after.length < before.length && after.includes(query), { before: before.length, after: after.length, query });
        } else if (verb === 'action') {
          const action = manifest.actions.find(row => row.id === arg);
          const button = `[data-page-action=${js(arg)}]`;
          if (!action) { result(line, false, { reason: 'no such action' }); continue; }
          if (action.handler.kind === 'scroll') {
            const present = await evaluate(`Boolean(document.getElementById('studio-main')?.querySelector(${js(action.handler.target)}))`);
            const disabled = await evaluate(`document.querySelector(${js(button)})?.disabled === true || document.querySelector(${js(button)})?.getAttribute('data-disabled') === 'true'`);
            if (!present) { result(line, disabled, { reason: 'no target on this page; the action must be disabled', disabled }); lines.at(-1).na = true; continue; }
            await press(button);
            result(line, await evaluate(until(IN_VIEW(action.handler.target), 2500)), { target: action.handler.target });
          } else {
            await resetClipboard();
            await gesture(`(() => { document.querySelector(${js(button)})?.click(); return true; })()`);
            await sleep(400);
            const text = await clipboard();
            const href = await evaluate('location.href');
            const ok = action.handler.kind === 'copy-link' ? text === href : typeof text === 'string' && text.includes(href) && text.includes('What should change') && !/\{(agent|title|url)\}/.test(text);
            result(line, ok, { clipboard: String(text).slice(0, 120), href });
          }
        } else if (verb === 'cmdk') {
          await key('k', { code: 'KeyK', modifiers: 4, keyCode: 75 });
          await evaluate(until(`document.querySelector('[role="dialog"] [data-page-command]')`, 3000));
          const listed = await evaluate(`[...document.querySelectorAll('[role="dialog"] [data-page-command]')].map(item => ({ id: item.getAttribute('data-page-command'), label: (item.getAttribute('aria-label') || item.textContent).trim(), shortcut: item.querySelector('[data-slot="command-shortcut"]')?.textContent.trim() ?? '' }))`) ?? [];
          const wanted = [
            ...modules.map(module => ({ id: `module:${module.id}`, shortcut: module.shortcut })),
            ...manifest.actions.filter(action => action.cmdk).map(action => ({ id: `action:${action.id}`, shortcut: action.shortcut })),
          ];
          const missing = wanted.filter(row => !listed.some(item => item.id === row.id && (!row.shortcut || item.shortcut.toLowerCase() === row.shortcut)));
          // Run the last module toggle from the menu: it must open that module.
          const last = modules.at(-1);
          await press(`[role="dialog"] [data-page-command=${js(`module:${last.id}`)}]`);
          const ran = await evaluate(until(`document.querySelector('[data-module-column] [data-module=${js(last.id)}]') && !document.querySelector('[role="dialog"]')`, 3000));
          if (!ran) { await key('Escape', { code: 'Escape', keyCode: 27 }); await sleep(300); }
          result(line, wanted.length > 0 && !missing.length && ran, { missing, ran });
        } else if (verb === 'key' && arg !== 'escape') {
          const module = modules.find(row => row.shortcut === arg);
          await key(arg, { code: `Key${arg.toUpperCase()}`, keyCode: arg.toUpperCase().charCodeAt(0) });
          result(line, Boolean(module) && await evaluate(until(`document.querySelector('[data-module-column] [data-module=${js(module?.id ?? '')}]')`, 3000)), { module: module?.id });
        } else if (verb === 'key' && arg === 'escape') {
          for (const module of [...modules].reverse()) await open(module.id);
          const stacked = await state();
          const order = modules.map(module => module.id);
          await blur();
          await key('Escape', { code: 'Escape', keyCode: 27 });
          await evaluate(until(`!document.querySelector('[data-module-column] [data-module=${js(order[0])}]')`, 3000));
          const after = await state();
          result(line, js(stacked.column) === js(order) && js(after.column) === js(order.slice(1)), { stacked: stacked.column, after: after.column });
        } else result(line, false, { reason: 'unknown wiring verb' });
      }
      for (const error of browser.errors.slice(errorsBefore)) add('page-error', { message: error });
      checked.push({ path: entry.path, lines: lines.length, failed: lines.filter(line => !line.ok).length, na: lines.filter(line => line.na).length });
    }
    const lines = checked.reduce((sum, row) => sum + row.lines, 0);
    return { check: 'studio:modules', status: findings.length ? 'FAIL' : 'PASS', origin, entries: entries.length, checked: checked.length, lines, findings, pages: checked };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const origin = args[0];
  const outIndex = args.indexOf('--out');
  const out = outIndex > 0 ? args[outIndex + 1] : undefined;
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex > 0 ? args.slice(onlyIndex + 1).filter(arg => arg !== '--out' && arg !== out) : undefined;
  if (!origin) { console.error('Usage: studio-modules-check.mjs <origin> [--out report.json] [--only <path>...]'); process.exit(2); }
  runModulesCheck(origin, { only }).then(report => {
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    const rules = {};
    for (const finding of report.findings) rules[finding.rule] = (rules[finding.rule] ?? 0) + 1;
    console.log(JSON.stringify({ check: report.check, status: report.status, entries: report.entries, checked: report.checked, lines: report.lines, rules, sample: report.findings.slice(0, 20) }, null, 2));
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  }, error => { console.error(error); process.exitCode = error.env ? 2 : 1; });
}
