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
const REPORT_EXIT_CODES = Object.freeze({ PASS: 0, FAIL: 1, ENV: 2 });
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
    return await runtime.type.launch(runtime.launch);
  } catch (cause) {
    throw reportError({ check: 'studio:check', status: 'ENV', phase: 'browser-launch', executed: false, browser: runtime?.name ?? options.browserName ?? process.env.STUDIO_BROWSER ?? 'chromium', checks: [], diagnostics: [{ rule: 'browser-unavailable', message: cause instanceof Error ? cause.message : String(cause) }] }, cause);
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
async function runStudioCheck(options = {}) {
  const origin = new URL(options.origin ?? 'http://127.0.0.1:4300').origin;
  const plan = options.plan ?? discoverRoutePlan(options);
  const timeout = options.timeout ?? 15000;
  const screenshotRoot = path.resolve(options.screenshotRoot ?? path.join(repositoryRoot, 'visual-pass/p0'));
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const ownedBrowser = !options.browser;
  const browser = options.browser ?? await launchStudioBrowser(options);
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
      // Firefox supports the mobile viewport but has no Playwright isMobile emulation.
      const emulation = browser.browserType().name() === 'firefox' ? {} : { isMobile: variant.isMobile };
      const context = await browser.newContext({ viewport: variant.viewport, ...emulation, colorScheme: theme });
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
            await page.addInitScript(theme => { try { localStorage.setItem('theme', theme); } catch {} const root = document.documentElement; if (root) { root.classList.toggle('dark', theme === 'dark'); root.dataset.theme = theme; } }, theme);
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
    const report = { check: 'studio:check', status: failures.length ? 'FAIL' : 'PASS', phase: 'render', executed: true, origin, templates: plan.templates, routes: coverage.routes, dynamicContentRoutes: coverage.contentRoutes, versionCoverage: 'all current identities and their version exposed by /api/cells; historical versions are not enumerated by that API', checks };
    fs.writeFileSync(path.join(screenshotRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
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
    const output = path.resolve(options.screenshotRoot ?? path.join(repositoryRoot, 'visual-pass/p0'));
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
module.exports = { discoverRoutePlan, expandContentRoutes, inspectPage, screenshotName, checkStudio, checkCommand, parseArgs, failureReport, reportError, REPORT_EXIT_CODES, browserRuntime, launchStudioBrowser, probeBrowser };
if (require.main === module) Promise.resolve().then(() => checkCommand(parseArgs(process.argv.slice(2)))).then(({ exitCode, report }) => { console.log(JSON.stringify(report, null, 2)); process.exitCode = exitCode; }).catch(error => { const report = failureReport(error); console.error(JSON.stringify(report, null, 2)); process.exitCode = REPORT_EXIT_CODES[report.status] ?? 1; });
