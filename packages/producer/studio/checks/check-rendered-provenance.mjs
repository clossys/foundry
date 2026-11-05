#!/usr/bin/env node
/**
 * check:rendered-provenance — R-DS-ONLY measured on what the owner sees, not on source text.
 *
 *   node studio/checks/check-rendered-provenance.mjs <origin> [--out report.json] [--only <path>...]
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
 * Chrome is driven over the DevTools protocol with studio-dom-check's own launcher and map loader.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chrome, loadStudioMap } from './studio-dom-check.mjs';
import { pinned } from '../../scripts/check-generated-derived.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLOSSYS = resolve(here, '../../../../clossys');
const sleep = ms => new Promise(done => setTimeout(done, ms));

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

export async function runRenderedProvenance(origin, { only } = {}) {
  origin = new URL(origin).origin;
  const { map, targets } = await loadStudioMap(origin, { scope: all => only?.length ? all.filter(entry => only.includes(entry.path)) : all });
  const browser = await chrome();
  const routes = [], skipped = [];
  const landings = JSON.parse(readFileSync(join(here, '../generated/studio-map.json'), 'utf8')).landings ?? {};
  let proof;
  try {
    for (const entry of targets) {
      const response = await fetch(new URL(entry.path, origin), { redirect: 'manual' });
      // A landing redirect (the generated projection's `landings` names where an entry opens) renders nothing of its
      // own: its landing is an entry of the map and is checked there. Any other non-200 answer is a finding.
      const location = response.headers.get('location');
      const opens = location && new URL(location, origin).origin === origin ? new URL(location, origin).pathname : undefined;
      const landing = response.status >= 300 && response.status < 400 && ((opens && landings[entry.id] === opens && opens !== entry.path) || map.entries.some(row => row.parentId === entry.id && row.kind === 'page' && !row.id.includes(':')));
      if (landing) { skipped.push({ path: entry.path, opens }); continue; }
      await browser.send('Page.navigate', { url: new URL(entry.path, origin).href });
      await sleep(300);
      const settled = await browser.evaluate(SETTLED);
      const result = await browser.evaluate(`(${inspectProvenance.toString()})()`);
      const findings = [...(result?.findings ?? []), ...markerFindings(new Map(result?.markers ?? []))];
      if (response.status !== 200) findings.unshift({ rule: 'http-status', status: response.status });
      if (settled?.timedOut) findings.unshift({ rule: 'render-timeout' });
      if (!result?.checked) findings.unshift({ rule: 'no-dom-checked' });
      proof ??= await proveDetector(browser);
      routes.push({ path: entry.path, id: entry.id, checked: result?.checked ?? 0, markers: (result?.markers ?? []).length, findings });
    }
  } finally { await browser.close(); }
  const red = routes.filter(route => route.findings.length);
  return { check: 'rendered provenance (R-DS-ONLY)', origin, routes: routes.length, landingRedirects: skipped.length, red: red.length, findings: red.reduce((n, route) => n + route.findings.length, 0), proof, results: routes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const origin = args.find(arg => /^https?:/.test(arg)) ?? process.env.STUDIO_ORIGIN ?? 'http://127.0.0.1:4617';
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : process.env.STUDIO_CHECK_OUT && join(process.env.STUDIO_CHECK_OUT, 'rendered-provenance.json');
  const only = args.includes('--only') ? args.slice(args.indexOf('--only') + 1).filter(arg => arg.startsWith('/')) : undefined;
  runRenderedProvenance(origin, { only }).then(report => {
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    const rules = {};
    for (const route of report.results) for (const row of route.findings) rules[row.rule] = (rules[row.rule] ?? 0) + 1;
    console.log(JSON.stringify({ check: report.check, routes: report.routes, landingRedirects: report.landingRedirects, red: report.red, findings: report.findings, rules, proof: report.proof }));
    for (const route of report.results.filter(row => row.findings.length).slice(0, 200)) console.log(`${route.path}: ${route.findings.length} finding(s); first ${JSON.stringify(route.findings[0])}`);
    process.exitCode = report.red ? 1 : 0;
  }, error => { console.error(error.stack ?? error.message); process.exitCode = 2; });
}
