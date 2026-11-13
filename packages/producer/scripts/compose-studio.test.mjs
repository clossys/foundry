import test from 'node:test';
import assert from 'node:assert/strict';
import { composeStudio } from './compose-studio.mjs';

const passing = { gate: 'designer-process', ok: true, exitStatus: 0, gates: [{ gate: 'PROC-1', exitStatus: 0, report: { violations: [] } }] };

// Fake-gates audit row 12: compose read the process report but always went on, so a red process gate never stopped it.
test('a red process gate refuses composition and compiles no selection', async () => {
  let args, compiled = false;
  const processReport = { ok: false, exitStatus: 2, gates: [{ gate: 'PROC-1', exitStatus: 0 }, { gate: 'PROC-2', exitStatus: 2, report: { violations: ['S2 absent'] } }] };
  const report = await composeStudio([], { run: (_node, argv) => { args = argv; return { status: 2, stdout: JSON.stringify(processReport) }; }, selectionApi: { studioSelection: async () => { compiled = true; return { runtimeUrl: '/api/selection/runtime.js?hash=actual' }; } } });
  assert.ok(args.includes('--studio'));
  assert.equal(report.ready, false);
  assert.equal(report.processExit, 2);
  assert.match(report.refused, /PROC-2 exit 2/);
  assert.deepEqual(report.processReport, processReport);
  assert.equal(report.selection, undefined);
  assert.equal(compiled, false);
});

test('an exit 0 with a report that is not ok, or an unreadable report, still refuses', async () => {
  const selectionApi = { studioSelection: async () => { throw new Error('must not compile'); } };
  const notOk = await composeStudio([], { run: () => ({ status: 0, stdout: JSON.stringify({ ...passing, ok: false }) }), selectionApi });
  assert.equal(notOk.ready, false);
  const unreadable = await composeStudio([], { run: () => ({ status: 0, stdout: 'not json' }), selectionApi });
  assert.equal(unreadable.ready, false);
  assert.equal(unreadable.processReport.state, 'unavailable');
  const launch = await composeStudio([], { run: () => ({ error: new Error('Process gate launch unavailable'), stderr: 'spawn failure' }), selectionApi });
  assert.equal(launch.ready, false);
  assert.equal(launch.processExit, 2);
  assert.match(launch.processReport.message, /launch unavailable/);
});

test('verified process gates let the real render decide readiness; a missing module is never faked', async () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(passing) });
  const ready = await composeStudio([], { run, selectionApi: { studioSelection: async () => ({ runtimeUrl: '/api/selection/runtime.js?hash=actual', gateReports: [] }) } });
  assert.equal(ready.ready, true);
  assert.equal(ready.processExit, 0);
  const absent = await composeStudio([], { run, selectionApi: { studioSelection: async () => ({ message: 'Actual renderer source missing', leaves: [] }) } });
  assert.equal(absent.ready, false);
  await assert.rejects(composeStudio([], { run, selectionApi: { studioSelection: async () => { throw new Error('Cannot find actual-renderer'); } } }), /Cannot find actual-renderer/);
});

// COLD: a slot-model selection has no compiled catalog runtime, so `runtimeUrl` alone left every
// slot-model workspace unready forever. Its readiness is its pins: all resolved, at least one.
test('a slot-model selection is ready when every pinned leaf resolves, and not when one is unavailable or none is pinned', async () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(passing) });
  const compose = selection => composeStudio([], { run, selectionApi: { studioSelection: async () => selection } });
  const resolved = { leaf: 'components.button', source: 'consumer', fill: 'button@v1', hash: 'sha256:x' };
  assert.equal((await compose({ model: 'slots', hash: 'h', leaves: [resolved], gateReports: [] })).ready, true);
  const drifted = await compose({ model: 'slots', hash: 'h', leaves: [resolved, { leaf: 'components.card', source: 'unavailable', message: 'drifted' }], gateReports: [] });
  assert.equal(drifted.ready, false);
  assert.deepEqual(drifted.unavailable, ['components.card']);
  assert.equal((await compose({ model: 'slots', hash: 'h', leaves: [], gateReports: [] })).ready, false);
  assert.equal((await compose({ hash: 'h', leaves: [resolved], gateReports: [] })).ready, false);
});
