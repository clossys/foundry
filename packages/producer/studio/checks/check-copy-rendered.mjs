#!/usr/bin/env node
/**
 * check-copy-rendered (live): every string a person sees on every installed Studio route resolves
 * from a registry entry. One built Studio, one run: the check opens every route Publisher installed
 * (each page of studio/generated/studio-map.json and each leaf a tab serves), waits for the page to
 * settle, and reads what the browser rendered:
 *
 *   text   every text node in <body> and the document <title>;
 *   attr   every aria-label, aria-description, aria-roledescription, aria-placeholder,
 *          aria-valuetext, title, placeholder and alt attribute, and <meta name="description">;
 *   lang   <html lang>, which must be the Writer's source locale.
 *
 * A rendered string passes only when it is
 *   copy   the text of a record in a pinned Writer candidate (an ICU template matches with its
 *          arguments filled), or
 *   data   a value of a pinned Director or Designer candidate the page shows as a specimen
 *          (a cell's text, a token value; never an element's source files), or a registry id
 *          (a slot id, an IA id, a candidate file name), or
 *   none   no letter at all (numbers, punctuation, glyphs).
 * A string of such parts joined by ` · ` (a trail, a version line) passes when every part does.
 * Text of a Writer candidate that is not the pin (an option, a preview) is data only on that
 * slot's own route and the gallery routes above it.
 * Publisher records are never a source of rendered text: a page title comes from a Writer key.
 * Anything else is a literal the Studio rendered without a registry entry, and fails.
 *
 * Usage: node studio/checks/check-copy-rendered.mjs [origin] [--root DIR] [--pages DIR] [--routes N] [--json FILE]
 *   origin   the running Studio (default $STUDIO_ORIGIN or http://127.0.0.1:4503, studio-origin.mjs)
 *   --root   the repository whose clossys/ the Studio serves (default this repository)
 *   --pages  read each route's rendered page from DIR/<route>/index.html instead of an origin (a fixture)
 *   --routes only the first N routes (a probe; the gate itself always runs every route)
 * Exit 0 when every rendered string resolves, 1 on any finding, 2 when no browser or Studio is reachable.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { studioOrigin } from './studio-origin.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ATTRIBUTES = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-placeholder', 'aria-valuetext', 'title', 'placeholder', 'alt'];

const argv = process.argv.slice(2);
const flag = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
const positional = argv.filter((arg, index) => !arg.startsWith('--') && !argv[index - 1]?.startsWith('--'));

/** Pinned candidates of one agent whose bytes match their pin: { slot, name, bytes }. */
export function pinnedCandidates(repo, agent) {
  const root = join(repo, 'clossys/agents', agent);
  if (!existsSync(root)) return [];
  const out = [];
  for (const slot of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const pinFile = join(root, slot, 'pin.json');
    if (!existsSync(pinFile)) continue;
    const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
    if (typeof pin?.candidate !== 'string') continue;
    const file = join(root, slot, 'candidates', pin.candidate);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) continue;
    out.push({ slot, name: pin.candidate, bytes: bytes.toString('utf8') });
  }
  return out;
}

const normal = text => text.replace(/\s+/g, ' ').trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** A recorded content hash as the history section shows it: its first 8 characters (`shortHash`). */
export const shortHash = hash => hash.replace(/^sha256:/, '').slice(0, 8);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The literal runs of an ICU message: its text outside every argument. */
/**
 * An ICU message parsed into parts: literal text, a simple argument (`{name}`, `{n, number}`), or a
 * branching argument (`{n, plural|select|selectordinal, key {message} ...}`) whose branches are
 * messages themselves; `#` inside a plural branch is the number.
 */
function icuParts(text, plural = false) {
  const parts = [];
  let i = 0, literal = '';
  const flush = () => { if (literal) parts.push({ literal }); literal = ''; };
  while (i < text.length) {
    const char = text[i];
    if (char === '#' && plural) { flush(); parts.push({ number: true }); i++; continue; }
    if (char !== '{') { literal += char; i++; continue; }
    flush();
    let depth = 0, j = i;
    for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break; }
    const body = text.slice(i + 1, j);
    i = j + 1;
    const head = /^\s*[\w.-]+\s*,\s*(plural|select|selectordinal)\s*,/.exec(body);
    if (!head) { parts.push({ argument: true }); continue; }
    const branches = [];
    let rest = body.slice(head[0].length);
    for (;;) {
      const key = /^\s*(?:offset:\d+\s*)?(=?[\w-]+)\s*\{/.exec(rest);
      if (!key) break;
      let d = 0, k = key[0].length - 1;
      for (; k < rest.length; k++) { if (rest[k] === '{') d++; else if (rest[k] === '}' && --d === 0) break; }
      branches.push(icuParts(rest.slice(key[0].length, k), head[1] !== 'select'));
      rest = rest.slice(k + 1);
    }
    parts.push({ branches });
  }
  flush();
  return parts;
}

/** Every literal letter an ICU message holds, branch text included (what its rendered text must show). */
export function literalRuns(text) {
  const runs = parts => parts.map(part => part.literal ?? (part.branches ? part.branches.map(runs).join(' ') : '')).join('');
  return runs(icuParts(text));
}

/** An ICU message as a matcher: literal text exact, a simple argument any text, a branch any one of its messages, `#` a number. */
export function templateMatcher(text) {
  const source = parts => parts.map(part => part.literal !== undefined ? escape(part.literal)
    : part.number ? '[\\d][\\d,.]*'
      : part.branches ? `(?:${part.branches.map(source).join('|')})` : '[\\s\\S]+?').join('');
  return new RegExp(`^${source(icuParts(text)).replace(/(?:\\ |\s)+/g, '\\s*')}$`);
}

/**
 * The words of one Writer record: its text, or, for a structured record (a voice rule, a pattern
 * part), every string field but its id and context, which are its key.
 */
export function recordWords(record, add) {
  if (!record || typeof record !== 'object') return;
  if (typeof record.text === 'string') { add(record.text); return; }
  const walk = (value, key) => {
    if (typeof value === 'string') { if (key !== 'id' && key !== 'context') add(value); return; }
    if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) walk(item, Array.isArray(value) ? key : name);
  };
  walk(record);
}

/** The registry universe a rendered string may come from. */
export async function registryUniverse(repo) {
  const { parseWriterSlotBody } = await import('@clossys/writer/slot-body');
  const copy = new Set(), templates = [], data = new Set(), ids = new Set();
  // slot id -> the words of its Writer candidates that are not the pin (data on that slot's routes only).
  const options = new Map();
  const addCopy = text => {
    const value = normal(text);
    if (!value) return;
    // A template matches with its arguments filled; one whose literal runs hold no letter (`{value}`,
    // `{a}: {b}`) proves nothing about the text around its arguments, so it is not a matcher.
    if (/\{[^}]*\}/.test(value) && /\p{L}/u.test(literalRuns(value))) templates.push({ text: value, matcher: templateMatcher(value) });
    copy.add(value);
  };
  for (const { slot, name, bytes } of pinnedCandidates(repo, 'writer')) {
    ids.add(slot); ids.add(name);
    if (!name.endsWith('.md')) continue;
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(bytes);
    if (!match) continue;
    const locales = JSON.parse(/^locales: (.+)$/m.exec(match[1])?.[1] ?? '["en"]');
    for (const row of parseWriterSlotBody(match[2], locales)) recordWords(row.record, addCopy);
  }
  // Record data: what a slot page shows of a record as the record itself (a contract fact, a
  // record key, a candidate field, a pin event), never as words about it.
  const strings = (value, skip) => {
    if (typeof value === 'string') { const text = normal(value); if (text) data.add(text); return; }
    if (value === null || typeof value !== 'object') return;
    data.add(normal(JSON.stringify(value)));
    if (Array.isArray(value)) { value.forEach(item => strings(item, skip)); return; }
    for (const [key, item] of Object.entries(value)) {
      if (skip.has(key)) continue;
      data.add(key);
      if (item !== null && typeof item !== 'object' && typeof item !== 'string') data.add(String(item));
      strings(item, skip);
    }
  };
  const { pinHistory } = await import('../../dist/records/slots.js');
  const consumer = join(repo, 'clossys');
  for (const agent of readdirSync(join(consumer, 'agents'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
    const root = join(consumer, 'agents', agent);
    // A Publisher record never supplies rendered words: its title and tree names are Writer keys.
    const skip = agent === 'publisher' ? new Set(['files', 'title', 'name']) : new Set(['files']);
    for (const slot of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
      const slotFile = join(root, slot, 'slot.json');
      if (!existsSync(slotFile)) continue;
      ids.add(slot);
      try { strings(JSON.parse(readFileSync(slotFile, 'utf8')), new Set()); } catch { /* an unreadable slot record shows nothing */ }
      const dir = join(root, slot, 'candidates');
      for (const name of existsSync(dir) ? readdirSync(dir) : []) {
        ids.add(name); ids.add(name.replace(/\.[a-z]+$/, ''));
        const bytes = readFileSync(join(dir, name), 'utf8');
        // A candidate's content hash is its identity (the options and history rows show it, full or short).
        const hash = sha256(readFileSync(join(dir, name)));
        data.add(hash); data.add(shortHash(hash));
        if (name.endsWith('.json')) { try { strings(JSON.parse(bytes), skip); } catch { /* not JSON data */ } continue; }
        const front = /^---\n([\s\S]*?)\n---\n/.exec(bytes)?.[1];
        // Markdown: its frontmatter fields (a Writer source line) are data; its body is data only for Director and Designer.
        for (const line of front?.split('\n') ?? []) { const value = line.replace(/^[\w-]+:\s*/, ''); try { strings(JSON.parse(value), skip); } catch { strings(value, skip); } }
        if (agent === 'director' || agent === 'designer') for (const line of bytes.split('\n')) {
          // A record line is data as written (a `- ` bullet included) and as its text.
          for (const text of [normal(line.replace(/^[#>*\-\s]+/, '')), normal(line)]) if (text) data.add(text);
        }
        if (agent === 'writer' && name.endsWith('.md') && front !== undefined) {
          const locales = JSON.parse(/^locales: (.+)$/m.exec(front)?.[1] ?? '["en"]');
          const body = bytes.slice(bytes.indexOf('\n---\n') + 5);
          const words = options.get(slot) ?? new Set();
          let locale = '';
          for (const line of body.split('\n')) {
            if (line.startsWith('## ')) locale = line.slice(3).trim();
            // A Writer record's key (`<locale>/<context>`) is shown as the record's key: data.
            else if (line.startsWith('### ')) { const key = line.slice(4).trim(); ids.add(key); ids.add(`${locale}/${key}`); }
          }
          try { for (const row of parseWriterSlotBody(body, locales)) recordWords(row.record, text => { const value = normal(text); if (value) words.add(value); }); }
          catch { /* a malformed candidate shows its issues, not its words */ }
          options.set(slot, words);
        }
      }
      // Pin history is the slot's record even after an unpin: every event a history row can show.
      let history = [];
      try { history = pinHistory(consumer, agent, slot); } catch { /* no readable history */ }
      for (const event of history) {
        for (const value of [event.candidate, event.commit, event.sha256, event.decidedBy, event.at, event.basis]) if (typeof value === 'string' && value) data.add(normal(value));
        if (typeof event.sha256 === 'string') data.add(shortHash(event.sha256));
      }
    }
  }
  for (const agent of ['director', 'designer', 'writer', 'publisher', 'producer']) {
    const file = join(repo, 'clossys/agents', agent, 'ia.json');
    if (!existsSync(file)) continue;
    const ia = JSON.parse(readFileSync(file, 'utf8'));
    for (const node of ia.nodes ?? []) { ids.add(node.id); for (const child of node.children ?? []) { ids.add(child.id); for (const slot of child.slots ?? []) ids.add(slot); } }
    for (const layer of ia.layers ?? []) ids.add(layer.id);
  }
  const locale = JSON.parse(/^locales: (.+)$/m.exec(pinnedCandidates(repo, 'writer').find(row => row.name.endsWith('.md'))?.bytes ?? '')?.[1] ?? '["en"]')[0];
  // Each slot's leaf route and the gallery routes above it: where its options may show.
  const scope = new Map();
  const mapFile = join(repo, 'packages/producer/studio/generated/studio-map.json');
  if (existsSync(mapFile)) for (const leaf of JSON.parse(readFileSync(mapFile, 'utf8')).leaves ?? []) {
    const slot = leaf.path.split('/').at(-1);
    const words = options.get(slot);
    if (!words) continue;
    const parts = leaf.path.split('/');
    for (let end = 2; end <= parts.length; end++) {
      const route = parts.slice(0, end).join('/');
      if (!scope.has(route)) scope.set(route, []);
      scope.get(route).push(words);
    }
  }
  return { copy, templates, data, ids, locale, scope };
}

/** Where a rendered string comes from on `route`, or undefined when it has no registry entry. */
export function provenance(universe, raw, route) {
  const text = normal(raw);
  if (!/\p{L}/u.test(text)) return 'none';
  if (universe.copy.has(text)) return 'copy';
  if (universe.templates.some(row => row.matcher.test(text))) return 'copy';
  if (universe.data.has(text)) return 'data';
  if (universe.ids.has(text) || /^v[1-9][0-9]*$/.test(text)) return 'data';
  if (route !== undefined && universe.scope?.get(route)?.some(words => words.has(text))) return 'data';
  // Registry parts joined by a glyph that holds no letter: every part must resolve on its own.
  if (text.includes(' · ')) {
    const parts = text.split(' · ').map(part => part.trim()).filter(Boolean);
    const sources = parts.map(part => provenance(universe, part, route));
    if (parts.length > 1 && sources.every(Boolean)) return sources.includes('copy') ? 'copy' : 'data';
  }
  return undefined;
}

// Serialized into the browser: keep it standalone.
function collectRendered(attributes) {
  const out = [];
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (node.parentElement && skip.has(node.parentElement.tagName)) continue;
    if (node.parentElement?.closest('next-route-announcer')) continue;
    if (/\S/.test(node.nodeValue ?? '')) out.push({ kind: 'text', text: node.nodeValue, where: node.parentElement?.tagName.toLowerCase() ?? '' });
  }
  for (const element of document.querySelectorAll(attributes.map(name => `[${name}]`).join(','))) {
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (value && /\S/.test(value)) out.push({ kind: 'attr', text: value, where: `${element.tagName.toLowerCase()}[${name}]` });
    }
  }
  if (document.title) out.push({ kind: 'text', text: document.title, where: 'title' });
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content');
  if (description) out.push({ kind: 'attr', text: description, where: 'meta[description]' });
  return { lang: document.documentElement.getAttribute('lang'), strings: out };
}

/** Every route Publisher installed: each page path, then each leaf path a tab serves. */
export function installedRoutes(repo) {
  const map = JSON.parse(readFileSync(join(repo, 'packages/producer/studio/generated/studio-map.json'), 'utf8'));
  const paths = [...map.routes.map(route => route.path), ...map.leaves.map(leaf => leaf.path)];
  return [...new Set(paths)];
}

async function main() {
  const repo = resolve(flag('--root') ?? join(here, '../../../..'));
  const pages = flag('--pages') ? resolve(flag('--pages')) : undefined;
  const origin = pages ? pathToFileURL(pages).href : new URL(positional[0] ?? studioOrigin()).origin;
  const address = route => pages ? pathToFileURL(join(pages, route, 'index.html')).href : origin + route;
  const limit = flag('--routes') ? Number(flag('--routes')) : undefined;
  const universe = await registryUniverse(repo);
  const routes = installedRoutes(repo).slice(0, limit);
  const { launchChrome, failureExitCode } = require('./chrome-launch.cjs');
  let browser;
  try { browser = await launchChrome({ headless: true, args: ['--no-sandbox'] }); }
  catch (error) { console.error(String(error?.message ?? error)); process.exit(failureExitCode(error)); }
  const findings = new Map(), counts = { copy: 0, data: 0, none: 0 }, failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route(`${origin}/api/events`, route => route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }));
    // The check reads the route's own document only (collectRendered never enters a frame, and a specimen frame is
    // an opaque sandbox): a child frame's document is answered empty, so it loads without a server render per frame.
    if (!pages) await context.route(() => true, route => {
      const request = route.request();
      return request.isNavigationRequest() && request.frame().parentFrame() ? route.fulfill({ contentType: 'text/html', body: '' }) : route.fallback();
    });
    const queue = [...routes];
    const worker = async () => {
      const page = await context.newPage();
      for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
        let response;
        // A route that does not load within a minute gets one more, longer try; a second miss is a failure.
        try { response = await page.goto(address(route), { waitUntil: 'load', timeout: 60_000 }); }
        catch {
          try { response = await page.goto(address(route), { waitUntil: 'load', timeout: 120_000 }); }
          catch (error) { failures.push({ route, reason: String(error?.message ?? error).split('\n')[0] }); continue; }
        }
        // A file page has no HTTP status; a served one must answer 200.
        if (!pages && (!response || response.status() !== 200)) { failures.push({ route, reason: `HTTP ${response?.status()}` }); continue; }
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 }).catch(() => failures.push({ route, reason: 'no h1 rendered' }));
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
        const rendered = await page.evaluate(collectRendered, ATTRIBUTES);
        if (rendered.lang !== universe.locale) {
          const key = `lang ${rendered.lang}`;
          if (!findings.has(key)) findings.set(key, { kind: 'lang', text: String(rendered.lang), where: 'html[lang]', routes: [] });
          findings.get(key).routes.push(route);
        }
        for (const row of rendered.strings) {
          const source = provenance(universe, row.text, route);
          if (source) { counts[source]++; continue; }
          const key = `${row.kind} ${normal(row.text)}`;
          if (!findings.has(key)) findings.set(key, { kind: row.kind, text: normal(row.text), where: row.where, routes: [] });
          findings.get(key).routes.push(route);
        }
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: 3 }, worker));
  } finally {
    await browser.close();
  }
  const rows = [...findings.values()].sort((a, b) => b.routes.length - a.routes.length || a.text.localeCompare(b.text));
  const report = { check: 'Studio copy rendered', origin, routes: routes.length, resolved: counts, unresolved: rows.length, failures, findings: rows.map(row => ({ ...row, count: row.routes.length, routes: row.routes.slice(0, 3) })) };
  if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(report, null, 2) + '\n');
  for (const failure of failures) console.log(`route   ${failure.route}: ${failure.reason}`);
  for (const row of argv.includes('--all') ? rows : rows.slice(0, 40)) console.log(`${row.kind.padEnd(7)} "${row.text.slice(0, 80)}" (${row.where}) on ${row.routes.length} route(s), first ${row.routes[0]}`);
  if (!argv.includes('--all') && rows.length > 40) console.log(`        ... ${rows.length - 40} more`);
  console.log(`check-copy-rendered: ${routes.length} routes, ${counts.copy} copy, ${counts.data} data, ${counts.none} non-text; ${rows.length} unresolved string(s), ${failures.length} route failure(s)`);
  process.exit(rows.length || failures.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
