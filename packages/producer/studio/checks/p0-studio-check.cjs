#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { ROUTE_MARKER, readStudioPublication } = require('./check-studio-routes.cjs');
const fs = require('node:fs');
const { launchChrome } = require('./chrome-launch.cjs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { studioOrigin, specimensReady } = require('./studio-origin.mjs');
const routeScope = require('./route-scope.cjs');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '../../..');
// Evidence goes to the ignored cache, never the checkout: a run that leaves files in the tree dirties every later step's record.
const DEFAULT_SCREENSHOTS = path.join(repositoryRoot, 'node_modules/.cache/clossys/studio-check/p0');
const variants = Object.freeze([
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
]);
const REPORT_EXIT_CODES = Object.freeze({ PASS: 0, FAIL: 1, ENV: 2 });
const GATES_FILE = path.join(__dirname, 'studio-check-gates.json');
// Only wording/visual rules may report (Producer skill, "Only wiring blocks"); every other rule is wiring and blocks.
const REPORTABLE_RULES = Object.freeze(['raw-cell-id', 'aborted-reload']);
/** Read and validate the gate config. A missing or invalid gate fails setup in every mode. */
function readGates(file = GATES_FILE) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(config.schema, 'clossys.studio-check-gates/1', `${file}: schema must be clossys.studio-check-gates/1`);
  assert.ok(Array.isArray(config.gates), `${file}: gates must be a list`);
  const gates = {};
  for (const gate of config.gates) {
    assert.ok(REPORTABLE_RULES.includes(gate?.rule), `${file}: ${gate?.rule} is wiring or unknown; only ${REPORTABLE_RULES.join(', ')} have a gate mode`);
    assert.ok(!gates[gate.rule], `${file}: ${gate.rule} is listed twice`);
    assert.ok(['block', 'report'].includes(gate.mode), `${file}: ${gate.rule} mode must be block or report`);
    assert.ok(typeof gate.reason === 'string' && gate.reason.trim(), `${file}: ${gate.rule} needs a reason`);
    gates[gate.rule] = { mode: gate.mode, owner: gate.owner, reason: gate.reason };
  }
  return gates;
}
/** Split findings by gate mode: report-mode rules are listed, never failed. */
function applyGates(findings, gates = {}) {
  const blocking = [], reports = [];
  for (const finding of findings) (gates[finding.rule]?.mode === 'report' ? reports : blocking).push(finding);
  return { findings: blocking, reports };
}
const ABORTED = /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED)$/;
function frameDetached(request) { try { return Boolean(request.frame()?.isDetached()); } catch { return false; } }
/**
 * Every request a page makes, in order. An aborted request is a reload only when a later request
 * for the same URL on this page finished OK; a request left pending in a detached frame (the frame
 * was moved before Playwright saw it finish) is a reload on the same condition.
 */
function requestLedger({ tracked = () => true } = {}) {
  const entries = [], byRequest = new Map();
  const retried = entry => entries.some(later => later.seq > entry.seq && later.url === entry.url && later.state === 'ok');
  const superseded = entry => entry.state === 'pending' && frameDetached(entry.request) && retried(entry);
  return {
    entries,
    request(request) { const entry = { request, url: request.url(), seq: entries.length + 1, state: 'pending', tracked: tracked(request) }; entries.push(entry); byRequest.set(request, entry); },
    response(response) { const entry = byRequest.get(response.request()); if (entry) entry.status = response.status(); },
    finished(request) { const entry = byRequest.get(request); if (entry) entry.state = (entry.status ?? 200) < 400 ? 'ok' : 'error'; },
    failed(request) { const entry = byRequest.get(request); if (entry) { entry.state = 'failed'; entry.error = request.failure()?.errorText; } },
    /** Tracked requests the page is still waiting on; superseded orphans are not waited on. */
    waiting() { return entries.filter(entry => entry.tracked && entry.state === 'pending' && !superseded(entry)); },
    findings() {
      const findings = [], reloads = [];
      for (const entry of entries) {
        if (entry.state === 'failed') {
          if (ABORTED.test(entry.error ?? '') && retried(entry)) reloads.push({ url: entry.url, kind: 'aborted' });
          else findings.push({ rule: 'request-failed', url: entry.url, message: entry.error });
        } else if (superseded(entry)) reloads.push({ url: entry.url, kind: 'orphaned' });
      }
      if (reloads.length) findings.push({ rule: 'aborted-reload', count: reloads.length, aborted: reloads.filter(reload => reload.kind === 'aborted').length, orphaned: reloads.filter(reload => reload.kind === 'orphaned').length, urls: [...new Set(reloads.map(reload => reload.url))] });
      return findings;
    },
  };
}
function failureReport(error, extra = {}) {
  return error?.report ?? { check: 'studio:check', status: 'FAIL', phase: 'setup', executed: false, checks: [], diagnostics: [{ rule: 'check-setup', message: error instanceof Error ? error.message : String(error) }], ...extra };
}
function reportError(report, cause) {
  const error = new Error(report.diagnostics?.[0]?.message ?? 'studio:check failed', cause ? { cause } : undefined);
  error.report = report;
  error.exitCode = REPORT_EXIT_CODES[report.status] ?? 1;
  return error;
}
/** Select one installed, Playwright-supported runtime. Never retry a failed launch. */
function browserRuntime(options = {}) {
  const playwright = options.playwright ?? require('playwright');
  const name = options.browserName ?? process.env.STUDIO_BROWSER ?? 'chromium';
  assert.ok(['chromium', 'firefox', 'webkit'].includes(name), 'STUDIO_BROWSER must be chromium, firefox, or webkit');
  const type = playwright[name];
  const launch = { headless: true, timeout: options.browserTimeout ?? 10000 };
  const selectedPath = options.executablePath ?? process.env.STUDIO_BROWSER_PATH ?? (name === 'chromium' ? process.env.CHROMIUM_PATH : undefined);
  if (selectedPath) launch.executablePath = selectedPath;
  else if (!fs.existsSync(type.executablePath()) && name === 'chromium' && fs.existsSync('/usr/bin/chromium')) launch.executablePath = '/usr/bin/chromium';
  if (name === 'chromium') launch.args = ['--no-sandbox'];
  return { type, name, launch };
}
async function launchStudioBrowser(options = {}) {
  let runtime;
  try {
    runtime = browserRuntime(options);
    // Chromium is always the machine's Chrome through the shared helper, never a downloaded browser.
    if (runtime.name === 'chromium') return await launchChrome(runtime.launch, { playwright: options.playwright, env: options.env });
    return await runtime.type.launch(runtime.launch);
  } catch (cause) {
    const blocked = cause?.code === 'BLOCKED_NO_BROWSER';
    const first = blocked ? cause.errors[0] ?? cause : cause;
    const diagnostics = [{ rule: 'browser-unavailable', message: first instanceof Error ? first.message : String(first) }];
    if (blocked) diagnostics.push({ rule: 'blocked-no-browser', message: cause.message });
    throw reportError({ check: 'studio:check', status: 'ENV', phase: 'browser-launch', executed: false, browser: runtime?.name ?? options.browserName ?? process.env.STUDIO_BROWSER ?? 'chromium', checks: [], diagnostics }, cause);
  }
}
/** One bounded launch/navigation probe; callers may reuse its browser for the entire suite. */
async function probeBrowser(options = {}) {
  const browser = await launchStudioBrowser(options);
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('data:text/html,<title>Studio browser probe</title><h1>Ready</h1>', { timeout: options.browserTimeout ?? 10000 });
      assert.equal(await page.title(), 'Studio browser probe');
    } finally { await context.close(); }
    return { browser, report: { check: 'studio:browser-probe', status: 'PASS', executed: true, browserVersion: browser.version() } };
  } catch (cause) {
    await browser.close();
    throw reportError({ check: 'studio:browser-probe', status: 'ENV', phase: 'browser-probe', executed: false, checks: [], diagnostics: [{ rule: 'browser-unavailable', message: cause instanceof Error ? cause.message : String(cause) }] }, cause);
  }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function appPages(root) {
  const result = [];
  function visit(directory, segments) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink(), 'Route discovery does not follow symlinks');
      if (item.isDirectory()) visit(path.join(directory, item.name), [...segments, item.name]);
      else if (/^page\.[jt]sx?$/.test(item.name)) result.push({ template: '/' + segments.filter(segment => !/^\(.*\)$/.test(segment)).join('/'), file: path.join(directory, item.name) });
    }
  }
  visit(root, []);
  assert.ok(result.length, 'No App Router pages discovered');
  return result;
}
function canonical(paths, label) {
  assert.ok(paths.length, `${label} has no routes`);
  for (const value of paths) assert.ok(typeof value === 'string' && value.startsWith('/') && !/[?#\\]/.test(value), `${label} contains an invalid path`);
  assert.equal(new Set(paths).size, paths.length, `${label} contains duplicate routes`);
  return [...paths].sort();
}
/**
 * The generated Studio projection must agree with the pinned publication's route pack and content
 * map (`options.publication`, else read from the pins); a newly introduced dynamic route needs an
 * explicit expander.
 */
async function discoverRoutePlan(options = {}) {
  const root = options.studioRoot ?? studioRoot;
  const repository = options.repositoryRoot ?? repositoryRoot;
  const projection = readJson(path.join(root, 'generated/studio-map.json'));
  const { routePack: pack, map: content } = options.publication ?? await readStudioPublication(repository);
  const routes = canonical(projection.routes.map(row => row.path), 'Studio projection');
  assert.deepEqual(routes, canonical(pack.routes.map(row => row.path), 'Publisher route pack'), 'Studio route projection and route pack differ');
  assert.deepEqual(routes, canonical(content.entries.filter(row => row.kind === 'page').map(row => row.path), 'Publisher content map'), 'Studio route projection and content map differ');
  const pages = appPages(path.join(root, 'app'));
  const templates = pages.map(page => page.template);
  const represented = new Set();
  const leafTemplates = [];
  for (const page of pages) {
    const source = fs.readFileSync(page.file, 'utf8');
    const leafOf = /^(.*)\/\[slug\]$/.exec(page.template);
    if (leafOf && source.split('\n', 1)[0] === ROUTE_MARKER && routes.includes(leafOf[1] || '/')) {
      // A Publisher-installed leaf template; its leaves are the record store's, served live.
      leafTemplates.push(page.template);
    } else if (page.template.includes('[') || page.template.includes('@')) {
      throw new Error(`Unexpanded App Router route: ${page.template}`);
    } else represented.add(page.template);
  }
  for (const route of routes) assert.ok(represented.has(route), `Published route has no App Router page: ${route}`);
  // Each agent is a content-map group whose tab pages expand from its `page.<agent>-<ns>` records: the
  // Publisher projection lists them (`agents`, the Home cards) wherever a system group nests them;
  // without that list, the top-level groups.
  const agents = (Array.isArray(projection.agents) ? projection.agents.map(row => row.id) : content.entries.filter(row => row.kind === 'group' && !row.parentId).map(row => row.id)).sort();
  assert.equal(new Set(agents).size, agents.length, 'Duplicate agent identities in content map');
  // The per-agent gallery pages were retired: tab pages assemble slot groups and are covered as ordinary pages.
  const galleries = {};
  const home = content.entries.find(row => row.kind === 'page' && row.id === 'home')?.path;
  // A group page lands on its first tab (the projection's `landings`); the check expects that redirect, no other.
  const landings = {};
  for (const page of projection.pages ?? []) {
    const landing = projection.landings?.[page.id];
    if (!landing || landing === page.path || !routes.includes(page.path)) continue;
    assert.ok(routes.includes(landing), `Landing of ${page.path} is not a published route: ${landing}`);
    landings[page.path] = landing;
  }
  // A projection leaf is a covered link only under its tab's installed leaf template; one leaf per agent
  // is rendered so every agent's leaf view runs through the same rules as its pages.
  const leaves = (projection.leaves ?? []).map(row => row.path).filter(leaf => leafTemplates.includes(leaf.replace(/\/[^/]+$/, '/[slug]')));
  const leafRoutes = agents.map(agent => leaves.find(leaf => leaf.startsWith(`/${agent}/`))).filter(Boolean);
  return { routes: [...represented].sort(), templates: templates.sort(), leafTemplates: leafTemplates.sort(), agents, galleries, home, landings, leaves: leaves.sort(), leafRoutes };
}
/** Observe the initial page's own client channel; never substitute a Node/API probe. */
function initialResource(plan, route) {
  if (route === plan.home) return { kind: 'home', path: '/api/slots/census', agents: plan.agents };
  const agent = plan.galleries?.[route];
  return agent ? { kind: 'gallery', agent, route, path: agent === 'designer' ? '/api/designer/library' : `/api/agents/${agent}/library` } : undefined;
}
function initialExpectation(resource, value) {
  if (resource.kind === 'home') {
    const agents = resource.agents.map(agent => {
      const census = value?.[agent];
      assert.equal(census?.state, 'ready', `${agent} census is unavailable`);
      for (const key of ['total', 'withCandidate', 'pinned']) assert.ok(Number.isSafeInteger(census[key]) && census[key] >= 0, `Invalid ${agent} census ${key}`);
      assert.ok(census.withCandidate <= census.total && census.pinned <= census.total, `Impossible ${agent} census`);
      return { agent, total: census.total, withCandidate: census.withCandidate, pinned: census.pinned };
    });
    return { kind: 'home', agents };
  }
  assert.ok(['ready', 'missing'].includes(value?.state) && Array.isArray(value.sections), 'Unreadable agent library');
  const cards = value.sections.flatMap(section => section.cards);
  assert.equal(cards.length, value.count, 'Library count differs from its slot identities');
  assert.ok(value.state !== 'missing' || !cards.length, 'Missing library reports slots');
  return { kind: 'gallery', cards: cards.map(card => {
    const key = resource.agent === 'designer' ? card.slot : card.id;
    assert.ok(typeof key === 'string' && typeof card.slug === 'string' && typeof card.name === 'string', 'Invalid library slot identity');
    return { key, name: card.name, href: `${resource.route}/${card.slug}` };
  }), emptyTitle: resource.agent === 'designer' ? 'No Designer library yet' : `No ${resource.agent[0].toUpperCase() + resource.agent.slice(1)} records yet` };
}
/** Pure comparison also keeps explicit zero totals and unfilled slots valid. */
function initialDataFindings(expected, actual) {
  const findings = [];
  if (actual.loading) findings.push('Page still shows its initial loading notice');
  if (expected.kind === 'home') {
    if (actual.agents.length !== expected.agents.length) findings.push('Home agent count differs from its census');
    for (const row of expected.agents) {
      const card = actual.agents.find(card => card.agent === row.agent);
      if (!card || card.state !== 'ready' || card.total !== String(row.total) || card.totalLabel !== `${row.total} slots`
        || card.candidates !== String(row.withCandidate) || card.candidatesLabel !== `${row.withCandidate} slots with candidates`
        // The footer line leads with the pinned count; the agent's description may follow it in the same line.
        || !new RegExp(`^${row.pinned} pinned slots(?:\\s|$)`).test(card.pinned ?? '')) findings.push(`Home ${row.agent} does not display its native census`);
    }
  } else {
    if (actual.cards.length !== expected.cards.length) findings.push('Gallery slot count differs from its library');
    for (const row of expected.cards) {
      const card = actual.cards.find(card => card.key === row.key);
      if (!card || card.name !== row.name || card.href !== row.href) findings.push(`Gallery does not link native slot ${row.key}`);
    }
    if (!expected.cards.length && !actual.gallery && !actual.headings.includes(expected.emptyTitle)) findings.push('Empty library has no loaded empty state');
  }
  return findings;
}
// Serialized into the real browser; read only the existing section contracts.
function initialDataSnapshot() {
  const main = document.getElementById('studio-main') ?? document;
  return {
    loading: !!main.querySelector('[aria-label="Loading page"]'),
    agents: [...main.querySelectorAll('[data-home-agent]')].map(card => ({
      agent: card.getAttribute('data-home-agent'), state: card.getAttribute('data-census-state'),
      total: card.querySelector('[data-slot="card-title"]')?.textContent.trim(),
      totalLabel: card.querySelector('[data-slot="card-title"]')?.getAttribute('aria-label'),
      candidates: card.querySelector('[data-slot="badge"]')?.textContent.trim(),
      candidatesLabel: card.querySelector('[data-slot="badge"]')?.getAttribute('aria-label'),
      pinned: card.querySelector('[data-slot="card-footer"] > div')?.textContent.trim(),
    })),
    gallery: !!main.querySelector('[data-clossys-slot="sections.studio.agent-gallery"]'),
    cards: [...main.querySelectorAll('[data-gallery-leaf]')].map(card => {
      const link = card.querySelector('[data-slot="card-title"] a');
      return { key: card.getAttribute('data-gallery-leaf'), name: link?.textContent.trim(), href: link?.getAttribute('href') };
    }),
    headings: [...main.querySelectorAll('[role="heading"],h1,h2')].map(heading => heading.textContent.trim()),
  };
}
// Serialized into the real browser: the page reads its own origin's resource, as its client would.
async function readFromPage(path) {
  const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  return { status: response.status, value: response.ok ? await response.json() : undefined };
}
/**
 * The page's data must match the native resource. A route that fetches it on the client is compared
 * with that very response; a route whose first paint is server-seeded (Studio routes load their
 * Producer data server-side, 1bb829f5f) makes no client request, so the page reads the resource from
 * its own origin and the DOM must show exactly that. Either way the comparison is the same.
 */
async function checkInitialData(page, resource, observed, timeout) {
  const deadline = Date.now() + timeout;
  let value;
  if (observed.request) {
    while (!observed.response && Date.now() < deadline) await page.waitForTimeout(50);
    assert.ok(observed.response, `Browser did not receive ${resource.path}`);
    assert.equal(observed.response.status(), 200, `Initial client resource ${resource.path}`);
    value = await observed.response.json();
  } else {
    const read = await page.evaluate(readFromPage, resource.path);
    assert.equal(read.status, 200, `Native resource ${resource.path}`);
    value = read.value;
  }
  const expected = initialExpectation(resource, value);
  // API completion can precede React's committed data render.
  let findings;
  do {
    findings = initialDataFindings(expected, await page.evaluate(initialDataSnapshot));
    if (!findings.length) return expected;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  assert.fail(findings.join('; '));
}

const CELL_PREFIX = /^(?:assets|components|sections|foundations|context|page|plan|specimen|surface|system|tokens)\./;
/**
 * Text rules over what the page shows (pure, so the tests pin them). A NEED marker is `NEED:` or an
 * element reading exactly `NEED`; prose that names the convention ("a card that says NEED rather than
 * guessing") is not a marker.
 */
function textFindings({ text = '', leafTexts = [] }, cellIds = []) {
  const findings = [];
  if (/\bNEED\b\s*:/.test(text) || leafTexts.includes('NEED')) findings.push({ rule: 'need' });
  for (const [rule, expression] of [['fact-placeholder', /\[fact:/i], ['owner-placeholder', /TODO-OWNER/]]) {
    if (expression.test(text)) findings.push({ rule });
  }
  const tokens = new Set(text.match(/[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2}/g) ?? []);
  const rawIds = [...new Set([...cellIds.filter(id => tokens.has(id)), ...[...tokens].filter(id => CELL_PREFIX.test(id))])];
  if (rawIds.length) findings.push({ rule: 'raw-cell-id', ids: rawIds });
  return findings;
}
// Serialized directly into Playwright. Keep browser globals inside this function.
function inspectPage() {
  const findings = [], text = document.body?.innerText ?? '';
  const visible = element => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
  const leafTexts = [...(document.body?.querySelectorAll('*') ?? [])].filter(element => !element.children.length && element.textContent.trim() === 'NEED' && visible(element)).map(() => 'NEED');
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible);
  if (!headings.length) findings.push({ rule: 'missing-heading' });
  for (const element of headings) if (!(element.innerText || element.getAttribute('aria-label') || '').trim()) findings.push({ rule: 'empty-heading', tag: element.localName });
  for (const image of document.images) if (!image.complete || image.naturalWidth === 0) findings.push({ rule: 'missing-asset', src: image.getAttribute('src') });
  return { findings, text, leafTexts, headingCount: headings.length, links: [...document.querySelectorAll('a[href]')].map(element => element.href) };
}
/** Report-mode findings for their owners, plus the per-page reload cost as one later-polish item. */
function gateReports(checks, gates) {
  const reports = checks.flatMap(check => (check.reports ?? []).map(finding => ({ route: check.route, viewport: check.viewport, theme: check.theme, owner: gates[finding.rule]?.owner, ...finding })));
  const reloads = new Map();
  for (const finding of reports) if (finding.rule === 'aborted-reload') reloads.set(finding.route, Math.max(reloads.get(finding.route) ?? 0, finding.count));
  const laterPolish = reloads.size ? [{ item: 'deferred-loading iframe part (option A)', owners: ['designer', 'publisher'], rule: 'aborted-reload', reason: 'Streamed segments moved by React abort and reload their iframes; a deferred-loading iframe part would load each frame once.', pages: [...reloads].map(([route, reloadsPerPage]) => ({ route, reloads: reloadsPerPage })).sort((a, b) => b.reloads - a.reloads) }] : [];
  const counts = {};
  for (const finding of reports) counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  return { gates, reportCounts: counts, laterPolish, reports };
}
function screenshotName(route, variant, theme) {
  const digest = createHash('sha256').update(route).digest('hex').slice(0, 10);
  return `${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100) || 'home'}-${digest}-${variant}-${theme}.png`;
}
async function settle(page, ledger, timeout) {
  const deadline = Date.now() + timeout;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (ledger.waiting().length) quietSince = Date.now();
    else if (Date.now() - quietSince >= 350) {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Page resource requests did not settle before timeout: ${ledger.waiting().slice(0, 3).map(entry => entry.url).join(', ')}`);
}
const GREEN_INPUTS = 'green-inputs.json';
/** Routes with changed inputs since the last green run go first; the set of routes is unchanged. */
function scopeRoutes(routes, plan, options, screenshotRoot) {
  try {
    const root = options.studioRoot ?? studioRoot, repository = options.repositoryRoot ?? repositoryRoot;
    const map = readJson(path.join(root, 'generated/studio-map.json'));
    const checker = ['p0-studio-check.cjs', 'studio-check-gates.json', 'route-scope.cjs'].map(file => path.relative(repository, path.join(__dirname, file)));
    const inputs = routeScope.routeInputs({ repositoryRoot: repository, map, checker });
    const changed = routeScope.changedRoutes(inputs, routeScope.readState(path.join(screenshotRoot, GREEN_INPUTS)), routes);
    return { ordered: routeScope.changedFirst(routes, changed.changed), changed: changed.changed, reason: changed.reason, inputs };
  } catch (error) { return { ordered: routes, changed: [], reason: `inputs unavailable: ${error.message}` }; }
}
async function runStudioCheck(options = {}) {
  const origin = new URL(options.origin ?? studioOrigin({})).origin;
  const plan = options.plan ?? await discoverRoutePlan(options);
  const timeout = options.timeout ?? 15000;
  const gates = options.gates ?? readGates(options.gatesFile);
  const screenshotRoot = path.resolve(options.screenshotRoot ?? DEFAULT_SCREENSHOTS);
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const ownedBrowser = !options.browser;
  const browser = options.browser ?? await launchStudioBrowser(options);
  const checks = [], failures = [];
  try {
    const coverage = { routes: [...plan.routes, ...(plan.leafRoutes ?? []).filter(route => !plan.routes.includes(route))], cellIds: [] };
    const expectedPaths = new Set([...coverage.routes, ...(plan.leaves ?? [])].map(route => new URL(route, origin).pathname));
    // Owner-approved scope: every route once at desktop light, Designer slot pages at every viewport and theme (--full: all).
    const scope = scopeRoutes(coverage.routes, plan, options, screenshotRoot);
    const matrix = routeScope.studioCheckMatrix(scope.ordered, { leaves: plan.leaves ?? [], variants, full: Boolean(options.full) });
    for (const variant of variants) for (const theme of ['light', 'dark']) {
      const routes = matrix.filter(job => job.variant === variant && job.theme === theme).map(job => job.route);
      if (!routes.length) continue;
      // Firefox supports the mobile viewport but has no Playwright isMobile emulation.
      const emulation = browser.browserType().name() === 'firefox' ? {} : { isMobile: variant.isMobile };
      const context = await browser.newContext({ viewport: variant.viewport, ...emulation, colorScheme: theme });
      try {
        for (const route of routes) {
          const page = await context.newPage(), errors = [];
          const resource = initialResource(plan, route), observed = {};
          const initialClientRequest = request => resource && ['fetch', 'xhr'].includes(request.resourceType())
            && request.method() === 'GET' && new URL(request.url()).origin === origin && new URL(request.url()).pathname === resource.path;
          page.on('request', request => { if (initialClientRequest(request)) { observed.request = request; observed.response = undefined; } });
          page.on('response', response => { if (response.request() === observed.request) observed.response = response; });
          page.setDefaultTimeout(timeout);
          page.on('console', message => { if (message.type() === 'error') errors.push({ rule: 'console-error', message: message.text() }); });
          page.on('pageerror', error => errors.push({ rule: 'page-error', message: error.message }));
          page.on('response', response => { if (response.status() >= 400) errors.push({ rule: 'http-error', status: response.status(), url: response.url() }); });
          const ledger = requestLedger({ tracked: request => !['eventsource', 'websocket'].includes(request.resourceType()) && !/\/api\/events(?:\?|$)/.test(request.url()) });
          page.on('request', request => ledger.request(request));
          page.on('response', response => ledger.response(response));
          page.on('requestfinished', request => ledger.finished(request));
          page.on('requestfailed', request => ledger.failed(request));
          let audit = { findings: [] };
          try {
            // Native color-scheme consumers and common class/data consumers receive the same mode.
            await page.addInitScript(theme => { try { localStorage.setItem('theme', theme); } catch {} const root = document.documentElement; if (root) { root.classList.toggle('dark', theme === 'dark'); root.dataset.theme = theme; } }, theme);
            const response = await page.goto(origin + route, { waitUntil: 'load', timeout });
            if (response?.status() !== 200) errors.push({ rule: 'route-status', status: response?.status() ?? null });
            if (page.url() !== origin + (plan.landings?.[route] ?? route)) errors.push({ rule: 'unexpected-redirect', url: page.url() });
            await settle(page, ledger, timeout);
            if (resource) {
              try {
                const loaded = await checkInitialData(page, resource, observed, timeout);
                // Native library identities extend the compiled publication with valid leaf links.
                for (const card of loaded.cards ?? []) expectedPaths.add(card.href);
              }
              catch (error) { errors.push({ rule: 'initial-data', resource: resource.path, message: error.message }); }
              // Exercise an existing client handler when present; data readiness is always required.
              const toggle = page.locator('[data-theme-toggle]');
              if (await toggle.count()) {
                try {
                  const before = await page.evaluate(() => document.documentElement.dataset.theme);
                  const next = before === 'dark' ? 'light' : 'dark';
                  // Each toggle re-themes live iframes (their src carries the theme). Settle after each one, as after
                  // navigation, so the check never aborts the loads its own toggle started.
                  await toggle.click();
                  await page.waitForFunction(next => document.documentElement.dataset.theme === next && localStorage.getItem('theme') === next, next, { timeout });
                  await settle(page, ledger, timeout);
                  await toggle.click();
                  await page.waitForFunction(before => document.documentElement.dataset.theme === before, before, { timeout });
                  await settle(page, ledger, timeout);
                } catch (error) { errors.push({ rule: 'hydration-interaction', message: error.message }); }
              }
            }
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.dataset.theme = theme; }, theme);
            const inspected = await page.evaluate(inspectPage);
            audit = { ...inspected, findings: [...textFindings(inspected, coverage.cellIds), ...inspected.findings] };
            for (const href of audit.links ?? []) {
              const target = new URL(href);
              if (target.origin === origin && !target.pathname.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(target.pathname) && !expectedPaths.has(target.pathname)) errors.push({ rule: 'uncovered-linked-route', path: target.pathname });
            }
          } catch (error) { errors.push({ rule: 'navigation-error', message: error.message }); }
          const screenshot = screenshotName(route, variant.name, theme);
          try { await page.screenshot({ path: path.join(screenshotRoot, screenshot), fullPage: true, timeout }); }
          catch (error) { errors.push({ rule: 'screenshot-error', message: error.message }); }
          const gated = applyGates([...audit.findings, ...errors, ...ledger.findings()], gates);
          const result = { route, viewport: variant.name, theme, screenshot, findings: gated.findings, reports: gated.reports };
          checks.push(result);
          if (result.findings.length) failures.push(result);
          // The first failing render is reported at once; the run continues so the report stays complete.
          if (result.findings.length && failures.length === 1) (options.log ?? console.error)(`studio:check FIRST-FAILURE ${route} ${variant.name} ${theme}: ${[...new Set(result.findings.map(finding => finding.rule))].join(', ')} (continuing)`);
          await page.close();
        }
      } finally { await context.close(); }
    }
    const report = { check: 'studio:check', status: failures.length ? 'FAIL' : 'PASS', phase: 'render', executed: true, origin, templates: plan.templates, routes: coverage.routes,
      matrix: { full: Boolean(options.full), renders: matrix.length, designerSlotRoutes: coverage.routes.filter(route => routeScope.isDesignerSlotRoute(route, new Set(plan.leaves ?? []))), changedFirst: scope.changed.length, order: scope.reason }, ...gateReports(checks, gates), checks };
    fs.writeFileSync(path.join(screenshotRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (!failures.length && scope.inputs) fs.writeFileSync(path.join(screenshotRoot, GREEN_INPUTS), JSON.stringify(scope.inputs) + '\n');
    if (failures.length) {
      const error = new Error(`studio:check failed in ${failures.length}/${checks.length} route/theme/viewport checks: ${[...new Set(failures.flatMap(check => check.findings.map(finding => finding.rule)))].join(', ')}`);
      error.report = report;
      throw error;
    }
    return report;
  } finally { if (ownedBrowser) await browser.close(); }
}
async function checkStudio(options = {}) {
  try { return await runStudioCheck(options); }
  catch (error) {
    const report = failureReport(error);
    // Persist setup/environment failures too: an absent browser is never a visual pass.
    const output = path.resolve(options.screenshotRoot ?? DEFAULT_SCREENSHOTS);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (error?.report) throw error;
    throw reportError(report, error);
  }
}
/** The CLI and mutation runner use the same nonzero exit contract. */
async function checkCommand(options = {}) {
  try { return { exitCode: 0, report: await checkStudio(options) }; }
  catch (error) { const report = failureReport(error); return { exitCode: REPORT_EXIT_CODES[report.status] ?? 1, report }; }
}
/**
 * The command serves the Studio it checks, the one way every rendered check does
 * (studio/checks/studio-origin.mjs): --origin or $STUDIO_ORIGIN as given, otherwise check:studio's
 * startStudio (built from the current source, on the single preview port), stopped afterwards. A
 * Studio that cannot start is a setup failure (ENV exit 2), never a pass and never a skipped route.
 */
async function servedCheck(options = {}, { env = process.env, start, ready, check = checkCommand } = {}) {
  if (options.origin) return check(options);
  if (env.STUDIO_ORIGIN) return check({ ...options, origin: studioOrigin(env) });
  let studio;
  try {
    studio = await (start ?? (await import('../../scripts/check-studio.mjs')).startStudio)({ log: line => console.error(line) });
    await (ready ?? specimensReady)(studio.origin);
  } catch (error) {
    await studio?.stop();
    const report = failureReport(error, { status: 'ENV' });
    return { exitCode: REPORT_EXIT_CODES.ENV, report };
  }
  try { return await check({ ...options, origin: studio.origin }); }
  finally { await studio.stop(); }
}
function parseArgs(args) {
  const options = {};
  const flags = new Map([['--origin', 'origin'], ['--screenshots', 'screenshotRoot'], ['--studio-root', 'studioRoot'], ['--repository-root', 'repositoryRoot']]);
  for (let index = 0; index < args.length; index++) {
    // --full renders every route at every viewport and theme (the pre-scope matrix).
    if (args[index] === '--full' && !options.full) { options.full = true; continue; }
    const name = flags.get(args[index]);
    if (!name || !args[index + 1] || args[index + 1].startsWith('--') || options[name]) throw new Error('Usage: studio:check [--full] [--origin URL] [--screenshots DIRECTORY] [--studio-root DIRECTORY] [--repository-root DIRECTORY]');
    options[name] = args[++index];
  }
  return options;
}
module.exports = { readGates, applyGates, requestLedger, settle, gateReports, REPORTABLE_RULES, textFindings, checkInitialData, initialResource, initialExpectation, initialDataFindings, discoverRoutePlan, inspectPage, screenshotName, checkStudio, checkCommand, servedCheck, parseArgs, failureReport, reportError, REPORT_EXIT_CODES, browserRuntime, launchStudioBrowser, probeBrowser };
if (require.main === module) Promise.resolve().then(() => servedCheck(parseArgs(process.argv.slice(2)))).then(({ exitCode, report }) => { console.log(JSON.stringify(report, null, 2)); process.exitCode = exitCode; }).catch(error => { const report = failureReport(error); console.error(JSON.stringify(report, null, 2)); process.exitCode = REPORT_EXIT_CODES[report.status] ?? 1; });
