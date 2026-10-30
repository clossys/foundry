import { describe, expect, it } from 'vitest';
import { studioIABands, studioSelectedSurface, studioUsedByCount } from '../../studio/lib/studio-ia-body';
import type { AgentCells } from '../../studio/lib/cells-client';

describe('native IA body consumption', () => {
  it('reads actual native bands and refuses absent or obsolete container declarations', () => {
    expect(studioIABands({ studioPageBodies: { publisher: { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } } } }, 'publisher')).toEqual({ bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } });
    expect(studioIABands({}, 'publisher').need).toBeDefined();
    expect(studioIABands({ studioPageBodies: { publisher: { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.data-table' } } } }, 'publisher').need).toBeDefined();
  });
  it('requires selected Cards provenance and the exact canonical export', () => {
    const Cards = () => null;
    expect(studioSelectedSurface('sections.cards', [], { Cards })).toBeUndefined();
    const leaves = [{ leaf: 'sections.cards', fill: 'foundry/sections.cards', source: 'fallback' as const }];
    expect(studioSelectedSurface('sections.cards', leaves, { Cards })).toBe(Cards);
    expect(studioSelectedSurface('sections.cards', leaves, { RecordCards: Cards })).toBeUndefined();
  });
  it('reports incomplete used-by scope honestly and counts only matching versions', () => {
    const cell = { id: 'example.page', title: 'Page', version: 2 };
    const indexes: AgentCells[] = [{ agent: 'publisher', state: 'ready', cells: [cell] }, { agent: 'writer', state: 'ready', cells: [{ id: 'copy.page', title: 'Copy', fields: { links: ['publisher:example.page@2'] } }, { id: 'copy.other', title: 'Other', fields: { links: ['publisher:example.page@1'] } }] }];
    expect(studioUsedByCount(indexes, 'publisher', cell)).toEqual({ count: 1, complete: false });
    expect(studioUsedByCount([...indexes, { agent: 'director', state: 'ready', cells: [] }, { agent: 'designer', state: 'ready', cells: [] }], 'publisher', cell)).toEqual({ count: 1, complete: true });
  });
});
