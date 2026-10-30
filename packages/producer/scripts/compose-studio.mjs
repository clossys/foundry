#!/usr/bin/env node
/** Compose the actual Studio runtime; legacy reports cannot grant or refuse render readiness. */
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
  catch { processReport = { blocking: false, state: 'unavailable', exitStatus: checked.status ?? 2, signal: checked.signal ?? null, message: checked.error?.message ?? checked.stderr ?? 'Legacy report did not emit JSON.' }; }
  // The compiled module must exist. An absent build, module or executable remains an actual error.
  const selectionApi = ports.selectionApi ?? await import('../dist/server/selection.js');
  const selection = await selectionApi.studioSelection(root);
  return { check: 'studio:compose', ready: Boolean(selection.runtimeUrl), processReport, selection };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  composeStudio().then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ready ? 0 : 1; }).catch(error => { console.error(JSON.stringify({ check: 'studio:compose', ready: false, error: error.message })); process.exitCode = 1; });
}
