'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { reportError } = require('./p0-studio-check.cjs');
const { assertMutation, runMutationProof, parseArgs } = require('./p0-studio-mutations.cjs');

const evidenceRoot = path.resolve(__dirname, '../../../../tmp/p0b-resume/browser/unit');
fs.mkdirSync(evidenceRoot, { recursive: true });
test('proof requires nonzero detection on every fixture route/theme/viewport', () => {
  const report = { status: 'FAIL', checks: Array.from({ length: 16 }, () => ({ findings: [{ rule: 'need' }] })) };
  assert.doesNotThrow(() => assertMutation({ exitCode: 1, report }, ['need']));
  assert.throws(() => assertMutation({ exitCode: 0, report: { status: 'PASS', checks: [] } }, ['need']), /CLI exit 1/);
  assert.throws(() => assertMutation({ exitCode: 2, report: { status: 'ENV', checks: [] } }, ['need']), /ENV is not mutation evidence/);
  assert.throws(() => assertMutation({ exitCode: 1, report: { ...report, checks: report.checks.slice(1) } }, ['need']), /Every fixture route/);
  assert.throws(() => assertMutation({ exitCode: 1, report }, ['console-error']), /console-error must fail/);
});
test('an unavailable preflight produces ENV without executing mutation cases or another launch', async () => {
  let probes = 0;
  const output = fs.mkdtempSync(path.join(evidenceRoot, 'mutation-environment-'));
  await assert.rejects(runMutationProof({ output, probe: async () => {
    probes++;
    throw reportError({ status: 'ENV', phase: 'browser-launch', executed: false, checks: [], diagnostics: [{ rule: 'browser-unavailable', message: 'Fixture runtime unavailable' }] });
  } }), error => {
    assert.equal(error.report.status, 'ENV');
    assert.equal(error.report.executed, false);
    assert.deepEqual(error.report.results, []);
    assert.equal(error.report.diagnostics[0].message, 'Fixture runtime unavailable');
    return true;
  });
  assert.equal(probes, 1);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.equal(report.status, 'ENV');
  assert.deepEqual(fs.readdirSync(output), ['report.json']);
});
test('mutation CLI accepts only an explicit output directory', () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(['--output', 'visual-pass/p0/proof']), { output: 'visual-pass/p0/proof' });
  assert.throws(() => parseArgs(['--origin', 'http://127.0.0.1:4300']), /Usage/);
});
