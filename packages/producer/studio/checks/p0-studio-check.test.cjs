'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { discoverRoutePlan, expandContentRoutes, checkCommand, parseArgs, browserRuntime } = require('./p0-studio-check.cjs');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const evidenceRoot = path.join(repositoryRoot, 'tmp/p0b-resume/browser/unit');
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

test('browser launch failure has a structured ENV envelope and never retries', async () => {
  let launches = 0;
  const screenshotRoot = directory('environment');
  const playwright = { chromium: { executablePath: () => 'uninstalled-browser', launch: async () => { launches++; throw new Error('Fixture browser launch unavailable'); } } };
  const result = await checkCommand({ playwright, plan: { routes: ['/'], templates: ['/'], contentRoute: false }, screenshotRoot });
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
