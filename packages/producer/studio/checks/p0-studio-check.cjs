#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '../../..');
const variants = Object.freeze([
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
]);
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
/** All publication maps must agree; a newly introduced dynamic route needs an explicit expander. */
function discoverRoutePlan(options = {}) {
  const root = options.studioRoot ?? studioRoot;
  const repository = options.repositoryRoot ?? repositoryRoot;
  const projection = readJson(path.join(root, 'generated/studio-map.json'));
  const pack = readJson(path.join(repository, 'clossys/agents/publisher/route-pack/studio.json'));
  const content = readJson(path.join(repository, 'clossys/agents/publisher/content-map/studio.json'));
  const routes = canonical(projection.routes.map(row => row.path), 'Studio projection');
  assert.deepEqual(routes, canonical(pack.routes.map(row => row.path), 'Publisher route pack'), 'Studio route projection and route pack differ');
  assert.deepEqual(routes, canonical(content.entries.filter(row => row.kind === 'page').map(row => row.path), 'Publisher content map'), 'Studio route projection and content map differ');
  const pages = appPages(path.join(root, 'app'));
  const templates = pages.map(page => page.template);
  const represented = new Set();
  let contentRoute = false;
  for (const page of pages) {
    const source = fs.readFileSync(page.file, 'utf8');
    if (page.template === '/[[...route]]') {
      assert.match(source, /studioRouteForSegments/, 'The publication catchall no longer uses the discovered route projection');
      for (const route of routes) represented.add(route);
    } else if (page.template === '/content/[agent]/[id]') {
      assert.match(source, /(?:cellContentHref|StandaloneCellContent)/, 'The content route no longer uses the known content port');
      contentRoute = true;
    } else if (page.template.includes('[') || page.template.includes('@')) {
      throw new Error(`Unexpanded App Router route: ${page.template}`);
    } else represented.add(page.template);
  }
  for (const route of routes) assert.ok(represented.has(route), `Published route has no App Router page: ${route}`);
  const agents = content.entries.filter(row => row.kind === 'page' && row.parentId === 'agents').map(row => row.id).sort();
  assert.equal(new Set(agents).size, agents.length, 'Duplicate agent identities in content map');
  return { routes: [...represented].sort(), templates: templates.sort(), agents, contentRoute };
}
/** The live resource index expands dynamic content identities and their exposed version. */
function expandContentRoutes(plan, inventory) {
  if (!plan.contentRoute) return { routes: plan.routes, cellIds: [], contentRoutes: [] };
  assert.ok(inventory && Array.isArray(inventory.agents), 'Missing live cell index for dynamic route coverage');
  const seenAgents = new Set(), contentRoutes = [], cellIds = [];
  for (const entry of inventory.agents) {
    assert.ok(plan.agents.includes(entry.agent) && !seenAgents.has(entry.agent), 'Unknown or repeated agent in live content index');
    seenAgents.add(entry.agent);
    assert.ok(['ready', 'missing'].includes(entry.state) && Array.isArray(entry.cells), `Unreadable content index for ${entry.agent}`);
    assert.ok(entry.state === 'ready' || entry.cells.length === 0, 'Missing agent reports content');
    const seenCells = new Set();
    for (const cell of entry.cells) {
      assert.ok(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2}$/.test(cell.id) && !seenCells.has(cell.id), 'Invalid or repeated live cell identity');
      assert.ok(Number.isSafeInteger(cell.version) && cell.version > 0, 'Invalid live cell version');
      seenCells.add(cell.id); cellIds.push(cell.id);
      const base = `/content/${encodeURIComponent(entry.agent)}/${encodeURIComponent(cell.id)}`;
      contentRoutes.push(base, `${base}?version=${cell.version}`);
    }
  }
  assert.deepEqual([...seenAgents].sort(), plan.agents, 'Live cell index omits a published agent');
  assert.ok(contentRoutes.length, 'Dynamic content route has no real content examples; coverage is incomplete');
  return { routes: [...new Set([...plan.routes, ...contentRoutes])].sort(), cellIds: [...new Set(cellIds)].sort(), contentRoutes: contentRoutes.sort() };
}

// Serialized directly into Playwright. Keep browser globals inside this function.
function inspectPage(cellIds) {
  const findings = [], text = document.body?.innerText ?? '';
  for (const [rule, expression] of [['need', /\bNEED\b/], ['fact-placeholder', /\[fact:/i], ['owner-placeholder', /TODO-OWNER/]]) {
    if (expression.test(text)) findings.push({ rule });
  }
  const tokens = new Set(text.match(/[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,2}/g) ?? []);
  const rawIds = [...new Set([...cellIds.filter(id => tokens.has(id)), ...[...tokens].filter(id => /^(?:assets|components|sections|foundations|context|page|plan|specimen|surface|system|tokens)\./.test(id))])];
  if (rawIds.length) findings.push({ rule: 'raw-cell-id', ids: rawIds });
  const visible = element => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible);
  if (!headings.length) findings.push({ rule: 'missing-heading' });
  for (const element of headings) if (!(element.innerText || element.getAttribute('aria-label') || '').trim()) findings.push({ rule: 'empty-heading', tag: element.localName });
  for (const image of document.images) if (!image.complete || image.naturalWidth === 0) findings.push({ rule: 'missing-asset', src: image.getAttribute('src') });
  return { findings, headingCount: headings.length, links: [...document.querySelectorAll('a[href]')].map(element => element.href) };
}
function screenshotName(route, variant, theme) {
  const digest = createHash('sha256').update(route).digest('hex').slice(0, 10);
  return `${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100) || 'home'}-${digest}-${variant}-${theme}.png`;
}
async function settle(page, pending, timeout) {
  const deadline = Date.now() + timeout;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (pending.size) quietSince = Date.now();
    else if (Date.now() - quietSince >= 350) {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error('Page resource requests did not settle before timeout');
}
async function checkStudio(options = {}) {
  const origin = new URL(options.origin ?? 'http://127.0.0.1:4300').origin;
  const plan = options.plan ?? discoverRoutePlan(options);
  const timeout = options.timeout ?? 15000;
  const screenshotRoot = path.resolve(options.screenshotRoot ?? path.join(repositoryRoot, 'visual-pass/p0'));
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const { chromium } = require('playwright');
  const launch = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  else if (fs.existsSync('/usr/bin/chromium')) launch.executablePath = '/usr/bin/chromium';
  const browser = await chromium.launch(launch);
  const checks = [], failures = [];
  try {
    let inventory;
    if (plan.contentRoute) {
      const request = await browser.newContext();
      try {
        const response = await request.request.get(`${origin}/api/cells`, { timeout });
        assert.equal(response.status(), 200, 'Live content index HTTP status');
        inventory = await response.json();
      } finally { await request.close(); }
    }
    const coverage = expandContentRoutes(plan, inventory);
    const expectedPaths = new Set(coverage.routes.map(route => new URL(route, origin).pathname));
    for (const variant of variants) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: variant.viewport, isMobile: variant.isMobile, colorScheme: theme });
      try {
        for (const route of coverage.routes) {
          const page = await context.newPage(), errors = [], pending = new Set();
          page.setDefaultTimeout(timeout);
          page.on('console', message => { if (message.type() === 'error') errors.push({ rule: 'console-error', message: message.text() }); });
          page.on('pageerror', error => errors.push({ rule: 'page-error', message: error.message }));
          page.on('response', response => { if (response.status() >= 400) errors.push({ rule: 'http-error', status: response.status(), url: response.url() }); });
          const tracked = request => !['eventsource', 'websocket'].includes(request.resourceType()) && !/\/api\/events(?:\?|$)/.test(request.url());
          page.on('request', request => { if (tracked(request)) pending.add(request); });
          page.on('requestfinished', request => pending.delete(request));
          page.on('requestfailed', request => { pending.delete(request); errors.push({ rule: 'request-failed', url: request.url(), message: request.failure()?.errorText }); });
          let audit = { findings: [] };
          try {
            // Native color-scheme consumers and common class/data consumers receive the same mode.
            await page.addInitScript(theme => { try { localStorage.setItem('theme', theme); } catch {} document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.dataset.theme = theme; }, theme);
            const response = await page.goto(origin + route, { waitUntil: 'load', timeout });
            if (response?.status() !== 200) errors.push({ rule: 'route-status', status: response?.status() ?? null });
            if (page.url() !== origin + route) errors.push({ rule: 'unexpected-redirect', url: page.url() });
            await settle(page, pending, timeout);
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.dataset.theme = theme; }, theme);
            audit = await page.evaluate(inspectPage, coverage.cellIds);
            for (const href of audit.links ?? []) {
              const target = new URL(href);
              if (target.origin === origin && !target.pathname.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(target.pathname) && !expectedPaths.has(target.pathname)) errors.push({ rule: 'uncovered-linked-route', path: target.pathname });
            }
          } catch (error) { errors.push({ rule: 'navigation-error', message: error.message }); }
          const screenshot = screenshotName(route, variant.name, theme);
          try { await page.screenshot({ path: path.join(screenshotRoot, screenshot), fullPage: true, timeout }); }
          catch (error) { errors.push({ rule: 'screenshot-error', message: error.message }); }
          const result = { route, viewport: variant.name, theme, screenshot, findings: [...audit.findings, ...errors] };
          checks.push(result);
          if (result.findings.length) failures.push(result);
          await page.close();
        }
      } finally { await context.close(); }
    }
    const report = { check: 'studio:check', status: failures.length ? 'FAIL' : 'PASS', origin, templates: plan.templates, routes: coverage.routes, dynamicContentRoutes: coverage.contentRoutes, versionCoverage: 'all current identities and their version exposed by /api/cells; historical versions are not enumerated by that API', checks };
    fs.writeFileSync(path.join(screenshotRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (failures.length) {
      const error = new Error(`studio:check failed in ${failures.length}/${checks.length} route/theme/viewport checks: ${[...new Set(failures.flatMap(check => check.findings.map(finding => finding.rule)))].join(', ')}`);
      error.report = report;
      throw error;
    }
    return report;
  } finally { await browser.close(); }
}
function parseArgs(args) {
  const options = {};
  const flags = new Map([['--origin', 'origin'], ['--screenshots', 'screenshotRoot'], ['--studio-root', 'studioRoot'], ['--repository-root', 'repositoryRoot']]);
  for (let index = 0; index < args.length; index++) {
    const name = flags.get(args[index]);
    if (!name || !args[index + 1] || args[index + 1].startsWith('--') || options[name]) throw new Error('Usage: studio:check [--origin URL] [--screenshots DIRECTORY] [--studio-root DIRECTORY] [--repository-root DIRECTORY]');
    options[name] = args[++index];
  }
  return options;
}
module.exports = { discoverRoutePlan, expandContentRoutes, inspectPage, screenshotName, checkStudio, parseArgs };
if (require.main === module) checkStudio(parseArgs(process.argv.slice(2))).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(JSON.stringify({ status: 'FAIL', message: error.message, ...(error.report ? { failures: error.report.checks.filter(check => check.findings.length) } : {}) }, null, 2)); process.exitCode = 1; });
