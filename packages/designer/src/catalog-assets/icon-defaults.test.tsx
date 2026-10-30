// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCatalog } from '../catalog-core/index.js';
import { resolve } from '../catalog-core/resolve.js';
import type { LibraryData } from '../catalog-core/types.js';
import { importLucide, LUCIDE_SOURCE } from '../importers/lucide.js';
import roster from '../importers/lucide-pin.json' with { type: 'json' };
import amendment from '../catalog/ia/assets.draft-leaf-amendments.json' with { type: 'json' };
import { libraryRoster } from '../catalog-core/library-roster.js';
import { Icon } from '../components/Icon.js';
import { withAssetCatalog } from './catalog.js';
import { planIconDefaults, resolveIconAssets } from './icon-defaults.js';

const catalog = withAssetCatalog(loadCatalog());
const ids = ['explorer', 'inspector', 'source', 'checks', 'needs'].map(name => `assets.icon-${name}`);
const empty = (): LibraryData => ({ source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, fills: [], adoptedAt: '2026-10-30' });

describe('Studio icon seats and runtime defaults', () => {
  it('registers five new draft seats once, reusing exact vendored glyph pins and generated fills', () => {
    const original = ['folder', 'info', 'document', 'document-approved', 'list-view'];
    ids.forEach((id, index) => {
      const slot = catalog.slots.filter(slot => slot.id === id);
      expect(slot).toHaveLength(1);
      expect(slot[0]!.status).toBe('draft');
      expect(amendment.addedLeafIds).toContain(id);
      const row = roster.find(row => row.leaf === id)!;
      expect(row.pin).toEqual(roster.find(row => row.leaf === `assets.icon-${original[index]}`)!.pin);
      const fill = importLucide().find(fill => fill.$extensions['com.clossys.fill'].slot === id)!;
      expect(JSON.parse(readFileSync(new URL(`../catalog/fills/lucide/${id}.json`, import.meta.url), 'utf8'))).toEqual(fill);
      expect(libraryRoster('assets', id).map(row => row.id)).toEqual(['lucide', 'custom']);
    });
    expect(LUCIDE_SOURCE.pin?.sha256).toBe(createHash('sha256').update(readFileSync(new URL('../importers/lucide-pin.json', import.meta.url))).digest('hex'));
  });

  it('adopts missing glyphs through the actual engine and renders Lucide glyph bytes', () => {
    const result = resolveIconAssets({ catalog, library: empty() });
    expect(result.plan.unavailable).toEqual([]);
    expect(result.plan.changes).toHaveLength(46);
    const profile = resolve({ catalog, library: result.library });
    for (const [id, glyph] of Object.entries(result.glyphs)) {
      expect(profile.members[`${id}.default`]!.origin).toMatchObject({ kind: 'adopted', source: 'lucide' });
      const markup = renderToStaticMarkup(createElement(Icon, { glyph, decorative: true }));
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('<svg');
    }
    expect(ids.every(id => result.glyphs[id])).toBe(true);
  });

  it('preserves consumer fills and explicit choices, and never substitutes an unavailable choice', () => {
    const slot = 'assets.icon-search';
    const explicit = resolveIconAssets({ catalog, library: empty(), slots: [slot], choices: { [slot]: 'phosphor' } });
    expect(explicit.plan.changes).toEqual([{ op: 'adopt', slot, source: 'phosphor' }]);
    const again = resolveIconAssets({ catalog, library: explicit.library, slots: [slot] });
    expect(again.library).toBe(explicit.library);
    expect(again.plan.preserved).toEqual([slot]);
    expect(again.glyphs[slot]).toEqual(explicit.glyphs[slot]);
    expect(planIconDefaults({ catalog, library: empty(), slots: [slot], choices: { [slot]: 'missing' } })).toEqual({ changes: [], preserved: [], unavailable: [slot] });
    expect(planIconDefaults({ catalog, library: empty(), slots: [slot], preference: ['phosphor', 'lucide'] }).changes).toEqual([{ op: 'adopt', slot, source: 'phosphor' }]);
  });
});
