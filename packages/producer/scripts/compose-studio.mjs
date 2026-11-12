#!/usr/bin/env node
/**
 * Compose the actual Studio runtime, behind the designer process gates: a red, missing or unreadable
 * process report refuses composition (no selection is compiled), exactly like `npm run compose`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
export async function composeStudio(args = process.argv.slice(2), ports = {}) {
  let root = repository;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--root' || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: studio:compose [--root CONSUMER]');
    root = resolve(args[++index]);
  }
  const run = ports.run ?? spawnSync;
  const checked = run(process.execPath, [resolve(repository, 'packages/designer/scripts/check-process-gates.mjs'), '--studio', '--json'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  let processReport;
  try { processReport = JSON.parse(checked.stdout); }
  catch { processReport = { state: 'unavailable', ok: false, exitStatus: 2, message: checked.error?.message ?? checked.stderr ?? 'Process gates did not emit JSON.' }; }
  // The process exit is the verdict: only a clean, verified run (exit 0 and an ok report) lets composition proceed.
  const exitStatus = checked.error || checked.signal ? 2 : checked.status ?? 2;
  if (exitStatus !== 0 || processReport?.ok !== true) {
    const failed = (processReport?.gates ?? []).filter(row => row.exitStatus !== 0).map(row => `${row.gate} exit ${row.exitStatus}`);
    return { check: 'studio:compose', ready: false, refused: `designer process gates exited ${exitStatus}${failed.length ? `: ${failed.join(', ')}` : ''}; composition refused`, processExit: exitStatus, signal: checked.signal ?? null, processReport };
  }
  // The compiled module must exist. An absent build, module or executable remains an actual error.
  const selectionApi = ports.selectionApi ?? await import('../dist/server/selection.js');
  const selection = await selectionApi.studioSelection(root);
  // A catalog selection is ready when it compiled a runtime. A slot-model selection composes from the
  // pins: it is ready when it has pinned leaves and every pinned leaf resolved to its candidate.
  const unavailable = (selection.leaves ?? []).filter(leaf => leaf.source !== 'consumer').map(leaf => leaf.leaf);
  const ready = selection.model === 'slots' ? !selection.message && selection.leaves.length > 0 && !unavailable.length : Boolean(selection.runtimeUrl);
  return { check: 'studio:compose', ready, processExit: 0, processReport, ...(unavailable.length ? { unavailable } : {}), selection };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  composeStudio().then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ready ? 0 : 1; }).catch(error => { console.error(JSON.stringify({ check: 'studio:compose', ready: false, error: error.message })); process.exitCode = 1; });
}
