'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { ROUTE_MARKER, readStudioPublication } = require('./check-studio-routes.cjs');
const { readGates, applyGates, requestLedger, settle, gateReports, textFindings, checkInitialData, initialResource, initialExpectation, initialDataFindings, discoverRoutePlan, checkCommand, servedCheck, parseArgs, browserRuntime } = require('./p0-studio-check.cjs');

const repositoryRoot = path.resolve(__dirname, '../../../..');
// Fixtures live in the OS temp directory (TMPDIR), never under the checkout (a write there dirties the tree), and are removed after the run.
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-studio-check-'));
after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
function directory(label) { return fs.mkdtempSync(path.join(evidenceRoot, `${label}-`)); }
function write(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function projectionFixture() {
  const root = directory('routes'), studio = path.join(root, 'studio');
  const routes = [{ path: '/' }, { path: '/publisher/studio' }];
  write(root, 'studio/generated/studio-map.json', JSON.stringify({ routes }));
  const publication = { routePack: { routes }, map: { entries: [{ kind: 'page', path: '/', id: 'home' }, { kind: 'group', path: '/publisher', id: 'publisher' }, { kind: 'page', path: '/publisher/studio', id: 'publisher-studio', parentId: 'publisher' }] } };
  write(root, 'studio/app/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/publisher/studio/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/publisher/studio/[slug]/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  return { root, studio, publication, options: { repositoryRoot: root, studioRoot: studio, publication } };
}

test('checked-in publication and every real App Router route are discovered', async () => {
  const plan = await discoverRoutePlan();
  assert.ok(plan.routes.includes('/'));
  assert.ok(plan.routes.length > 1);
  // Every content-map page (home, agent top groups and their nested tabs) plus one `[slug]` leaf template per tab.
  const { map, routePack } = await readStudioPublication(repositoryRoot);
  const pages = map.entries.filter(row => row.kind === 'page').map(row => row.path);
  const leaves = routePack.routes.filter(row => row.leaf).map(row => `${row.path}/[slug]`);
  assert.deepEqual(plan.routes, [...pages].sort());
  assert.deepEqual(plan.leafTemplates, [...leaves].sort());
  assert.deepEqual(plan.templates, [...pages, ...leaves].sort(), 'Publisher-installed pages and leaf templates only');
  assert.ok(plan.leafTemplates.includes('/designer/themes/colors/[slug]') && !plan.templates.includes('/designer/[slug]'));
  assert.deepEqual(plan.agents, ['designer', 'director', 'publisher', 'writer']);
  assert.ok(!plan.templates.some(template => template.startsWith('/content/')), 'the standalone content route is retired');
});

test('group pages expect their projected landing and leaves count as covered only under an installed leaf template', async () => {
  const plan = await discoverRoutePlan();
  assert.ok(Object.keys(plan.landings).length > 0);
  for (const [route, landing] of Object.entries(plan.landings)) assert.ok(plan.routes.includes(route) && plan.routes.includes(landing) && landing.startsWith(`${route}/`), `${route} -> ${landing}`);
  assert.equal(plan.landings['/'], undefined, 'Home lands on itself');
  assert.ok(plan.leaves.length > 0 && plan.leaves.every(leaf => plan.leafTemplates.includes(leaf.replace(/\/[^/]+$/, '/[slug]'))));
  assert.deepEqual(plan.leafRoutes.map(leaf => leaf.split('/')[1]), plan.agents, 'one rendered leaf per agent');
  assert.ok(plan.leafRoutes.every(leaf => plan.leaves.includes(leaf)));
  const fixture = projectionFixture();
  const projection = path.join(fixture.studio, 'generated/studio-map.json');
  const map = JSON.parse(fs.readFileSync(projection, 'utf8'));
  write(fixture.root, 'studio/generated/studio-map.json', JSON.stringify({ ...map,
    pages: [{ id: 'home', path: '/' }, { id: 'publisher-studio', path: '/publisher/studio' }],
    landings: { home: '/', 'publisher-studio': '/publisher/studio' },
    leaves: [{ path: '/publisher/studio/page.home' }, { path: '/writer/strings/strings.label' }] }));
  const fixed = await discoverRoutePlan(fixture.options);
  assert.deepEqual(fixed.landings, {});
  assert.deepEqual(fixed.leaves, ['/publisher/studio/page.home'], 'a leaf without an installed template is not covered');
  assert.deepEqual(fixed.leafRoutes, ['/publisher/studio/page.home']);
  write(fixture.root, 'studio/generated/studio-map.json', JSON.stringify({ ...map, pages: [{ id: 'publisher-studio', path: '/publisher/studio' }], landings: { 'publisher-studio': '/publisher/studio/missing' } }));
  await assert.rejects(discoverRoutePlan(fixture.options), /Landing of \/publisher\/studio is not a published route/);
});

test('a NEED marker fails, prose naming the convention does not, and raw ids still fail', () => {
  const page = (text, leafTexts = []) => ({ text, leafTexts });
  assert.deepEqual(textFindings(page('Example: a card that says NEED rather than guessing.')), []);
  assert.deepEqual(textFindings(page('NEED: fixture evidence unavailable')), [{ rule: 'need' }]);
  assert.deepEqual(textFindings(page('NEED : selected Icon asset is unavailable')), [{ rule: 'need' }]);
  assert.deepEqual(textFindings(page('Status', ['NEED'])), [{ rule: 'need' }], 'a status that reads exactly NEED');
  assert.deepEqual(textFindings(page('Shown as strings.label'), ['strings.label']), [{ rule: 'raw-cell-id', ids: ['strings.label'] }]);
  assert.deepEqual(textFindings(page('components.button')), [{ rule: 'raw-cell-id', ids: ['components.button'] }]);
  assert.deepEqual(textFindings(page('[fact:pending] TODO-OWNER page.home')).map(finding => finding.rule), ['fact-placeholder', 'owner-placeholder', 'raw-cell-id']);
});

test('new static pages join coverage, unknown dynamic pages and publication drift fail closed', async () => {
  const fixture = projectionFixture();
  write(fixture.root, 'studio/app/help/page.tsx', 'Help');
  assert.ok((await discoverRoutePlan(fixture.options)).routes.includes('/help'));
  write(fixture.root, 'studio/app/projects/[project]/page.tsx', 'Project');
  await assert.rejects(discoverRoutePlan(fixture.options), /Unexpanded App Router route/);
  const unmarked = projectionFixture();
  write(unmarked.root, 'studio/app/publisher/studio/[slug]/page.tsx', 'PublishedPage');
  await assert.rejects(discoverRoutePlan(unmarked.options), /Unexpanded App Router route/);
  const drift = projectionFixture();
  drift.publication.routePack.routes = [{ path: '/' }];
  await assert.rejects(discoverRoutePlan(drift.options), /route pack differ/);
  const mapDrift = projectionFixture();
  mapDrift.publication.map.entries.pop();
  await assert.rejects(discoverRoutePlan(mapDrift.options), /content map differ/);
  const unpinned = projectionFixture();
  await assert.rejects(discoverRoutePlan({ ...unpinned.options, publication: undefined }));
});

test('browser launch failure has a structured ENV envelope and never retries', async () => {
  let launches = 0;
  const screenshotRoot = directory('environment');
  const playwright = { chromium: { executablePath: () => 'uninstalled-browser', launch: async () => { launches++; throw new Error('Fixture browser launch unavailable'); } } };
  const result = await checkCommand({ playwright, plan: { routes: ['/'], templates: ['/'] }, screenshotRoot });
  assert.equal(launches, 1);
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, 'ENV');
  assert.equal(result.report.executed, false);
  assert.equal(result.report.phase, 'browser-launch');
  assert.equal(result.report.diagnostics[0].message, 'Fixture browser launch unavailable');
  assert.deepEqual(result.report.checks, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(screenshotRoot, 'report.json'), 'utf8')), result.report);
});

test('runtime selection supports Playwright engines and explicit executable configuration', () => {
  const engine = { executablePath: () => __filename };
  const runtime = browserRuntime({ playwright: { firefox: engine }, browserName: 'firefox', executablePath: 'selected-browser' });
  assert.equal(runtime.type, engine);
  assert.equal(runtime.launch.executablePath, 'selected-browser');
  assert.equal(runtime.launch.timeout, 10000);
  assert.throws(() => browserRuntime({ playwright: {}, browserName: 'unknown' }), /STUDIO_BROWSER/);
});

test('CLI rejects ambiguous or unknown options', () => {
  assert.deepEqual(parseArgs(['--origin', 'http://127.0.0.1:4300']), { origin: 'http://127.0.0.1:4300' });
  assert.throws(() => parseArgs(['--routes', '/']), /Usage/);
  assert.throws(() => parseArgs(['--origin', 'http://one', '--origin', 'http://two']), /Usage/);
});

// These are comparator unit tests, not claims that a browser hydrated or reached Producer.
test('initial resources follow the publication paths and only require each page own data channel', () => {
  const plan = { home: '/', agents: ['designer', 'writer'], galleries: { '/design-library': 'designer', '/copy': 'writer' } };
  assert.equal(initialResource(plan, '/').path, '/api/slots/census');
  assert.equal(initialResource(plan, '/design-library').path, '/api/designer/library');
  assert.equal(initialResource(plan, '/copy').path, '/api/agents/writer/library');
  assert.equal(initialResource(plan, '/copy/strings.label'), undefined);
});

test('Home rejects initial loading and stale totals while accepting a real zero census', () => {
  const expected = initialExpectation({ kind: 'home', agents: ['writer'] }, {
    writer: { state: 'ready', total: 0, withCandidate: 0, pinned: 0 },
  });
  const ready = { loading: false, agents: [{ agent: 'writer', state: 'ready', total: '0', totalLabel: '0 slots',
    candidates: '0', candidatesLabel: '0 slots with candidates', pinned: '0 pinned slots' }] };
  assert.deepEqual(initialDataFindings(expected, ready), []);
  assert.match(initialDataFindings(expected, { loading: false, agents: [{ agent: 'writer', state: 'loading' }] }).join('; '), /native census/);
  assert.match(initialDataFindings(expected, { ...ready, agents: [{ ...ready.agents[0], total: '435' }] }).join('; '), /native census/);
  assert.deepEqual(initialDataFindings(expected, { ...ready, agents: [{ ...ready.agents[0], pinned: '0 pinned slots Copy: every string the product shows.' }] }), [], 'the description may follow the count');
  assert.match(initialDataFindings(expected, { ...ready, agents: [{ ...ready.agents[0], pinned: '01 pinned slots' }] }).join('; '), /native census/);
  assert.match(initialDataFindings(expected, { ...ready, agents: [{ ...ready.agents[0], pinned: '0 pinned slotsX' }] }).join('; '), /native census/);
  assert.throws(() => initialExpectation({ kind: 'home', agents: ['writer'] }, { writer: { state: 'error' } }), /unavailable/);
});

test('a server-seeded Home is compared with the census its page reads, and a stale census still fails', async () => {
  const resource = { kind: 'home', path: '/api/slots/census', agents: ['writer'] };
  const census = { writer: { state: 'ready', total: 3, withCandidate: 2, pinned: 1 } };
  const shown = total => ({ loading: false, agents: [{ agent: 'writer', state: 'ready', total: String(total), totalLabel: `${total} slots`,
    candidates: '2', candidatesLabel: '2 slots with candidates', pinned: '1 pinned slots' }], gallery: false, cards: [], headings: [] });
  const fake = (snapshot, status = 200) => ({ waitForTimeout: async () => {}, evaluate: async (fn, arg) => arg === undefined ? snapshot : { status, value: status === 200 ? census : undefined } });
  assert.equal((await checkInitialData(fake(shown(3)), resource, {}, 200)).agents[0].total, 3);
  await assert.rejects(checkInitialData(fake(shown(4)), resource, {}, 200), /native census/);
  await assert.rejects(checkInitialData(fake(shown(3), 500), resource, {}, 200), /Native resource/);
  const response = { status: () => 200, json: async () => census };
  assert.equal((await checkInitialData(fake(shown(3)), resource, { request: {}, response }, 200)).agents[0].pinned, 1, 'a client request is compared with its own response');
  await assert.rejects(checkInitialData(fake(shown(3)), resource, { request: {} }, 100), /did not receive/);
});

test('gallery requires every native slot link but an unfilled slot needs no specimen', () => {
  const resource = { kind: 'gallery', agent: 'writer', route: '/writer' };
  const expected = initialExpectation(resource, { state: 'ready', count: 1, sections: [{ cards: [
    { id: 'strings.label', slug: 'strings.label', name: 'Labels', records: 0, emptyState: 'No candidate' },
  ] }] });
  const ready = { loading: false, gallery: true, cards: [{ key: 'strings.label', name: 'Labels', href: '/writer/strings.label' }], headings: [] };
  assert.deepEqual(initialDataFindings(expected, ready), []);
  assert.match(initialDataFindings(expected, { loading: true, gallery: false, cards: [], headings: ['Writer'] }).join('; '), /initial loading notice/);
  assert.match(initialDataFindings(expected, { ...ready, cards: [{ ...ready.cards[0], href: '' }] }).join('; '), /native slot/);
  const designer = initialExpectation({ ...resource, agent: 'designer', route: '/designer' }, {
    state: 'ready', count: 1, sections: [{ cards: [{ slot: 'components.button', slug: 'components.button', name: 'Button', emptyState: 'No pin' }] }],
  });
  assert.equal(designer.cards[0].key, 'components.button');
});

test('an empty native library needs its loaded empty state, not a heading with a skeleton', () => {
  const expected = initialExpectation({ kind: 'gallery', agent: 'writer', route: '/writer' }, { state: 'ready', count: 0, sections: [] });
  assert.deepEqual(initialDataFindings(expected, { loading: false, gallery: false, cards: [], headings: ['No Writer records yet'] }), []);
  assert.ok(initialDataFindings(expected, { loading: true, gallery: false, cards: [], headings: ['Writer'] }).length);
  assert.throws(() => initialExpectation({ kind: 'gallery', agent: 'writer', route: '/writer' }, { state: 'ready', count: 1, sections: [] }), /count differs/);
});

test('a Next specimen page gets no exemption: /__specimen is a Producer server route', async () => {
  const fixture = projectionFixture();
  write(fixture.root, 'studio/app/%5F_specimen/page.tsx', 'Record specimen transport');
  write(fixture.root, 'studio/app/specimen-help/page.tsx', 'Specimen help');
  const plan = await discoverRoutePlan(fixture.options);
  assert.ok(plan.routes.includes('/%5F_specimen'));
  assert.ok(plan.routes.includes('/specimen-help'));
});

test('shared Chrome launch prefers the chrome channel, falls back to CLOSSYS_CHROME, else blocks with exit 2', async () => {
  const { launchChrome, failureExitCode } = require('./chrome-launch.cjs');
  const calls = [];
  const fake = outcomes => ({ chromium: { launch: async options => { calls.push(options); const outcome = outcomes.shift(); if (outcome instanceof Error) throw outcome; return outcome; } } });
  calls.length = 0;
  assert.equal(await launchChrome({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }, { playwright: fake(['channel']), env: {} }), 'channel');
  assert.deepEqual(calls, [{ headless: true, args: ['--no-sandbox'], channel: 'chrome' }]);
  calls.length = 0;
  assert.equal(await launchChrome({}, { playwright: fake([new Error('no channel'), 'path']), env: { CLOSSYS_CHROME: '/opt/chrome' } }), 'path');
  assert.deepEqual(calls, [{ headless: true, channel: 'chrome' }, { headless: true, executablePath: '/opt/chrome' }]);
  calls.length = 0;
  const blocked = await launchChrome({}, { playwright: fake([new Error('no channel')]), env: {} }).catch(error => error);
  assert.equal(calls.length, 1);
  assert.match(blocked.message, /^BLOCKED no browser: channel chrome: no channel; CLOSSYS_CHROME unset$/);
  assert.equal(failureExitCode(blocked), 2);
  assert.equal(failureExitCode(new Error('real finding')), 1);
  const both = await launchChrome({}, { playwright: fake([new Error('no channel'), new Error('bad path')]), env: { CLOSSYS_CHROME: '/opt/chrome' } }).catch(error => error);
  assert.equal(both.exitCode, 2);
  assert.match(both.message, /CLOSSYS_CHROME \/opt\/chrome: bad path/);
});

test('studio check reports a blocked Chrome launch as ENV exit 2 with the blocked diagnostic', async () => {
  const playwright = { chromium: { executablePath: () => 'uninstalled-browser', launch: async () => { throw new Error('Fixture browser launch unavailable'); } } };
  const result = await checkCommand({ playwright, env: {}, plan: { routes: ['/'], templates: ['/'], contentRoute: false }, screenshotRoot: directory('blocked') });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.diagnostics[1].rule, 'blocked-no-browser');
  assert.match(result.report.diagnostics[1].message, /^BLOCKED no browser/);
});

test('the command serves the Studio it checks and stops it after, pass or fail', async () => {
  const events = [];
  const start = async () => { events.push('start'); return { origin: 'http://127.0.0.1:4503', stop: async () => { events.push('stop'); } }; };
  const ready = async origin => { events.push(`ready ${origin}`); };
  const served = await servedCheck({ screenshotRoot: 'x' }, { env: {}, start, ready, check: async options => { events.push(`check ${options.origin}`); return { exitCode: 0, report: {} }; } });
  assert.equal(served.exitCode, 0);
  assert.deepEqual(events, ['start', 'ready http://127.0.0.1:4503', 'check http://127.0.0.1:4503', 'stop']);
  events.length = 0;
  await assert.rejects(servedCheck({}, { env: {}, start, ready, check: async () => { throw new Error('route failed'); } }), /route failed/);
  assert.deepEqual(events, ['start', 'ready http://127.0.0.1:4503', 'stop']);
});

test('an origin given by flag or $STUDIO_ORIGIN is used as is, with no Studio started', async () => {
  const start = async () => { throw new Error('must not start'); };
  const seen = [];
  const check = async options => { seen.push(options.origin); return { exitCode: 0, report: {} }; };
  await servedCheck({ origin: 'http://localhost:4999' }, { env: {}, start, check });
  await servedCheck({}, { env: { STUDIO_ORIGIN: 'http://localhost:4888/x' }, start, check });
  assert.deepEqual(seen, ['http://localhost:4999', 'http://localhost:4888']);
});

test('a Studio that cannot start is a setup failure (ENV exit 2), and nothing is checked', async () => {
  let checked = false;
  const result = await servedCheck({}, { env: {}, start: async () => { throw new Error('port 4503 is already serving'); }, check: async () => { checked = true; return { exitCode: 0 }; } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, 'ENV');
  assert.match(result.report.diagnostics[0].message, /already serving/);
  assert.equal(checked, false);
});

// Fake Playwright requests: url(), frame().isDetached(), failure(), resourceType().
function fakeRequest(url, { detached = false, failure } = {}) {
  const request = { url: () => url, frame: () => ({ isDetached: () => detached }), failure: () => (failure ? { errorText: failure } : null), resourceType: () => 'document' };
  return request;
}
function load(ledger, request, { status = 200, state } = {}) {
  ledger.request(request);
  if (state === 'pending') return request;
  ledger.response({ request: () => request, status: () => status });
  if (state === 'failed') ledger.failed(request); else ledger.finished(request);
  return request;
}
test('the gate config sets only wording/visual rules to report, and an invalid gate fails setup', () => {
  const gates = readGates();
  assert.equal(gates['raw-cell-id'].mode, 'report');
  assert.equal(gates['aborted-reload'].mode, 'report');
  assert.match(gates['raw-cell-id'].reason, /Only wiring blocks/);
  const write = config => { const file = path.join(directory('gates'), 'gates.json'); fs.writeFileSync(file, JSON.stringify(config)); return file; };
  const base = { schema: 'clossys.studio-check-gates/1' };
  for (const rule of ['request-failed', 'navigation-error', 'need', 'console-error', 'initial-data', 'uncovered-linked-route']) assert.throws(() => readGates(write({ ...base, gates: [{ rule, mode: 'report', reason: 'x' }] })), /wiring or unknown/);
  assert.throws(() => readGates(write({ ...base, gates: [{ rule: 'raw-cell-id', mode: 'quiet', reason: 'x' }] })), /block or report/);
  assert.throws(() => readGates(write({ ...base, gates: [{ rule: 'raw-cell-id', mode: 'report', reason: ' ' }] })), /needs a reason/);
  assert.throws(() => readGates(write({ ...base, gates: [{ rule: 'raw-cell-id', mode: 'report', reason: 'x' }, { rule: 'raw-cell-id', mode: 'block', reason: 'x' }] })), /listed twice/);
  assert.throws(() => readGates(write({ schema: 'other', gates: [] })), /schema/);
  assert.throws(() => readGates(path.join(evidenceRoot, 'absent.json')), /ENOENT/);
});
test('a raw cell id is a report, never dropped; wiring findings keep blocking', () => {
  const gates = readGates();
  const findings = [...textFindings({ text: 'Open page.home now. NEED: evidence' }), { rule: 'request-failed', url: 'http://x/a' }, { rule: 'navigation-error', message: 'x' }];
  const gated = applyGates(findings, gates);
  assert.deepEqual(gated.reports, [{ rule: 'raw-cell-id', ids: ['page.home'] }]);
  assert.deepEqual(gated.findings.map(finding => finding.rule), ['need', 'request-failed', 'navigation-error']);
  // Block mode (or no config) keeps the finding blocking.
  assert.deepEqual(applyGates(findings, { 'raw-cell-id': { mode: 'block' } }).findings.map(finding => finding.rule), ['need', 'raw-cell-id', 'request-failed', 'navigation-error']);
  assert.deepEqual(applyGates(findings).reports, []);
});
test('an abort is a reload only when a later request for the same URL finished OK', () => {
  const ledger = requestLedger();
  load(ledger, fakeRequest('http://s/__specimen?a', { failure: 'net::ERR_ABORTED' }), { state: 'failed' });
  load(ledger, fakeRequest('http://s/__specimen?a'));
  // Mutation proof: an abort with no retry, a retry that never finished OK, and a retry that ran
  // first all stay blocking request-failed; a non-abort failure is never a reload.
  load(ledger, fakeRequest('http://s/__specimen?none', { failure: 'net::ERR_ABORTED' }), { state: 'failed' });
  load(ledger, fakeRequest('http://s/__specimen?bad', { failure: 'net::ERR_ABORTED' }), { state: 'failed' });
  load(ledger, fakeRequest('http://s/__specimen?bad'), { status: 500 });
  load(ledger, fakeRequest('http://s/__specimen?early'));
  load(ledger, fakeRequest('http://s/__specimen?early', { failure: 'net::ERR_ABORTED' }), { state: 'failed' });
  load(ledger, fakeRequest('http://s/__specimen?refused', { failure: 'net::ERR_CONNECTION_REFUSED' }), { state: 'failed' });
  load(ledger, fakeRequest('http://s/__specimen?refused'));
  const findings = ledger.findings();
  assert.deepEqual(findings.filter(finding => finding.rule === 'request-failed').map(finding => finding.url.split('?')[1]), ['none', 'bad', 'early', 'refused']);
  assert.deepEqual(findings.find(finding => finding.rule === 'aborted-reload'), { rule: 'aborted-reload', count: 1, aborted: 1, orphaned: 0, urls: ['http://s/__specimen?a'] });
  const gated = applyGates(findings, readGates());
  assert.deepEqual(gated.findings.map(finding => finding.rule), ['request-failed', 'request-failed', 'request-failed', 'request-failed']);
  assert.deepEqual(gated.reports.map(finding => finding.rule), ['aborted-reload']);
});
test('settle waits for reloads to finish, skips only orphans a finished reload superseded, and a live pending request still times out', async () => {
  const page = { waitForTimeout: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), evaluate: async () => {} };
  // A frame moved after its response: Playwright never reports the request finished.
  const orphanLedger = requestLedger();
  load(orphanLedger, fakeRequest('http://s/__specimen?o', { detached: true }), { state: 'pending' });
  const reload = load(orphanLedger, fakeRequest('http://s/__specimen?o'), { state: 'pending' });
  setTimeout(() => { orphanLedger.response({ request: () => reload, status: () => 200 }); orphanLedger.finished(reload); }, 100);
  const started = Date.now();
  await settle(page, orphanLedger, 2000);
  assert.ok(Date.now() - started >= 100, 'settle waited for the reload to finish');
  assert.deepEqual(orphanLedger.findings(), [{ rule: 'aborted-reload', count: 1, aborted: 0, orphaned: 1, urls: ['http://s/__specimen?o'] }]);
  // An orphan with no finished reload, and a live pending request, never settle.
  const stuck = requestLedger();
  load(stuck, fakeRequest('http://s/__specimen?stuck', { detached: true }), { state: 'pending' });
  await assert.rejects(settle(page, stuck, 500), /did not settle before timeout: http:\/\/s\/__specimen\?stuck/);
  const live = requestLedger();
  load(live, fakeRequest('http://s/__specimen?live'), { state: 'pending' });
  load(live, fakeRequest('http://s/__specimen?live'));
  await assert.rejects(settle(page, live, 500), /did not settle/);
  // Untracked streams are never waited on.
  const streams = requestLedger({ tracked: request => !request.url().includes('/api/events') });
  load(streams, fakeRequest('http://s/api/events'), { state: 'pending' });
  await settle(page, streams, 1000);
});
test('the run report lists every report-mode finding and the per-page reload cost as one later-polish item', () => {
  const gates = readGates();
  const checks = [
    { route: '/a', viewport: 'desktop', theme: 'light', findings: [], reports: [{ rule: 'aborted-reload', count: 4, aborted: 4, orphaned: 0, urls: [] }, { rule: 'raw-cell-id', ids: ['page.home'] }] },
    { route: '/a', viewport: 'mobile', theme: 'dark', findings: [], reports: [{ rule: 'aborted-reload', count: 6, aborted: 5, orphaned: 1, urls: [] }] },
    { route: '/b', viewport: 'desktop', theme: 'light', findings: [], reports: [] },
  ];
  const summary = gateReports(checks, gates);
  assert.deepEqual(summary.reportCounts, { 'aborted-reload': 2, 'raw-cell-id': 1 });
  assert.deepEqual(summary.reports.find(finding => finding.rule === 'raw-cell-id'), { route: '/a', viewport: 'desktop', theme: 'light', owner: 'designer', rule: 'raw-cell-id', ids: ['page.home'] });
  assert.equal(summary.laterPolish.length, 1);
  assert.equal(summary.laterPolish[0].item, 'deferred-loading iframe part (option A)');
  assert.deepEqual(summary.laterPolish[0].owners, ['designer', 'publisher']);
  assert.deepEqual(summary.laterPolish[0].pages, [{ route: '/a', reloads: 6 }]);
  assert.deepEqual(gateReports([checks[2]], gates).laterPolish, []);
});
