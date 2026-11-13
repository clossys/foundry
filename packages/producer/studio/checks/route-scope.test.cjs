'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { studioCheckMatrix, routeInputs, changedRoutes, changedFirst, isDesignerSlotRoute } = require('./route-scope.cjs');
const { checkCommand, inspectPage } = require('./p0-studio-check.cjs');

const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'route-scope-'));
after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));

/** A fixture repository: two Designer slot leaves, one Writer leaf, a Home and two tab pages. */
function fixture() {
  const root = fs.mkdtempSync(path.join(evidenceRoot, 'repo-'));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  for (const [agent, slot] of [['designer', 'frames.shell'], ['designer', 'sections.groups'], ['designer', 'themes.x'], ['designer', 'themes.y'], ['writer', 'strings.hello']]) {
    write(`clossys/agents/${agent}/${slot}/pin.json`, JSON.stringify({ candidate: `${slot}-v1.json` }));
    write(`clossys/agents/${agent}/${slot}/candidates/${slot}-v1.json`, JSON.stringify({ slot, version: 1 }));
  }
  write('packages/producer/studio/app/page.tsx', 'export default () => null;\n');
  const page = (id, pathname, loader) => ({ id, path: pathname, frameId: 'frames.shell', sectionIds: ['sections.groups'], data: { loader } });
  const map = {
    pages: [page('home', '/', 'home'), page('designer-themes.colors', '/designer/themes/colors', 'slot-groups'), page('writer-strings', '/writer/strings', 'slot-groups')],
    routes: [{ path: '/', instanceId: 'home' }, { path: '/designer/themes/colors', instanceId: 'designer-themes.colors' }, { path: '/writer/strings', instanceId: 'writer-strings' }],
    leaves: [
      { page: 'designer-themes.colors', slug: 'themes.x', path: '/designer/themes/colors/themes.x' },
      { page: 'designer-themes.colors', slug: 'themes.y', path: '/designer/themes/colors/themes.y' },
      { page: 'writer-strings', slug: 'strings.hello', path: '/writer/strings/strings.hello' },
    ],
    landings: {},
  };
  write('packages/producer/studio/generated/studio-map.json', JSON.stringify(map));
  return { root, map, write, routes: [...map.routes.map(row => row.path), ...map.leaves.map(row => row.path)], leaves: map.leaves.map(row => row.path) };
}
const variants = [{ name: 'desktop' }, { name: 'mobile' }];

test('studio:check renders every route once at desktop light and Designer slot pages in all four variants', () => {
  const { routes, leaves } = fixture();
  const matrix = studioCheckMatrix(routes, { leaves, variants });
  // 6 routes once + 2 Designer slot pages x 3 further variants.
  assert.equal(matrix.length, 6 + 2 * 3);
  for (const route of routes) {
    const rows = matrix.filter(job => job.route === route);
    assert.equal(rows.length, isDesignerSlotRoute(route, new Set(leaves)) ? 4 : 1, route);
    assert.deepEqual([rows[0].variant.name, rows[0].theme], ['desktop', 'light']);
  }
  // The Writer leaf is a slot page, but not a Designer one.
  assert.equal(matrix.filter(job => job.route === '/writer/strings/strings.hello').length, 1);
  assert.equal(studioCheckMatrix(routes, { leaves, variants, full: true }).length, 6 * 4);
});

test('a change to one candidate selects only the routes that use it', () => {
  const { root, map, write, routes } = fixture();
  const before = routeInputs({ repositoryRoot: root, map });
  assert.deepEqual(changedRoutes(before, before, routes), { all: false, reason: 'inputs compared with the last green run', changed: [] });
  write('clossys/agents/designer/themes.x/candidates/themes.x-v2.json', JSON.stringify({ slot: 'themes.x', version: 2 }));
  const changed = changedRoutes(routeInputs({ repositoryRoot: root, map }), before, routes);
  // Its leaf, the tab that shows its card, and Home (which counts every slot).
  assert.deepEqual(changed, { all: false, reason: 'inputs compared with the last green run', changed: ['/', '/designer/themes/colors', '/designer/themes/colors/themes.x'] });
  assert.deepEqual(changedFirst(routes, changed.changed).slice(0, 3), changed.changed);
});

test('a frame, build or checker change, or no green run, selects every route', () => {
  const { root, map, write, routes } = fixture();
  const before = routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] });
  assert.equal(changedRoutes(before, undefined, routes).all, true);
  write('clossys/agents/designer/frames.shell/candidates/frames.shell-v2.json', '{}');
  assert.deepEqual(changedRoutes(routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] }), before, routes), { all: true, reason: 'frame changed', changed: routes });
  const framed = routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] });
  write('packages/producer/studio/app/page.tsx', 'export default () => "changed";\n');
  assert.deepEqual(changedRoutes(routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] }), framed, routes), { all: true, reason: 'build changed', changed: routes });
  const built = routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] });
  write('checker.js', '1');
  assert.equal(changedRoutes(routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] }), built, routes).reason, 'checker changed');
  // Build output and the ignored compile lock are not build inputs.
  const settled = routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] });
  write('packages/producer/studio/.next/BUILD_ID', 'random');
  write('packages/producer/studio/compile.lock.json', '{}');
  assert.equal(changedRoutes(routeInputs({ repositoryRoot: root, map, checker: ['checker.js'] }), settled, routes).all, false);
});

/** A browser double: every page loads; `crash` routes raise a page error. */
function fakeBrowser(origin, crash = new Set()) {
  const renders = [];
  return {
    renders,
    browserType: () => ({ name: () => 'chromium' }),
    async newContext(options) {
      return {
        async close() {},
        async newPage() {
          const handlers = {}; let url = 'about:blank';
          return {
            on(event, fn) { (handlers[event] ??= []).push(fn); },
            setDefaultTimeout() {}, async addInitScript() {}, async waitForTimeout(ms) { await new Promise(done => setTimeout(done, Math.min(ms, 5))); },
            async goto(target) { url = target; renders.push({ route: target.slice(origin.length), width: options.viewport.width, theme: options.colorScheme }); if (crash.has(target.slice(origin.length))) for (const fn of handlers.pageerror ?? []) fn(new Error('boom')); return { status: () => 200 }; },
            url: () => url,
            async evaluate(fn) { return fn === inspectPage ? { findings: [], text: 'Studio', leafTexts: [], headingCount: 1, links: [] } : undefined; },
            locator: () => ({ count: async () => 0 }),
            async screenshot() {}, async close() {},
          };
        },
      };
    },
  };
}

test('studio:check renders the scoped matrix, changed routes first, and logs the first crash at once', async () => {
  const { root, routes, leaves, write } = fixture();
  const origin = 'http://127.0.0.1:1';
  const plan = { routes: routes.filter(route => !leaves.includes(route)), leafRoutes: leaves, leaves, templates: ['/'], landings: {} };
  const options = { origin, plan, gates: {}, timeout: 2000, studioRoot: path.join(root, 'packages/producer/studio'), repositoryRoot: root, screenshotRoot: path.join(root, 'shots') };
  const green = fakeBrowser(origin);
  const passed = await checkCommand({ ...options, browser: green });
  assert.equal(passed.exitCode, 0);
  assert.equal(green.renders.length, 12);
  assert.equal(passed.report.matrix.renders, 12);
  assert.deepEqual(passed.report.matrix.designerSlotRoutes, ['/designer/themes/colors/themes.x', '/designer/themes/colors/themes.y']);
  const full = fakeBrowser(origin);
  assert.equal((await checkCommand({ ...options, browser: full, full: true })).report.checks.length, 24);
  // One candidate changes: its routes run first; a crash is logged once, and the run still completes.
  write('clossys/agents/writer/strings.hello/candidates/strings.hello-v2.json', '{}');
  const lines = [], crashing = fakeBrowser(origin, new Set(['/writer/strings', '/writer/strings/strings.hello']));
  const failed = await checkCommand({ ...options, browser: crashing, log: line => lines.push(line) });
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(crashing.renders.slice(0, 3).map(row => row.route), ['/', '/writer/strings', '/writer/strings/strings.hello']);
  assert.equal(crashing.renders.length, 12);
  assert.deepEqual(lines, ['studio:check FIRST-FAILURE /writer/strings desktop light: page-error (continuing)']);
  assert.equal(failed.report.checks.filter(check => check.findings.length).length, 2);
});
