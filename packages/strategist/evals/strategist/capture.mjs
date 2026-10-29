import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No shell, model calls, login, network work or writes to the strategy root.
// This preserves raw outputs; normalization awaits the integrated check shapes.
try {
  const [rootArg, outputArg] = process.argv.slice(2);
  if (!rootArg || !outputArg || process.argv.length !== 4) throw new Error('Usage: node capture.mjs <strategy-root> <capture.json>');
  const root = resolve(rootArg);
  const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
  const treeBytes = readFileSync(resolve(root, 'tree.json'));
  const tree = JSON.parse(treeBytes);
  const active = Object.entries(tree.active).filter(([, v]) => v !== null).map(([id, version]) => `${id}@${version}`).sort();
  const commands = [...active.map(ref => ['check', ref]), ['cohere'], ['complete', '--level', 'mvs'], ['complete', '--level', 'full'], ['status']];
  const captures = commands.map(args => {
    const argv = [cli, ...args, '--root', root, '--json'];
    const result = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { command: [process.execPath, ...argv], exitCode: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
  });
  writeFileSync(outputArg, `${JSON.stringify({ schemaVersion: 1, source: 'strategist-check', rootTreeSha256: createHash('sha256').update(treeBytes).digest('hex'), active, captures }, null, 2)}\n`);
  // Exit 1 findings are evidence; exit 2, timeouts and non-JSON output could not run.
  const failed = captures.some(c => ![0, 1].includes(c.exitCode) || c.error || (() => { try { JSON.parse(c.stdout); return false; } catch { return true; } })());
  process.exitCode = failed ? 2 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
