#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { checkCommand, probeBrowser, failureReport, REPORT_EXIT_CODES } = require('./p0-studio-check.cjs');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const plan = { routes: ['/', '/designer', '/publisher', '/writer'], templates: ['/', '/designer', '/publisher', '/publisher/[slug]', '/writer'], leafTemplates: ['/publisher/[slug]'], agents: ['publisher'] };
// raw-cell-id is a report-mode rule (studio-check-gates.json): it must be listed under reports, never fail.
const defectRules = ['fact-placeholder', 'owner-placeholder', 'empty-heading', 'missing-asset', 'http-error'];
async function fixtureServer() {
  const requests = [];
  let mutation = '';
  const hanging = new Set();
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    // /hang never answers (its fetch is aborted); /slow answers after a delay, so an abort can be retried.
    if (request.url === '/hang') { hanging.add(response); return; }
    if (request.url === '/slow') { setTimeout(() => { response.setHeader('Content-Type', 'text/plain'); response.end('ok'); }, 300); return; }
    if (request.url === '/missing.png') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    const extra = mutation === 'need' ? '<p>NEED: fixture evidence unavailable</p>'
      : mutation === 'console' ? '<script>console.error("Injected fixture console failure")</script>'
      : mutation === 'pageerror' ? '<script>throw new TypeError("Injected page TypeError")</script>'
      : mutation === 'defects' ? '<p>[fact:pending] TODO-OWNER page.home</p><h2> </h2><img src="/missing.png">'
      : mutation === 'rawid' ? '<p>Open page.home to review it.</p>'
      : mutation === 'abort' ? '<script>const c = new AbortController(); fetch("/hang", { signal: c.signal }).catch(() => {}); setTimeout(() => c.abort(), 100);</script>'
      : mutation === 'reload' ? '<script>const c = new AbortController(); fetch("/slow", { signal: c.signal }).catch(() => {}); setTimeout(() => { c.abort(); fetch("/slow"); }, 100);</script>' : '';
    response.end(`<!doctype html><html><head><title>Studio fixture</title><style>body { color: #111; background: #fff } .dark body { color: #fff; background: #111 }</style></head><body><main><h1>Published content</h1><p>Current publication is available.</p><p>Example: a card that says NEED rather than guessing.</p><a href="/">Home</a>${extra}</main></body></html>`);
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, requests,
    mutate: value => { mutation = value; },
    close: () => { for (const response of hanging) response.destroy(); return new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); },
  };
}
/** A report-mode rule passes the run and is listed under every check's reports. */
function assertReported(result, rules) {
  assert.equal(result.exitCode, 0, 'A report-mode finding must not fail the run');
  assert.equal(result.report.status, 'PASS');
  assert.equal(result.report.checks.length, 16, 'Every fixture route/theme/viewport must execute');
  for (const rule of rules) {
    assert.ok(result.report.checks.every(check => check.reports?.some(finding => finding.rule === rule) && !check.findings.some(finding => finding.rule === rule)), `${rule} must be reported on every route/theme/viewport`);
    assert.equal(result.report.reportCounts?.[rule], 16, `${rule} must appear in the run's reports for every check`);
  }
}
function assertMutation(result, rules) {
  assert.equal(result.exitCode, 1, 'A detected mutation must return CLI exit 1; ENV is not mutation evidence');
  assert.equal(result.report.status, 'FAIL');
  assert.equal(result.report.checks.length, 16, 'Every fixture route/theme/viewport must execute');
  for (const rule of rules) assert.ok(result.report.checks.every(check => check.findings.some(finding => finding.rule === rule)), `${rule} must fail every route/theme/viewport`);
}
/** A failing run still lists its report-mode findings. */
function assertReportedOn(result, rules) {
  for (const rule of rules) assert.ok(result.report.checks.every(check => check.reports?.some(finding => finding.rule === rule) && !check.findings.some(finding => finding.rule === rule)), `${rule} must be reported, not failed, on every route/theme/viewport`);
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
    assert.ok(plan.routes.every(route => fixture.requests.includes(route)), 'Every fixture route must be requested');
    const results = [];
    for (const [mutation, rules] of [['need', ['need']], ['console', ['console-error']], ['pageerror', ['page-error']], ['defects', defectRules], ['abort', ['request-failed']]]) {
      fixture.mutate(mutation);
      const result = await checkCommand({ origin: fixture.origin, browser, plan, screenshotRoot: path.join(output, mutation) });
      assertMutation(result, rules);
      results.push({ mutation, expectedExitCode: 1, actualExitCode: result.exitCode, checks: result.report.checks.length, rules });
      if (mutation === 'defects') assertReportedOn(result, ['raw-cell-id']);
    }
    for (const [mutation, rules] of [['rawid', ['raw-cell-id']], ['reload', ['aborted-reload']]]) {
      fixture.mutate(mutation);
      const result = await checkCommand({ origin: fixture.origin, browser, plan, screenshotRoot: path.join(output, mutation) });
      assertReported(result, rules);
      results.push({ mutation, expectedExitCode: 0, actualExitCode: result.exitCode, checks: result.report.checks.length, reported: rules });
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
module.exports = { fixtureServer, assertMutation, assertReported, runMutationProof, parseArgs };
if (require.main === module) Promise.resolve().then(() => runMutationProof(parseArgs(process.argv.slice(2)))).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { const report = failureReport(error); console.error(JSON.stringify(report, null, 2)); process.exitCode = REPORT_EXIT_CODES[report.status] ?? 1; });
