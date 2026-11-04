'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ROUTE_MARKER, readStudioPublication } = require('./check-studio-routes.cjs');
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
  const routes = [{ path: '/' }, { path: '/publisher/studio' }];
  write(root, 'studio/generated/studio-map.json', JSON.stringify({ routes }));
  const publication = { routePack: { routes }, map: { entries: [{ kind: 'page', path: '/', id: 'home' }, { kind: 'group', path: '/publisher', id: 'publisher' }, { kind: 'page', path: '/publisher/studio', id: 'publisher-studio', parentId: 'publisher' }] } };
  write(root, 'studio/app/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/publisher/studio/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/publisher/studio/[slug]/page.tsx', `${ROUTE_MARKER}\nPublishedPage`);
  write(root, 'studio/app/content/[agent]/[id]/page.tsx', 'StandaloneCellContent');
  return { root, studio, publication, options: { repositoryRoot: root, studioRoot: studio, publication } };
}
const inventory = { agents: [{ agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', version: 3 }, { id: 'page.article', version: 1 }] }] };

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
  assert.equal(plan.contentRoute, false, 'the standalone content route is retired');
});

test('coverage expands every live identity and exposed version instead of selecting one dynamic example', async () => {
  const fixture = projectionFixture(), plan = await discoverRoutePlan(fixture.options);
  const coverage = expandContentRoutes(plan, inventory);
  assert.deepEqual(coverage.contentRoutes, ['/content/publisher/page.article', '/content/publisher/page.article?version=1', '/content/publisher/page.home', '/content/publisher/page.home?version=3']);
  assert.equal(coverage.routes.length, 6);
  assert.throws(() => expandContentRoutes(plan, { agents: [] }), /omits a published agent/);
  assert.throws(() => expandContentRoutes(plan, { agents: [{ agent: 'publisher', state: 'error', cells: [] }] }), /Unreadable/);
  assert.throws(() => expandContentRoutes(plan, { agents: [{ agent: 'publisher', state: 'ready', cells: [] }] }), /coverage is incomplete/);
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
