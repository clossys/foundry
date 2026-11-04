import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { studioChecks } from './studio-checks';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

it('maps exit 2 (no slot model) to unavailable, carrying the CLI message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-checks-'));
  try {
    await mkdir(join(root, 'clossys'));
    await writeFile(join(root, 'clossys/clossys.config.ts'), 'export default {};\n');
    const result = await studioChecks(root);
    expect(result.results).toHaveLength(4);
    for (const row of result.results) {
      expect(row).toMatchObject({ state: 'unavailable', exitCode: 2 });
      expect(row.message).toMatch(/could not run|missing/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('maps exit 0 to pass on the real consumer, never to error', async () => {
  const result = await studioChecks(repo);
  for (const row of result.results) {
    expect(row.state).toBe(({ 0: 'pass', 1: 'findings', 2: 'unavailable' } as const)[row.exitCode as 0 | 1 | 2]);
    expect(row.state).not.toBe('error');
  }
  expect(result.results.find(row => row.agent === 'publisher')).toMatchObject({ state: 'pass', exitCode: 0 });
}, 120_000);
