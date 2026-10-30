#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { checkCommand, probeBrowser, failureReport, REPORT_EXIT_CODES } = require('./p0-studio-check.cjs');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const plan = { routes: ['/', '/agents/publisher'], templates: ['/[[...route]]', '/content/[agent]/[id]'], agents: ['publisher'], contentRoute: true };
const defectRules = ['raw-cell-id', 'fact-placeholder', 'owner-placeholder', 'empty-heading', 'missing-asset', 'http-error'];
async function fixtureServer() {
  const requests = [];
  let mutation = '';
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (request.url === '/api/cells') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ agents: [{ agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', version: 3 }] }] })); return; }
    if (request.url === '/missing.png') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    const extra = mutation === 'need' ? '<p>NEED: fixture evidence unavailable</p>'
      : mutation === 'console' ? '<script>console.error("Injected fixture console failure")</script>'
      : mutation === 'pageerror' ? '<script>throw new TypeError("Injected page TypeError")</script>'
      : mutation === 'defects' ? '<p>[fact:pending] TODO-OWNER page.home</p><h2> </h2><img src="/missing.png">' : '';
    response.end(`<!doctype html><html><head><title>Studio fixture</title><style>body { color: #111; background: #fff } .dark body { color: #fff; background: #111 }</style></head><body><main><h1>Published content</h1><p>Current publication is available.</p><a href="/">Home</a>${extra}</main></body></html>`);
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, requests,
    mutate: value => { mutation = value; },
    close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())),
  };
}
function assertMutation(result, rules) {
  assert.equal(result.exitCode, 1, 'A detected mutation must return CLI exit 1; ENV is not mutation evidence');
  assert.equal(result.report.status, 'FAIL');
  assert.equal(result.report.checks.length, 16, 'Every fixture route/theme/viewport must execute');
  for (const rule of rules) assert.ok(result.report.checks.every(check => check.findings.some(finding => finding.rule === rule)), `${rule} must fail every route/theme/viewport`);
}
/** One preflight/browser instance serves the baseline and every injected mutation. */
async function runMutationProof(options = {}) {
  const output = path.resolve(options.output ?? path.join(repositoryRoot, 'visual-pass/p0/mutation-proof'));
  fs.mkdirSync(output, { recursive: true });
  let browser, fixture;
  try {
    const probed = await (options.probe ?? probeBrowser)(options);
    browser = probed.browser;
    fixture = await fixtureServer();
    const baseline = await checkCommand({ origin: fixture.origin, browser, plan, screenshotRoot: path.join(output, 'baseline') });
    assert.equal(baseline.exitCode, 0, 'The unmutated fixture must pass before mutation evidence is accepted');
    assert.equal(baseline.report.checks.length, 16);
    assert.ok(fixture.requests.includes('/content/publisher/page.home?version=3'));
    const results = [];
    for (const [mutation, rules] of [['need', ['need']], ['console', ['console-error']], ['pageerror', ['page-error']], ['defects', defectRules]]) {
      fixture.mutate(mutation);
      const result = await checkCommand({ origin: fixture.origin, browser, plan, screenshotRoot: path.join(output, mutation) });
      assertMutation(result, rules);
      results.push({ mutation, expectedExitCode: 1, actualExitCode: result.exitCode, checks: result.report.checks.length, rules });
    }
    const report = { check: 'studio:mutation-proof', status: 'PASS', executed: true, browserProbe: probed.report, baselineExitCode: baseline.exitCode, results };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) {
    const cause = failureReport(error);
    const report = { check: 'studio:mutation-proof', status: cause.status === 'ENV' ? 'ENV' : 'FAIL', executed: false, phase: cause.phase ?? 'mutation-proof', results: [], diagnostics: cause.diagnostics ?? [{ rule: 'mutation-proof', message: error.message }] };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    error.report = report;
    throw error;
  } finally {
    if (fixture) await fixture.close();
    if (browser) await browser.close();
  }
}
function parseArgs(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--output' && !args[1].startsWith('--')) return { output: args[1] };
  throw new Error('Usage: studio:mutation-proof [--output DIRECTORY]');
}
module.exports = { fixtureServer, assertMutation, runMutationProof, parseArgs };
if (require.main === module) Promise.resolve().then(() => runMutationProof(parseArgs(process.argv.slice(2)))).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { const report = failureReport(error); console.error(JSON.stringify(report, null, 2)); process.exitCode = REPORT_EXIT_CODES[report.status] ?? 1; });
