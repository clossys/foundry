/**
 * check:no-consumer-content mutation proof: a clean scratch repository passes, and each rule fails on
 * one planted package file. The planted climbing paths are built at run time so this file is not one.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-no-consumer-content.mjs');
const UP = ['..', '..'];

function scratch(files) {
  const repo = mkdtempSync(join(tmpdir(), 'no-consumer-content-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  return repo;
}

/** A consumer with one pinned Writer candidate. */
function consumer() {
  const root = mkdtempSync(join(tmpdir(), 'no-consumer-content-consumer-'));
  const slot = join(root, 'clossys', 'agents', 'writer', 'strings.example');
  mkdirSync(join(slot, 'candidates'), { recursive: true });
  writeFileSync(join(slot, 'pin.json'), JSON.stringify({ candidate: 'v1.md' }));
  writeFileSync(join(slot, 'candidates', 'v1.md'), 'A consumer sentence nobody else wrote.\n');
  return root;
}

function run(repo, consumerRoot) {
  const env = { ...process.env };
  delete env.CLOSSYS_ROOT;
  const result = spawnSync(process.execPath, [SCRIPT, '--repo', repo, '--consumer', consumerRoot, '--json'], { encoding: 'utf8', env });
  return { status: result.status, rules: JSON.parse(result.stdout).findings.map(row => row.rule) };
}

const CLEAN = { 'packages/demo/src/index.ts': 'export const ok = 1;\n' };

test('a clean package passes, and each planted file fails its rule', () => {
  const root = consumer();
  const cases = [
    [{}, 0, []],
    [{ 'packages/demo/src/reach.ts': `export const at = "${[...UP, 'clossys', 'agents', 'writer'].join('/')}";\n` }, 1, ['consumer-reach']],
    [{ 'packages/demo/src/join.ts': `join(ROOT, ${[...UP, 'clossys'].map(part => `"${part}"`).join(', ')});\n` }, 1, ['consumer-reach']],
    [{ 'packages/demo/clossys/agents/writer/strings.x/slot.json': '{}\n' }, 1, ['consumer-tree']],
    [{ 'packages/demo/templates/copy.md': 'A consumer sentence nobody else wrote.\n' }, 1, ['pinned-text']],
    [{ 'packages/demo/test-fixtures/reach.ts': `export const at = "${[...UP, 'clossys'].join('/')}/x";\n` }, 0, []],
  ];
  try {
    for (const [planted, status, rules] of cases) {
      const repo = scratch({ ...CLEAN, ...planted });
      try {
        assert.deepEqual(run(repo, root), { status, rules }, JSON.stringify(Object.keys(planted)));
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
