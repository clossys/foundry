'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ROUTE_MARKER } = require('./check-studio-routes.cjs');
const { initialResource, initialExpectation, initialDataFindings, discoverRoutePlan, expandContentRoutes, checkCommand, parseArgs, browserRuntime } = require('./p0-studio-check.cjs');

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
  write(root, 'studio/app/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/agents/publisher/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/agents/publisher/[slug]/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/content/[agent]/[id]/page.tsx', 'StandaloneCellContent');
  return { root, studio, options: { repositoryRoot: root, studioRoot: studio } };
}
const inventory = { agents: [{ agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', version: 3 }, { id: 'page.article', version: 1 }] }] };

test('checked-in publication and every real App Router route are discovered', () => {
  const plan = discoverRoutePlan();
  assert.ok(plan.routes.includes('/'));
  assert.ok(plan.routes.length > 1);
  assert.deepEqual(plan.templates, ['/', '/%5F_specimen', ...['designer', 'director', 'publisher', 'writer'].flatMap(agent => [`/${agent}`, `/${agent}/[slug]`])].sort(), 'Publisher-installed pages and leaf templates plus query-dependent record transport');
  assert.deepEqual(plan.leafTemplates, ['/designer/[slug]', '/director/[slug]', '/publisher/[slug]', '/writer/[slug]']);
  assert.ok(!plan.routes.includes('/%5F_specimen'), 'record transport needs agent and slot query parameters');
  assert.equal(plan.contentRoute, false, 'the standalone content route is retired');
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
  const unmarked = projectionFixture();
  write(unmarked.root, 'studio/app/agents/publisher/[slug]/page.tsx', 'PublishedPage');
  assert.throws(() => discoverRoutePlan(unmarked.options), /Unexpanded App Router route/);
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
  assert.throws(() => initialExpectation({ kind: 'home', agents: ['writer'] }, { writer: { state: 'error' } }), /unavailable/);
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

test('only the exact record transport page is excluded from static UI coverage', () => {
  const fixture = projectionFixture();
  write(fixture.root, 'studio/app/%5F_specimen/page.tsx', 'Record specimen transport');
  write(fixture.root, 'studio/app/specimen-help/page.tsx', 'Specimen help');
  const plan = discoverRoutePlan(fixture.options);
  assert.ok(!plan.routes.includes('/%5F_specimen'));
  assert.ok(plan.routes.includes('/specimen-help'));
});
