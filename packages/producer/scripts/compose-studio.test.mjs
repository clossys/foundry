import test from 'node:test';
import assert from 'node:assert/strict';
import { composeStudio } from './compose-studio.mjs';

test('real render output decides readiness while legacy failed findings and statuses remain visible', async () => {
  let args;
  const processReport = { ok: false, exitStatus: 2, mode: 'studio-report-only', gates: [{ gate: 'PROC-2', exitStatus: 2, blocking: false, report: { violations: ['S2 absent'] } }] };
  const report = await composeStudio([], { run: (_node, argv) => { args = argv; return { status: 0, stdout: JSON.stringify(processReport) }; }, selectionApi: { studioSelection: async () => ({ runtimeUrl: '/api/selection/runtime.js?hash=actual', gateReports: [{ gate: 'S8', blocking: false, message: 'unqualified' }] }) } });
  assert.ok(args.includes('--studio'));
  assert.equal(report.ready, true);
  assert.deepEqual(report.processReport, processReport);
  assert.equal(report.selection.gateReports[0].blocking, false);
});

test('an actual unavailable render stays red and a missing module is never replaced with fake output', async () => {
  const run = () => ({ error: new Error('Legacy report launch unavailable'), stderr: 'spawn failure' });
  const report = await composeStudio([], { run, selectionApi: { studioSelection: async () => ({ message: 'Actual renderer source missing', leaves: [] }) } });
  assert.equal(report.ready, false);
  assert.equal(report.processReport.blocking, false);
  assert.match(report.processReport.message, /launch unavailable/);
  await assert.rejects(composeStudio([], { run, selectionApi: { studioSelection: async () => { throw new Error('Cannot find actual-renderer'); } } }), /Cannot find actual-renderer/);
});
