#!/usr/bin/env node
/**
 * check:rendered-provenance — R-DS-ONLY measured on what the owner sees, not on source text.
 *
 *   node studio/checks/check-rendered-provenance.mjs <origin> [--out report.json] [--workers N] [--only <path>...]
 *
 * For EVERY entry of the one Studio map (page records, tabs and leaves; `--only` narrows it for a
 * probe), against a running Studio at <origin>, in the rendered DOM after the page settles:
 *   - every element in <body> sits inside (or is) a root carrying the generated DOM provenance
 *     markers `data-clossys-slot` / `data-clossys-candidate` / `data-clossys-hash`; framework
 *     scaffolding (Next's runtime scripts, route announcer and empty boundaries) is the only
 *     exception, recognised by exact shape, never by class or id;
 *   - every marker names a registered Designer slot whose current pin is exactly that candidate
 *     file with exactly that content hash (a stale or hand-typed marker fails).
 * Exit 0 only when no route has a finding. Each run proves the detector on the first route: an
 * unmarked element appended to <body> and a marker whose hash is altered must both fail.
 *
 * Every route is checked; none is sampled or skipped. The routes are sharded across a bounded pool
 * of headless Chrome workers (`--workers N` or RENDERED_PROVENANCE_WORKERS, default and maximum
 * MAX_WORKERS = 3, the machine's heavy-gate cap). Each worker takes the next unchecked route from
 * one shared queue; the report lists routes in map order whatever worker checked them.
 *
 * Chrome is driven over the DevTools protocol with studio-dom-check's own launcher and map loader.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chrome, loadStudioMap } from './studio-dom-check.mjs';
import { pinned } from '../../scripts/check-generated-derived.mjs';
import { studioOrigin } from './studio-origin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLOSSYS = resolve(here, '../../../../clossys');
const sleep = ms => new Promise(done => setTimeout(done, ms));

/** At most this many Chrome workers at once: the heavy-gate cap of three concurrent heavy runs. */
export const MAX_WORKERS = 3;
/** The worst case for one route: the 300 ms navigation pause, the 20 s settle cap and its 400 ms tail, and slack. */
export const ROUTE_SECONDS = 25;

/** The worker count for a run: the requested count, clamped to 1..MAX_WORKERS and to the route count. */
export function workerCount(requested, routes) {
  const asked = Number.isInteger(Number(requested)) && Number(requested) > 0 ? Number(requested) : MAX_WORKERS;
  return Math.max(1, Math.min(asked, MAX_WORKERS, routes || 1));
}

/** Every Studio map entry the check visits (routes plus landing redirects): one trail per entry in the generated map. */
export function studioRouteCount(file = join(here, '../generated/studio-map.json')) {
  return Object.keys(JSON.parse(readFileSync(file, 'utf8')).trails ?? {}).length;
}

/** The wall-clock bound a runner gives this check: Chrome start plus the worst case per route, shared across the workers. */
export function timeoutSeconds(routes = studioRouteCount(), workers = MAX_WORKERS, startSeconds = 120) {
  return startSeconds + Math.ceil(routes / workerCount(workers, routes)) * ROUTE_SECONDS;
}

// Serialized into the page; keep it standalone.
function inspectProvenance() {
  const only = (element, names) => element.getAttributeNames().every(name => names.includes(name));
  const scaffolding = element => {
    if (element.parentElement !== document.body) return false;
    if (element.localName === 'script' && !element.childElementCount) {
      if (element.hasAttribute('src')) return only(element, ['src', 'async', 'nonce']) && new URL(element.src, location.href).origin === location.origin && /^\/_next\/static\/.+\.js$/.test(new URL(element.src, location.href).pathname);
      const text = element.textContent.trim();
      return only(element, ['id', 'nonce']) && (/^(?:\(self\.__next_f=self\.__next_f\|\|\[\]\)|self\.__next_f)\.push\(/.test(text) || (element.id === '_R_' && /^\(globalThis\["TURBOPACK"\]/.test(text)));
    }
    if (element.localName === 'next-route-announcer') return only(element, ['style']);
    if (element.localName === 'div' && element.hidden && only(element, ['hidden'])) return [...element.childNodes].every(node => node.nodeType === Node.COMMENT_NODE);
    return false;
  };
  const marked = element => element.hasAttribute('data-clossys-slot');
  const findings = [], markers = new Map();
  let checked = 0;
  // `inside`: under a marked root. `open`: the finding for the outermost unmarked ancestor, which
  // counts every unmarked element below it; a marked descendant starts a covered subtree again.
  const visit = (parent, inside, open) => {
    for (const element of parent.children) {
      if (!inside && !open && parent === document.body && scaffolding(element)) continue;
      checked++;
      const own = marked(element);
      if (own) {
        const key = [element.getAttribute('data-clossys-slot'), element.getAttribute('data-clossys-candidate'), element.getAttribute('data-clossys-hash')].join('|');
        markers.set(key, (markers.get(key) ?? 0) + 1);
      }
      const covered = inside || own;
      let finding = covered ? undefined : open;
      if (!covered && !open) {
        finding = { rule: 'element-without-provenance', tag: element.localName, slot: element.getAttribute('data-slot') ?? undefined, html: element.cloneNode(false).outerHTML.slice(0, 200), elements: 0 };
        findings.push(finding);
      }
      if (finding) finding.elements++;
      visit(element, covered, finding);
      if (element.shadowRoot) visit(element.shadowRoot, covered, finding);
    }
  };
  visit(document.body, false, undefined);
  return { checked, findings, markers: [...markers.entries()] };
}

/** The pin each rendered marker must equal: { slot, candidate, hash } from the slot's intact pin, or a finding. */
export function markerFindings(markers, clossys = CLOSSYS) {
  const findings = [];
  for (const [key, count] of markers) {
    const [slot, candidate, hash] = key.split('|');
    const entry = /^(?:components|sections|frames|assets|themes)\./.test(slot) ? pinned(clossys, 'designer', slot) : undefined;
    if (!entry) findings.push({ rule: 'marker-unregistered-slot', slot, count });
    else if (entry.candidate !== candidate || `sha256:${entry.sha256}` !== hash) findings.push({ rule: 'marker-not-current-pin', slot, rendered: `${candidate} ${hash}`, pinned: `${entry.candidate} sha256:${entry.sha256}`, count });
  }
  return findings;
}

const SETTLED = `new Promise(resolve => {
  const start = Date.now();
  (function poll() {
    const main = document.querySelector('#studio-main');
    const busy = !main || main.querySelector('[data-slot="skeleton"]');
    if (!busy || Date.now() - start > 20000) return setTimeout(() => resolve({ timedOut: Boolean(busy) }), 400);
    setTimeout(poll, 150);
  })();
})`;

/** Mutation proof on the live page: an unmarked body element and an altered marker hash must each fail. */
async function proveDetector(browser) {
  const inspect = `(${inspectProvenance.toString()})()`;
  await browser.evaluate(`(() => { const probe = document.createElement('div'); probe.id = 'rendered-provenance-probe'; document.body.append(probe); })()`);
  const unmarked = await browser.evaluate(inspect);
  await browser.evaluate(`document.getElementById('rendered-provenance-probe')?.remove()`);
  if (!unmarked?.findings.some(row => row.html?.includes('rendered-provenance-probe'))) throw new Error('detector proof: an unmarked element in the page body was not reported');
  const altered = await browser.evaluate(`(() => { const node = document.querySelector('[data-clossys-hash]'); if (!node) return null; const was = node.getAttribute('data-clossys-hash'); node.setAttribute('data-clossys-hash', 'sha256:' + '0'.repeat(64)); const out = (${inspectProvenance.toString()})(); node.setAttribute('data-clossys-hash', was); return out; })()`);
  if (altered && !markerFindings(new Map(altered.markers)).some(row => row.rendered?.endsWith('0'.repeat(64)))) throw new Error('detector proof: an altered provenance hash was not reported');
  return { unmarked: 'rejected', alteredHash: altered ? 'rejected' : 'no marker on page' };
}

export async function runRenderedProvenance(origin, { only, workers } = {}) {
  origin = new URL(origin).origin;
  const { map, targets } = await loadStudioMap(origin, { scope: all => only?.length ? all.filter(entry => only.includes(entry.path)) : all });
  const landings = JSON.parse(readFileSync(join(here, '../generated/studio-map.json'), 'utf8')).landings ?? {};
  const pool = workerCount(workers, targets.length);
  const rows = new Array(targets.length);
  let next = 0, proof, proving;
  // One worker: its own Chrome, taking the next unchecked route until the queue is empty.
  const work = async () => {
    const browser = await chrome();
    try {
      for (let index = next++; index < targets.length; index = next++) {
        const entry = targets[index];
        // A route the Studio does not answer is a finding of that route, never the end of the run:
        // every route is checked and the run exits on the full result.
        let response;
        try { response = await fetch(new URL(entry.path, origin), { redirect: 'manual', signal: AbortSignal.timeout(ROUTE_SECONDS * 1000) }); } catch (error) {
          rows[index] = { route: { path: entry.path, id: entry.id, checked: 0, markers: 0, findings: [{ rule: 'route-unreachable', error: String(error?.cause?.code ?? error?.name ?? error) }] } };
          continue;
        }
        // A landing redirect (the generated projection's `landings` names where an entry opens) renders nothing of its
        // own: its landing is an entry of the map and is checked there. Any other non-200 answer is a finding.
        const location = response.headers.get('location');
        const opens = location && new URL(location, origin).origin === origin ? new URL(location, origin).pathname : undefined;
        const landing = response.status >= 300 && response.status < 400 && ((opens && landings[entry.id] === opens && opens !== entry.path) || map.entries.some(row => row.parentId === entry.id && row.kind === 'page' && !row.id.includes(':')));
        if (landing) { rows[index] = { skipped: { path: entry.path, opens } }; continue; }
        let settled, result;
        try {
          await browser.send('Page.navigate', { url: new URL(entry.path, origin).href });
          await sleep(300);
          settled = await browser.evaluate(SETTLED);
          result = await browser.evaluate(`(${inspectProvenance.toString()})()`);
        } catch (error) {
          rows[index] = { route: { path: entry.path, id: entry.id, checked: 0, markers: 0, findings: [{ rule: 'route-error', error: String(error?.message ?? error).slice(0, 200) }] } };
          continue;
        }
        const findings = [...(result?.findings ?? []), ...markerFindings(new Map(result?.markers ?? []))];
        if (response.status !== 200) findings.unshift({ rule: 'http-status', status: response.status });
        if (settled?.timedOut) findings.unshift({ rule: 'render-timeout' });
        if (!result?.checked) findings.unshift({ rule: 'no-dom-checked' });
        // The detector proof runs once, on the first rendered route any worker reaches.
        if (!proving) { proving = true; proof = await proveDetector(browser); }
        rows[index] = { route: { path: entry.path, id: entry.id, checked: result?.checked ?? 0, markers: (result?.markers ?? []).length, findings } };
      }
    } finally { await browser.close(); }
  };
  await Promise.all(Array.from({ length: pool }, work));
  const unchecked = targets.filter((_, index) => !rows[index]);
  if (unchecked.length) throw new Error(`rendered provenance: ${unchecked.length} route(s) were never checked: ${unchecked.slice(0, 5).map(entry => entry.path).join(', ')}`);
  const rendered = rows.some(row => row.route && !row.route.findings.some(finding => finding.rule === 'route-unreachable' || finding.rule === 'route-error'));
  if (rendered && !proof) throw new Error('rendered provenance: the detector proof did not run');
  const routes = rows.filter(row => row.route).map(row => row.route), skipped = rows.filter(row => row.skipped).map(row => row.skipped);
  const red = routes.filter(route => route.findings.length);
  return { check: 'rendered provenance (R-DS-ONLY)', origin, workers: pool, entries: targets.length, routes: routes.length, landingRedirects: skipped.length, red: red.length, findings: red.reduce((n, route) => n + route.findings.length, 0), proof, results: routes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const origin = args.find(arg => /^https?:/.test(arg)) ?? studioOrigin();
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : process.env.STUDIO_CHECK_OUT && join(process.env.STUDIO_CHECK_OUT, 'rendered-provenance.json');
  const only = args.includes('--only') ? args.slice(args.indexOf('--only') + 1).filter(arg => arg.startsWith('/')) : undefined;
  const workers = args.includes('--workers') ? args[args.indexOf('--workers') + 1] : process.env.RENDERED_PROVENANCE_WORKERS;
  runRenderedProvenance(origin, { only, workers }).then(report => {
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    const rules = {};
    for (const route of report.results) for (const row of route.findings) rules[row.rule] = (rules[row.rule] ?? 0) + 1;
    console.log(JSON.stringify({ check: report.check, workers: report.workers, entries: report.entries, routes: report.routes, landingRedirects: report.landingRedirects, red: report.red, findings: report.findings, rules, proof: report.proof }));
    for (const route of report.results.filter(row => row.findings.length).slice(0, 200)) console.log(`${route.path}: ${route.findings.length} finding(s); first ${JSON.stringify(route.findings[0])}`);
    process.exitCode = report.red ? 1 : 0;
  }, error => { console.error(error.stack ?? error.message); process.exitCode = 2; });
}
