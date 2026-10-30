'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { discoverRoutePlan, expandContentRoutes, checkStudio, parseArgs } = require('./p0-studio-check.cjs');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const evidenceRoot = path.join(repositoryRoot, 'ignoredtmp/p0b/browser');
fs.mkdirSync(evidenceRoot, { recursive: true });
function directory(label) { return fs.mkdtempSync(path.join(evidenceRoot, `${label}-`)); }
function write(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function projectionFixture() {
  const root = directory('routes'), studio = path.join(root, 'studio');
  const routes = [{ path: '/' }, { path: '/agents/publisher' }];
  write(root, 'studio/generated/studio-map.json', JSON.stringify({ routes }));
  write(root, 'clossys/agents/publisher/route-pack/studio.json', JSON.stringify({ routes }));
  write(root, 'clossys/agents/publisher/content-map/studio.json', JSON.stringify({ entries: [{ kind: 'page', path: '/', id: 'home' }, { kind: 'page', path: '/agents/publisher', id: 'publisher', parentId: 'agents' }] }));
  write(root, 'studio/app/[[...route]]/page.tsx', 'studioRouteForSegments(route)');
  write(root, 'studio/app/content/[agent]/[id]/page.tsx', 'StandaloneCellContent');
  return { root, studio, options: { repositoryRoot: root, studioRoot: studio } };
}
const inventory = { agents: [{ agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', version: 3 }, { id: 'page.article', version: 1 }] }] };

test('checked-in publication and every real App Router route are discovered', () => {
  const plan = discoverRoutePlan();
  assert.ok(plan.routes.includes('/'));
  assert.ok(plan.routes.length > 1);
  assert.ok(plan.templates.includes('/content/[agent]/[id]'));
  assert.equal(plan.contentRoute, true);
});

test('coverage expands every live identity and exposed version instead of selecting one dynamic example', () => {
  const fixture = projectionFixture(), plan = discoverRoutePlan(fixture.options);
  const coverage = expandContentRoutes(plan, inventory);
  assert.deepEqual(coverage.contentRoutes, ['/content/publisher/page.article', '/content/publisher/page.article?version=1', '/content/publisher/page.home', '/content/publisher/page.home?version=3']);
  assert.equal(coverage.routes.length, 6);
  assert.throws(() => expandContentRoutes(plan, { agents: [] }), /omits a published agent/);
  assert.throws(() => expandContentRoutes(plan, { agents: [{ agent: 'publisher', state: 'error', cells: [] }] }), /Unreadable/);
  assert.throws(() => expandContentRoutes(plan, { agents: [{ agent: 'publisher', state: 'ready', cells: [] }] }), /coverage is incomplete/);
});

test('new static pages join coverage, unknown dynamic pages and publication drift fail closed', () => {
  const fixture = projectionFixture();
  write(fixture.root, 'studio/app/help/page.tsx', 'Help');
  assert.ok(discoverRoutePlan(fixture.options).routes.includes('/help'));
  write(fixture.root, 'studio/app/projects/[project]/page.tsx', 'Project');
  assert.throws(() => discoverRoutePlan(fixture.options), /Unexpanded App Router route/);
  const drift = projectionFixture();
  write(drift.root, 'clossys/agents/publisher/route-pack/studio.json', JSON.stringify({ routes: [{ path: '/' }] }));
  assert.throws(() => discoverRoutePlan(drift.options), /route pack differ/);
});

async function fixtureServer(t, mutation = '') {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (request.url === '/api/cells') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ agents: [{ agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', version: 3 }] }] })); return; }
    if (request.url === '/missing.png') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    const extra = mutation === 'need' ? '<p>NEED: fixture evidence unavailable</p>'
      : mutation === 'console' ? '<script>console.error("Injected fixture console failure")</script>'
      : mutation === 'defects' ? '<p>[fact:pending] TODO-OWNER page.home</p><h2> </h2><img src="/missing.png">' : '';
    response.end(`<!doctype html><html><head><title>Studio fixture</title><style>body { color: #111; background: #fff } .dark body { color: #fff; background: #111 }</style></head><body><main><h1>Published content</h1><p>Current publication is available.</p><a href="/">Home</a>${extra}</main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
function browserPlan() { return { routes: ['/', '/agents/publisher'], templates: ['/[[...route]]', '/content/[agent]/[id]'], agents: ['publisher'], contentRoute: true }; }
async function proveRejection(t, mutation, rules) {
  const fixture = await fixtureServer(t, mutation), screenshotRoot = directory(`mutation-${mutation}`);
  await assert.rejects(checkStudio({ origin: fixture.origin, plan: browserPlan(), screenshotRoot }), error => {
    assert.equal(error.report.status, 'FAIL');
    assert.equal(error.report.checks.length, 16);
    for (const rule of rules) assert.ok(error.report.checks.every(check => check.findings.some(finding => finding.rule === rule)), `${rule} must fail every route/theme/viewport`);
    const report = JSON.parse(fs.readFileSync(path.join(screenshotRoot, 'report.json'), 'utf8'));
    assert.equal(report.status, 'FAIL');
    return true;
  });
}

test('real Chromium checks all discovered routes in both themes and both viewport sizes and retains screenshots', async t => {
  const fixture = await fixtureServer(t), screenshotRoot = directory('positive');
  const report = await checkStudio({ origin: fixture.origin, plan: browserPlan(), screenshotRoot });
  assert.equal(report.status, 'PASS');
  assert.equal(report.checks.length, 16);
  assert.deepEqual([...new Set(report.checks.map(row => `${row.viewport}/${row.theme}`))].sort(), ['desktop/dark', 'desktop/light', 'mobile/dark', 'mobile/light']);
  assert.ok(fixture.requests.includes('/content/publisher/page.home?version=3'));
  for (const check of report.checks) assert.ok(fs.statSync(path.join(screenshotRoot, check.screenshot)).size > 0);
});

test('mutation proof: injected visible NEED fails the complete Chromium check', async t => {
  await proveRejection(t, 'need', ['need']);
});

test('mutation proof: injected console.error fails the complete Chromium check', async t => {
  await proveRejection(t, 'console', ['console-error']);
});

test('raw identities, unresolved facts, owner placeholders, empty headings and missing assets fail in the browser', async t => {
  await proveRejection(t, 'defects', ['raw-cell-id', 'fact-placeholder', 'owner-placeholder', 'empty-heading', 'missing-asset', 'http-error']);
});

test('CLI rejects ambiguous or unknown options', () => {
  assert.deepEqual(parseArgs(['--origin', 'http://127.0.0.1:4300']), { origin: 'http://127.0.0.1:4300' });
  assert.throws(() => parseArgs(['--routes', '/']), /Usage/);
  assert.throws(() => parseArgs(['--origin', 'http://one', '--origin', 'http://two']), /Usage/);
});
