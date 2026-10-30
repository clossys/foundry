import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { studioChecks } from './studio-checks';
it('reports the real fixed check stubs as unavailable with exit2, never passing findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-checks-'));
  try {
    await mkdir(join(root, 'clossys'));
    await writeFile(join(root, 'clossys/clossys.config.ts'), 'export default {};\n');
    const result = await studioChecks(root);
    expect(result.results).toHaveLength(4);
    expect(result.results.every(result => result.state === 'unavailable' && result.exitCode === 2 && result.message.includes('not implemented'))).toBe(true);
    expect(result.results.some(result => 'findings' in result)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
