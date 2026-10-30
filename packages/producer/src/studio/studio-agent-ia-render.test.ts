import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCells } from '../../studio/lib/cells-client';
vi.mock('../../studio/generated/studio-map', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), studioPageBodies: { publisher: { template: 'ia-scroll', bands: { L0: 'sections.section-header', L1: 'sections.section-header', L2: 'sections.cards' } } } }));
vi.mock('../../studio/components/StudioSelection', async () => {
  const blocks = await import('@clossys/designer/blocks');
  const components = await import('@clossys/designer/components');
  return {
    useStudioSelection: () => ({ selection: { leaves: ['sections.cards', 'sections.section-header'].map(leaf => ({ leaf, fill: `foundry/${leaf}`, source: 'fallback' })) }, runtime: { surfaces: { Cards: blocks.RecordCards, SectionHeader: blocks.SectionHeader } } }),
    useStudioUI: () => ({ EmptyState: blocks.EmptyState, Link: components.Link, Icon: () => null }),
  };
});
vi.mock('../../studio/components/AgentL3Specimen', () => ({ useAgentSpecimenCoverage: (_index: unknown, cell: { id: string }) => ({ cellId: cell.id, ready: false, registered: false, itemCount: 0, expectedVariantIds: [`${cell.id}:desktop`, `${cell.id}:mobile`], variants: [], issues: ['No selected specimen resolver'] }) }));
import { StudioAgentIA } from '../../studio/components/StudioAgentIA';

describe('selected native IA partial render', () => {
  it('renders every authored L3 in official Cards grid with plain NEED text, safe linkouts and no raw source', () => {
    const index: AgentCells = { agent: 'publisher', state: 'ready', cells: ['one', 'two'].map(name => ({ id: `sample.${name}`, title: name, version: 1, status: 'draft' })), tree: { tree: [{ id: 'sample', name: 'Sample', children: [{ id: 'sample.pages', name: 'Pages', cells: ['sample.two', 'sample.one'] }] }] } };
    const html = renderToStaticMarkup(createElement(StudioAgentIA, { index, indexes: [index], selectedId: 'sample.two', onSelect: () => undefined }));
    expect(html).toContain('data-ds-leaf="sections.cards"');
    expect(html).toContain('data-layout="grid"');
    expect(html.indexOf('studio-ia-sample.two')).toBeLessThan(html.indexOf('studio-ia-sample.one'));
    expect(html.match(/href="\/content\/publisher\/sample\.(?:one|two)"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).toContain('inventory incomplete');
    expect(html).toContain('NEED: sections.cards full specimen-body');
    expect(html).not.toMatch(/contenteditable|data-studio-source|---\ntitle:/i);
  });
});
