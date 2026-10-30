import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import slots from '../catalog/slots/tokens.json' with { type: 'json' };
import { stableStringify } from '../catalog-core/stable.js';
import type { Slot } from '../catalog-core/types.js';
import { generateFills, generatedTokenFills } from './generate-fills.js';
import { leafCoverage } from './leaf-coverage.js';
it('pins every generated token cell and its deterministic 55-leaf candidate report (53 filled)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  if (process.env.GENERATE_TOKEN_FILLS === '1') generateFills();
  const fills = generatedTokenFills();
  const report = leafCoverage(slots as unknown as readonly Slot[], fills);
  expect(readFileSync(resolve(here, 'token-leaf-coverage.json'), 'utf8')).toBe(stableStringify(report));
  expect(report.unionFilledLeaves).toBe(53);
  expect(report.uncoveredLeaves).toEqual(['tokens.animation', 'tokens.container-width']);
  for (const source of new Set(fills.map(fill => fill.$extensions['com.clossys.fill'].source))) {
    const directory = resolve(here, '../catalog/fills', source === 'shadcn@aria' ? 'shadcn-aria' : source);
    const group = fills.filter(fill => fill.$extensions['com.clossys.fill'].source === source);
    expect(readdirSync(directory).filter(file => file.startsWith('tokens.')).sort()).toEqual(group.map(fill => fill.$extensions['com.clossys.fill'].slot + '.json').sort());
    for (const fill of group) expect(readFileSync(resolve(directory, fill.$extensions['com.clossys.fill'].slot + '.json'), 'utf8')).toBe(stableStringify(fill));
  }
});
