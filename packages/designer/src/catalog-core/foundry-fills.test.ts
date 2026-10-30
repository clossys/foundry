import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokenPlacement from '../catalog/ia/tokens.json' with { type: 'json' };
import tokenSlots from '../catalog/slots/tokens.json' with { type: 'json' };
import { TOKENS } from '../tokens/tokens.js';
import { importFoundry } from '../importers/foundry.js';
import { offeredFoundryFills } from '../importers/foundry-offered.js';
import { stableStringify } from './stable.js';
import { loadCatalog } from './index.js';
import { tokenCatalog } from './__fixtures__/token-catalog.js';
import type { Slot } from './types.js';
const here = dirname(fileURLToPath(import.meta.url));
const slots = tokenSlots as unknown as readonly Slot[];
const tokensCss = readFileSync(resolve(here, '../../styles/tokens.css'), 'utf8');
const historical = importFoundry({ tokens: Object.values(TOKENS), tokensCss, slots });
describe('Foundry token fill documents', () => {
  it('pins the 50-cell importer oracle for the current canonical registry', () => {
    expect(historical).toHaveLength(50);
    expect(historical).toEqual(JSON.parse(readFileSync(resolve(here, '__fixtures__/foundry-original-fills.json'), 'utf8')));
  });
  it('matches every prepared candidate against its committed token cell', () => {
    const offered = offeredFoundryFills(historical, slots);
    expect(offered).toHaveLength(41);
    for (const fill of offered) {
      const meta = fill.$extensions['com.clossys.fill'];
      expect(readFileSync(resolve(here, `../catalog/fills/${meta.source}/${meta.slot}.json`), 'utf8')).toBe(stableStringify(fill));
    }
  });
  it('loads the offered token cells and labelled baselines without changing registry bindings', () => {
    const offered = offeredFoundryFills(historical, slots);
    for (const source of ['foundry', 'foundry-baseline']) {
      const expressive = source === 'foundry' ? ['tokens.animation.json', 'tokens.gradient.json'] : [];
      const expected = [...offered.filter(fill => fill.$extensions['com.clossys.fill'].source === source).map(fill => fill.$extensions['com.clossys.fill'].slot + '.json'), ...expressive].sort();
      expect(readdirSync(resolve(here, '../catalog/fills', source)).filter(file => file.startsWith('tokens.')).sort()).toEqual(expected);
    }
    const catalog = tokenCatalog(loadCatalog());
    expect(catalog.slots).toEqual(slots);
    expect(catalog.standards.map(standard => standard.id).sort()).toEqual(['apg', 'dtcg', 'tailwind-v4-theme', 'wcag-2.2', 'web-app-manifest']);
    expect(catalog.placements).toEqual([tokenPlacement]); expect(catalog.retired).toEqual([]);
    expect(catalog.sources).toContainEqual({ id: 'foundry', kind: 'base', author: 'foundry', license: 'MIT' });
    expect(catalog.fills.filter(fill => fill.$extensions['com.clossys.fill'].source === 'foundry')).toHaveLength(40);
  });
});
