import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeCapture } from './normalize.mjs';
import { snapshotContracts } from './contract-snapshot.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
// The CLI writes reports under the supplied root. It must not edit strategy inputs.
export async function captureRoot(rootArg) {
  const root = resolve(rootArg);
  const cli = resolve(packageRoot, 'dist/cli.js');
  const { readStrategyRoot } = await import(new URL('../../dist/store.js', import.meta.url));
  const snapshot = () => {
    const model = readStrategyRoot(root);
    return { files: model.files, issues: model.issues, briefContracts: snapshotContracts(root, model.catalog), hashes: Object.fromEntries(Object.entries(model.files).map(([path, text]) => [path, hash(text)])) };
  };
  const before = snapshot();
  let tree;
  try { tree = JSON.parse(before.files['tree.json']); } catch { tree = {}; }
  const active = Object.entries(tree.active && typeof tree.active === 'object' ? tree.active : {}).filter(([, v]) => v !== null).map(([id, version]) => `${id}@${version}`).sort();
  const head = spawnSync('git', ['-C', packageRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) throw new Error('Cannot record source head');
  const dirty = spawnSync('git', ['-C', packageRoot, 'status', '--porcelain', '--', 'src', 'catalog', 'scripts', 'package.json', 'tsconfig.json'], { encoding: 'utf8' });
  if (dirty.status !== 0) throw new Error('Cannot record implementation worktree state');
  const commands = [...active.map(ref => ['check', ref]), ['cohere'], ['complete', '--level', 'mvs'], ['complete', '--level', 'full'], ['status', '--scope', 'full']];
  const captures = commands.map(args => {
    const argv = [cli, ...args, '--root', root, '--json'];
    const result = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { command: [process.execPath, ...argv], exitCode: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
  });
  const after = snapshot();
  const capture = { schemaVersion: 1, source: 'strategist-check', sourceHead: head.stdout.trim(), implementationDirty: dirty.stdout.trim(), cliSha256: hash(readFileSync(cli)), rootTreeSha256: before.files['tree.json'] === undefined ? null : hash(before.files['tree.json']), active, before, after, captures };
  try { capture.measurements = normalizeCapture(capture); }
  catch (error) { capture.normalizationError = error.message; }
  return capture;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [root, output] = process.argv.slice(2);
    if (!root || !output || process.argv.length !== 4) throw new Error('Usage: node capture.mjs <strategy-root> <capture.json>');
    const capture = await captureRoot(root);
    writeFileSync(output, `${JSON.stringify(capture, null, 2)}\n`);
    if (capture.normalizationError) { console.error(capture.normalizationError); process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
