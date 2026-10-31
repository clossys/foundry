#!/usr/bin/env node
/**
 * studio:dom — the browser check over the one Studio map, against a running Studio.
 *
 *   node studio/checks/studio-dom-check.mjs <origin> [--out report.json] [--only <path>...]
 *
 * It builds the runtime map with Studio's own code (the compiled Publisher pages plus every leaf
 * the record stores hold, loaded from the same Producer endpoints) and then, for every entry:
 *   - the served path answers HTTP 200 and the page renders its assembly (no not-found, no error);
 *   - every internal link the page renders is a map path;
 *   - no specimen reads "No specimen";
 *   - a leaf shows Options, History and References whenever its records hold them.
 * On Home it opens the command menu and requires one command per map entry.
 *
 * Class-wide layout rules (LAYOUT), on every page, in light and again in dark:
 *   - card-grid: cards in one grid row are equal height; a card footer ends at the card bottom and
 *     spans its edges; no card description sits beside a card action (it would wrap in a narrow column);
 *   - card-in-card: the page body (#studio-main) never nests a card inside a card;
 *   - card-clipped: no card in the page body is shorter than its content (the column scrolls, cards never shrink);
 *   - jump-chips, tabs: no in-page anchor chip row and no tab list in the page body (one vertical scroll);
 *   - leaf-list: an agent gallery shows one leaf card per row, full width;
 *   - leaf-preview: every gallery leaf card carries the full preview of its active state (a lazily
 *     loaded view-only frame, or the record's content table) or a status saying why there is none;
 *   - image: every visible image has loaded (the rail brand mark in both themes);
 *   - theme-toggle: the rail footer carries one binary light/dark icon button;
 *   - leaf-count: Home and every gallery state the same leaf count, the map's L3 pages per agent;
 *   - publication-root: the Publisher page names a root for every publication.
 *
 * Chrome is driven over the DevTools protocol (no Playwright). CHROME_PATH overrides the binary.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const studio = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Studio's own map and record loaders, bundled for node with relative requests sent to `origin`. */
export async function loadStudioMap(origin) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'studio-dom-')));
  try {
    const entry = `export { studioLeafPages, studioRuntimeMap, studioPageEntries } from './lib/studio-route-map';
      export { loadDesignerGallery, loadDesignerLeaf } from './lib/designer-library';
      export { loadAgentGallery, loadAgentLeaf, agentOptionVersions, isLibraryAgent } from './lib/agent-library';`;
    const file = join(scratch, 'map.mjs');
    buildSync({ stdin: { contents: entry, resolveDir: studio, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: file, external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' });
    const native = globalThis.fetch;
    globalThis.fetch = (input, init) => native(typeof input === 'string' && input.startsWith('/') ? new URL(input, origin) : input, init);
    try {
      const lib = await import(pathToFileURL(file).href);
      const signal = new AbortController().signal;
      const leaves = {}, records = {};
      for (const page of lib.studioLeafPages) {
        const agent = page.leaf.data.agent ?? page.id;
        const gallery = agent === 'designer' ? await lib.loadDesignerGallery(signal) : await lib.loadAgentGallery(agent, signal);
        leaves[page.id] = gallery.sections.flatMap(section => section.cards.map(card => ({ slug: card.slug, title: card.name })));
        for (const { slug } of leaves[page.id]) {
          const leaf = agent === 'designer' ? await lib.loadDesignerLeaf(slug, signal) : await lib.loadAgentLeaf(agent, slug, signal);
          if (leaf) records[`${page.id}:${slug}`] = { agent, leaf };
        }
      }
      const map = lib.studioRuntimeMap(leaves);
      return { map, entries: lib.studioPageEntries(map), records, expect: id => expectations(lib, records[id]) };
    } finally { globalThis.fetch = native; }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** The sections a leaf must show because its records hold the data they present. */
function expectations(lib, record) {
  if (!record) return [];
  const { agent, leaf } = record;
  const sections = ['leaf-header', 'specimen', 'references'];
  if (agent === 'designer') {
    if (leaf.card.options.length) sections.push('options');
    if (leaf.versions.length) sections.push('history');
  } else {
    if (lib.agentOptionVersions(leaf).length) sections.push('options');
    if (leaf.history.length) sections.push('history');
    if (leaf.checks.length) sections.push('checks');
  }
  return sections;
}

export async function chrome() {
  const binary = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = mkdtempSync(join(tmpdir(), 'studio-dom-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 400);
  const child = spawn(binary, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(row => row.type === 'page'); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) { child.kill(); throw Object.assign(new Error(`Chrome did not start (${binary})`), { env: true }); }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 300));
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evaluate, errors, close: async () => { socket.close(); child.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); } };
}

/** Wait until the page settles: the frame is mounted, loaders are done and, for a leaf, the header is placed. */
const SETTLED = leaf => `new Promise(resolve => {
  const start = Date.now();
  (function poll() {
    const main = document.querySelector('#studio-main');
    const missing = /could not be found|404/i.test(document.title + ' ' + (document.body?.innerText ?? '').slice(0, 400)) && !main;
    const busy = !main || main.querySelector('[data-slot="skeleton"]') || ${leaf ? `!document.querySelector('[data-studio-section="leaf-header"]') && !main.innerText.trim()` : 'false'};
    if (missing || !busy || Date.now() - start > 20000) return setTimeout(() => resolve({ timedOut: Boolean(busy) && !missing, missing }), 400);
    setTimeout(poll, 150);
  })();
})`;

const PROBE = `(() => {
  const main = document.querySelector('#studio-main');
  return {
    text: document.body?.innerText ?? '',
    frame: Boolean(main),
    sections: [...document.querySelectorAll('[data-studio-section]')].map(element => element.getAttribute('data-studio-section')),
    headings: [...document.querySelectorAll('h1,h2,[role="heading"]')].map(element => element.textContent.trim()).filter(Boolean).length,
    links: [...document.querySelectorAll('a[href]')].map(element => element.href),
  };
})()`;

/** The class-wide layout probe; returns one finding per broken rule instance. */
const LAYOUT = `(() => {
  const out = [];
  const main = document.querySelector('#studio-main');
  const box = element => element.getBoundingClientRect();
  const visible = element => { const r = box(element); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
  for (const grid of document.querySelectorAll('[data-slot="card-grid"]')) {
    const cards = [...grid.children].filter(child => child.getAttribute('data-slot') === 'card' && visible(child));
    const rows = new Map();
    for (const card of cards) { const top = Math.round(box(card).top); rows.set(top, [...(rows.get(top) ?? []), card]); }
    for (const row of rows.values()) {
      const heights = row.map(card => Math.round(box(card).height));
      if (Math.max(...heights) - Math.min(...heights) > 1) out.push({ rule: 'card-grid-height', heights });
    }
    for (const card of cards) {
      const c = box(card);
      const footer = card.querySelector(':scope > [data-slot="card-footer"]');
      if (footer) {
        const f = box(footer);
        if (Math.abs(f.bottom - c.bottom) > 1.5 || Math.abs(f.left - c.left) > 1.5 || Math.abs(f.right - c.right) > 1.5) out.push({ rule: 'card-footer-bleed', gap: { bottom: Math.round(c.bottom - f.bottom), left: Math.round(f.left - c.left), right: Math.round(c.right - f.right) } });
      }
      for (const action of card.querySelectorAll('[data-slot="card-action"]')) {
        const a = box(action);
        for (const description of action.parentElement.querySelectorAll(':scope > [data-slot="card-description"]')) {
          const d = box(description);
          if (d.top < a.bottom - 1 && d.bottom > a.top + 1) out.push({ rule: 'card-description-beside-action', text: description.textContent.trim().slice(0, 40) });
        }
      }
    }
    if (grid.closest('[data-studio-section="agent-gallery"]')) {
      const g = box(grid);
      for (const card of cards) if (Math.abs(box(card).width - g.width) > 1.5) { out.push({ rule: 'leaf-list', card: Math.round(box(card).width), grid: Math.round(g.width) }); break; }
    }
  }
  for (const card of document.querySelectorAll('[data-gallery-leaf]')) {
    const frames = [...card.querySelectorAll('iframe')];
    const preview = frames.length || card.querySelector('[role="grid"], table') || card.querySelector('[data-preview-status]');
    if (!preview) out.push({ rule: 'leaf-preview', leaf: card.getAttribute('data-gallery-leaf') });
    for (const frame of frames) if (frame.getAttribute('loading') !== 'lazy' || !frame.hasAttribute('inert')) { out.push({ rule: 'leaf-preview', leaf: card.getAttribute('data-gallery-leaf'), frame: 'not lazy and view-only' }); break; }
  }
  if (main) {
    for (const card of main.querySelectorAll('[data-slot="card"] [data-slot="card"]')) out.push({ rule: 'card-in-card', text: card.textContent.trim().slice(0, 40) });
    for (const card of main.querySelectorAll('[data-slot="card"]')) if (visible(card) && card.scrollHeight > card.clientHeight + 2) out.push({ rule: 'card-clipped', text: card.textContent.trim().slice(0, 40), hidden: card.scrollHeight - card.clientHeight });
    const chips = [...main.querySelectorAll('a[href^="#"]')].filter(visible);
    if (chips.length) out.push({ rule: 'jump-chips', count: chips.length });
    const tabs = main.querySelectorAll('[role="tablist"]');
    if (tabs.length) out.push({ rule: 'tabs', count: tabs.length });
  }
  for (const image of document.querySelectorAll('img')) if (visible(image) && !(image.complete && image.naturalWidth > 0)) out.push({ rule: 'image', src: image.getAttribute('src') });
  // On a phone the closed sidebar sheet is not rendered; the anatomy is checked where the rail shows.
  const rail = document.querySelector('[data-slot="sidebar-header"]');
  const marks = [...document.querySelectorAll('[data-slot="sidebar-header"] img[data-brand-mark]')].filter(visible);
  if (rail && marks.length !== 1) out.push({ rule: 'image', src: 'brand mark', count: marks.length });
  for (const mark of marks) if (!(mark.complete && mark.naturalWidth > 0)) out.push({ rule: 'image', src: 'brand mark ' + mark.getAttribute('data-brand-mark') + ' did not load' });
  // shadcn sidebar-07 anatomy: team switcher in the header, the user menu in the footer.
  if (rail && document.querySelectorAll('[data-slot="sidebar-header"] [data-slot="sidebar-menu-button"][data-size="lg"]').length !== 1) out.push({ rule: 'sidebar-anatomy', part: 'team switcher' });
  if (rail && document.querySelectorAll('[data-slot="sidebar-footer"] [data-slot="sidebar-menu-button"][data-size="lg"] [data-slot="avatar"]').length !== 1) out.push({ rule: 'sidebar-anatomy', part: 'nav user' });
  return out;
})()`;

/** Leaf counts each page states: Home's per-agent badge, a gallery's header description. */
const COUNTS = `(() => {
  const home = [...document.querySelectorAll('[data-studio-section="home"] [data-slot="card-grid"] > [data-slot="card"]')].map(card => ({
    href: new URL(card.querySelector('a[href]')?.href ?? location.href).pathname,
    label: card.querySelector('[data-slot="card-action"]')?.textContent.trim() ?? '',
  }));
  const gallery = document.querySelector('[data-studio-section="agent-gallery"] [data-slot="card-header"] [data-slot="card-description"]')?.textContent.trim() ?? '';
  const roots = [...document.querySelectorAll('[data-studio-section="publications"] [id^="publication-"]')].map(card => card.textContent);
  return { home, gallery, roots };
})()`;

const DARK = `new Promise(resolve => { const root = document.documentElement; root.classList.add('dark'); root.dataset.theme = 'dark'; setTimeout(resolve, 1500); })`;

const resource = pathname => /^\/(?:api|__[a-z-]+|preview|_next)(?:\/|$)/.test(pathname) || /\.[a-z0-9]+$/i.test(pathname);

export async function runDomCheck(origin, { only } = {}) {
  origin = new URL(origin).origin;
  const { map, entries, expect } = await loadStudioMap(origin);
  const paths = new Set(entries.map(entry => entry.path));
  const findings = [], checked = [];
  const browser = await chrome();
  try {
    const targets = only?.length ? entries.filter(entry => only.includes(entry.path)) : entries;
    for (const entry of targets) {
      const add = (rule, extra = {}) => findings.push({ rule, path: entry.path, id: entry.id, ...extra });
      const response = await fetch(new URL(entry.path, origin), { redirect: 'manual' });
      if (response.status !== 200) add('http-status', { status: response.status });
      const errorsBefore = browser.errors.length;
      await browser.send('Page.navigate', { url: new URL(entry.path, origin).href });
      await sleep(300);
      const leaf = entry.id.includes(':');
      const settled = await browser.evaluate(SETTLED(leaf));
      const page = await browser.evaluate(PROBE);
      if (settled?.missing) add('not-found');
      else if (settled?.timedOut) add('render-timeout');
      if (!page.frame) add('no-frame');
      if (!page.headings) add('no-heading');
      if (/This page cannot load|This page has no frame|Something went wrong/i.test(page.text)) add('render-error', { text: page.text.match(/This page cannot load|This page has no frame|Something went wrong/i)[0] });
      if (/No specimen/i.test(page.text)) add('no-specimen');
      for (const href of page.links) {
        const url = new URL(href);
        if (url.origin !== origin || resource(url.pathname)) continue;
        if (!paths.has(url.pathname)) add('link-outside-map', { href: url.pathname + url.search });
      }
      const required = leaf ? expect(entry.id) : (entry.source?.sectionIds ?? []).map(slot => slot.replace(/^sections\.studio\./, ''));
      for (const section of required) if (!page.sections.includes(section)) add('missing-section', { section });
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await browser.evaluate(DARK);
        for (const { rule, ...extra } of await browser.evaluate(LAYOUT) ?? []) add(rule, { theme, ...extra });
      }
      const counts = await browser.evaluate(COUNTS);
      const leafCount = id => map.entries.filter(row => row.kind === 'page' && row.parentId === id && row.id.startsWith(`${id}:`)).length;
      const label = n => `${n} ${n === 1 ? 'leaf' : 'leaves'}`;
      for (const card of counts?.home ?? []) {
        const agent = entries.find(row => row.path === card.href);
        if (agent && card.label !== 'Unavailable' && card.label !== label(leafCount(agent.id))) add('leaf-count', { agent: agent.id, home: card.label, map: label(leafCount(agent.id)) });
      }
      if (counts?.gallery && !leaf && !counts.gallery.startsWith(label(leafCount(entry.id)))) add('leaf-count', { gallery: counts.gallery.slice(0, 30), map: label(leafCount(entry.id)) });
      for (const text of counts?.roots ?? []) if (/No root configured|Unavailable/.test(text)) add('publication-root', { text: text.slice(0, 60) });
      for (const error of browser.errors.slice(errorsBefore)) add('page-error', { message: error });
      checked.push({ path: entry.path, sections: page.sections, links: page.links.length });
    }
    // The command menu lists every map entry.
    const home = entries.find(entry => entry.path === '/');
    await browser.send('Page.navigate', { url: new URL('/', origin).href });
    await sleep(300);
    await browser.evaluate(SETTLED(false));
    await browser.evaluate(`new Promise(resolve => { const wait = () => { const ready = document.querySelector('[data-slot="skeleton"]'); if (!ready) return resolve(); setTimeout(wait, 150); }; wait(); })`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 4, windowsVirtualKeyCode: 75 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 4, windowsVirtualKeyCode: 75 });
    await sleep(800);
    const commands = await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] [data-slot="command-item"]')].map(element => (element.getAttribute('aria-label') || element.textContent || '').trim())`) ?? [];
    const wanted = new Map();
    for (const entry of entries) wanted.set(entry.title, (wanted.get(entry.title) ?? 0) + 1);
    const listed = new Map();
    for (const label of commands) listed.set(label, (listed.get(label) ?? 0) + 1);
    for (const [title, count] of wanted) if ((listed.get(title) ?? 0) < count) findings.push({ rule: 'command-missing', path: home?.path ?? '/', title, wanted: count, listed: listed.get(title) ?? 0 });
    return { check: 'studio:dom', status: findings.length ? 'FAIL' : 'PASS', origin, entries: entries.length, checked: checked.length, commands: commands.length, findings, pages: checked };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const origin = args[0];
  const outIndex = args.indexOf('--out');
  const out = outIndex > 0 ? args[outIndex + 1] : undefined;
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex > 0 ? args.slice(onlyIndex + 1) : undefined;
  if (!origin) { console.error('Usage: studio-dom-check.mjs <origin> [--out report.json] [--only <path>...]'); process.exit(2); }
  runDomCheck(origin, { only }).then(report => {
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    const rules = {};
    for (const finding of report.findings) rules[finding.rule] = (rules[finding.rule] ?? 0) + 1;
    console.log(JSON.stringify({ check: report.check, status: report.status, entries: report.entries, checked: report.checked, commands: report.commands, rules, sample: report.findings.slice(0, 30) }, null, 2));
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  }, error => { console.error(error); process.exitCode = error.env ? 2 : 1; });
}
