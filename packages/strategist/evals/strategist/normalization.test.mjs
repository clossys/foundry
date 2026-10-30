import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureRoot } from './capture.mjs';
import { normalizeCapture } from './normalize.mjs';
import { scoreRun } from './score.mjs';
import { serializeCell } from '../../dist/format/cell.js';

// Authored invalid-quality fixture; actual built CLI outputs, never a live interview.
async function actualCapture() {
  const root = mkdtempSync(join(tmpdir(), 'strategy-normalization-'));
  const id = 'focus.segment.core';
  try {
    writeFileSync(join(root, 'tree.json'), JSON.stringify({ schemaVersion: 1, catalog: '@clossys/strategist#strategy-v1', archetype: 'product-saas', core: 'archetype', active: { [id]: 1 } }));
    mkdirSync(join(root, 'cells', id), { recursive: true });
    const bullet = text => ({ text, refs: [], line: 1 });
    writeFileSync(join(root, 'cells', id, 'v1.md'), serializeCell({ id, version: 1, status: 'active', updated: '2026-10-29', cites: [], feeds: [], functions: [], confirmed: { kind: 'msg', session: '2026-10-29-1', line: 'U1' }, direction: [bullet('Synthetic incomplete direction')], because: [], watch: [], path: `cells/${id}/v1.md` }));
    return await captureRoot(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('actual integrated CLI preserves findings, pending judges, full scope and report writes', async () => {
  const capture = await actualCapture();
  assert.equal(capture.normalizationError, undefined);
  const measurements = normalizeCapture(capture);
  assert.deepEqual(measurements.quality, { passed: 0, total: 1, pendingJudge: 1 });
  assert.deepEqual(measurements.files, { passed: 2, total: 2 });
  assert.equal(measurements.completion.pending, true);
  assert.equal(measurements.completion.measured.mvs, false);
  assert.ok(measurements.coherence.hard > 0);
  assert.ok(measurements.coherence.pendingJudge > 0);
  assert.equal(capture.captures[0].exitCode, 1);
  assert.deepEqual(capture.before.hashes, capture.after.hashes);
  assert.match(capture.sourceHead, /^[a-f0-9]{40}$/);
  assert.equal(JSON.parse(capture.captures.at(-1).stdout).result.scope, 'full');
});

test('raw command failure and mismatched evidence never normalize to clean counts', async () => {
  const capture = await actualCapture();
  for (const mutate of [
    c => { c.captures[0].exitCode = 2; },
    c => { c.captures[0].exitCode = null; c.captures[0].signal = 'SIGTERM'; },
    c => { c.captures[0].stdout = 'not JSON'; },
    c => { c.captures[0].stdout = JSON.stringify({ command: 'check', code: 0, result: {} }); },
    c => { c.captures.pop(); },
    c => { c.captures.at(-1).command = c.captures.at(-2).command; },
    c => { c.after.files['tree.json'] += '\n'; },
    c => { c.before.issues.push({ path: 'broken.md', reason: 'invalid-format' }); },
    c => { c.active = []; },
    c => { delete c.sourceHead; },
  ]) {
    const changed = structuredClone(capture); mutate(changed);
    assert.throws(() => normalizeCapture(changed));
  }
});

test('real parser/CLI failure is saved with no normalized measurements', async () => {
  const root = mkdtempSync(join(tmpdir(), 'strategy-normalization-'));
  try {
    writeFileSync(join(root, 'tree.json'), JSON.stringify({ schemaVersion: 1, catalog: '@clossys/strategist#strategy-v1', archetype: 'product-saas', core: 'archetype', active: {} }));
    mkdirSync(join(root, 'sessions'));
    writeFileSync(join(root, 'sessions', 'wrong.md'), 'broken');
    const capture = await captureRoot(root);
    assert.match(capture.normalizationError, /parser issues/);
    assert.equal(capture.measurements, undefined);
    assert.equal(capture.captures.length, 4);
    for (const raw of capture.captures) {
      assert.equal(raw.exitCode, 2);
      assert.equal(JSON.parse(raw.stdout).code, 2);
      assert.equal(typeof raw.stderr, 'string');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Synthetic contract exercise only: session labels below are authored fixture labels.
test('synthetic live-schema contract re-reads raw capture and cannot override pending findings', async () => {
  const capture = await actualCapture();
  const directory = mkdtempSync(join(tmpdir(), 'strategy-score-contract-'));
  try {
    writeFileSync(join(directory, 'capture.json'), JSON.stringify(capture));
    const run = JSON.parse(readFileSync(new URL('./fixtures/passing.json', import.meta.url), 'utf8'));
    run.kind = 'live';
    run.business = 'kilnpad';
    run.provenance = { capture: 'native-session', strategistTier: 'high', userTier: 'mid', strategistSession: 'synthetic-strategist', userSession: 'synthetic-user', sourceHead: capture.sourceHead };
    run.judge.kind = 'fresh-high';
    run.judge.session = 'synthetic-judge';
    run.active = capture.active;
    run.requiredActive = JSON.parse(readFileSync(new URL('./kilnpad/expected.json', import.meta.url), 'utf8')).requiredActive;
    run.violations = [];
    run.measurements.source = 'strategist-check';
    run.measurements.capture = 'capture.json';
    run.measurements.completion = { overclaims: 0, pending: false };
    const result = scoreRun(run, { baseDirectory: directory });
    assert.equal(result.scores['quality-pass-rate'], 0);
    assert.equal(result.scores['completion-honesty'], 1);
    assert.equal(result.scores.coherence, 0);
    assert.equal(result.pass, false);
    run.provenance.sourceHead = '0'.repeat(40);
    assert.throws(() => scoreRun(run, { baseDirectory: directory }), /source head/);
    run.provenance.sourceHead = capture.sourceHead;
    run.active = [];
    assert.throws(() => scoreRun(run, { baseDirectory: directory }), /active set/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
